const prisma = require('../prismaClient');
const { pollAllAccounts } = require('./emailPoller');
const { analyzeEmail } = require('./mailAnalyzer');
const { createTicketFromEmail, addGlpiFollowup } = require('./glpiTicketCreator');
const { findExistingTicket } = require('./conversationMatcher');
const { findSimilarOpenTicket, attachSiteToTicket, saveTicketEmbedding } = require('./similarIncidentDetector');
const { analyzeIntent, applyIntentActions } = require('./intentAnalyzer');
const { buildAcknowledgementHtml, buildKnownIncidentNotificationHtml, sendEmail, getEmailSignature } = require('./emailSender');
const { processIncomingAttachments } = require('./emailAttachmentProcessor');
const { stripSignature } = require('./signatureStripper');
const { logEvent } = require('./ticketEvent');
const { getSystemSettings } = require('./systemSettings');
const { tryHandleReminderReply } = require('./draftReplyApproval');

// Selon le réglage "Auto-envoi des emails sans validation humaine" (Paramètres > Automatisation) :
// envoie directement l'email, ou crée un AiEmailDraft en attente d'approbation comme aujourd'hui.
async function dispatchOrQueueEmail({ ticketId, glpiTicketId, recipientEmail, ccRecipients, subject, html, draftType }) {
  const settings = await getSystemSettings();
  if (settings.autoSendAiEmails) {
    await sendEmail({ ticketId, to: recipientEmail, cc: ccRecipients, subject, bodyHtml: html, saveAsMessage: true });
    await logEvent(ticketId, 'EMAIL_SENT', 'AI', { to: recipientEmail, cc: ccRecipients, subject, autoSent: true });
  } else {
    await prisma.aiEmailDraft.create({
      data: { ticketId, glpiTicketId, recipientEmail, ccRecipients, subject, proposedContent: html },
    });
    await logEvent(ticketId, 'AI_DRAFT_GENERATED', 'AI', { type: draftType });
  }
}

async function processMessage(message, account) {
  const graphMessageId = message.id;
  const fromEmail = message.from?.emailAddress?.address || '';
  const fromName = message.from?.emailAddress?.name || '';
  const subject = message.subject || '(sans objet)';
  const bodyPreview = message.bodyPreview || '';
  const bodyHtml = message.body?.content || '';
  const receivedAt = message.receivedDateTime ? new Date(message.receivedDateTime) : new Date();
  const conversationId = message.conversationId || null;
  const internetMessageId = message.internetMessageId || null;
  const headers = message.internetMessageHeaders || [];
  const getHeader = (name) => headers.find((h) => h.name.toLowerCase() === name)?.value || null;
  // In-Reply-To/References ne sont pas exposés comme propriétés directes par Graph sur l'endpoint delta,
  // seulement via les en-têtes RFC822 bruts.
  const inReplyToRaw = getHeader('in-reply-to');
  const inReplyTo = inReplyToRaw ? inReplyToRaw.split(/\s+/)[0] : null;
  const references = getHeader('references');
  const toRecipients = (message.toRecipients || []).map((r) => r.emailAddress?.address).filter(Boolean);
  const ccRecipients = (message.ccRecipients || []).map((r) => r.emailAddress?.address).filter(Boolean);
  // Graph signale parfois hasAttachments=false alors qu'une image collée inline (cid:...) est bien
  // présente dans le corps HTML — cas vu en pratique sur de longs fils de réponse. On considère donc
  // aussi la présence d'une référence cid: dans bodyHtml comme preuve d'une pièce jointe à récupérer.
  const hasAttachments = message.hasAttachments === true || !!message.simulatedAttachments || /cid:/i.test(bodyHtml || '');

  const existing = await prisma.incomingEmail.findUnique({ where: { graphMessageId } });
  if (existing) return existing;

  // Réponse d'un responsable à un email de relance de brouillon ("j'approuve"/"je rejette") —
  // traité à part, ne doit pas créer de IncomingEmail/ticket (ce n'est pas une demande utilisateur).
  if (await tryHandleReminderReply({ inReplyTo, bodyPreview })) {
    return null;
  }

  // Corps nettoyé de la signature/disclaimer, calculé une seule fois ici et réutilisé par toutes
  // les analyses IA en aval (intention, filtrage des images, résumé) pour éviter qu'elles soient
  // biaisées par le texte de signature répété à chaque message du fil.
  const cleanBody = await stripSignature(bodyPreview);

  const incoming = await prisma.incomingEmail.create({
    data: {
      graphMessageId, internetMessageId, conversationId, inReplyTo, references,
      emailAccountId: account.id, fromEmail, fromName, subject,
      bodyPreview, bodyHtml, receivedAt, status: 'PROCESSING',
      ccRecipients, hasAttachments,
    },
  });

  try {
    // Étape 1 : chercher un ticket existant par conversation
    const match = await findExistingTicket({ conversationId, inReplyTo, internetMessageId, subject, fromEmail });

    if (match) {
      // Email de suivi sur ticket existant
      const ticket = await prisma.ticket.findUnique({ where: { id: match.ticketId } });

      // Enregistrer le message dans l'historique
      await prisma.ticketMessage.create({
        data: {
          ticketId: match.ticketId,
          direction: 'INBOUND',
          sender: fromEmail,
          recipients: toRecipients,
          ccRecipients,
          subject,
          body: bodyPreview,
          bodyHtml,
          outlookMessageId: graphMessageId,
          internetMessageId,
          inReplyTo,
          conversationId,
          timestamp: receivedAt,
        },
      });

      await processIncomingAttachments({
        account, graphMessageId, incomingEmailId: incoming.id,
        ticketId: match.ticketId, glpiTicketId: ticket?.glpiTicketId,
        simulatedAttachments: message.simulatedAttachments,
        bodyText: cleanBody,
      });

      // Répercute la réponse de l'utilisateur dans GLPI (pas seulement le mail initial à la création) :
      // sans ça, les échanges ultérieurs n'apparaissent jamais dans l'interface GLPI.
      if (ticket?.glpiTicketId) {
        try {
          await addGlpiFollowup(ticket.glpiTicketId, `Email de ${fromName || fromEmail} <${fromEmail}> :\n\n${cleanBody}`);
        } catch (err) {
          console.error('[emailPipeline] Échec ajout followup GLPI:', err.message);
        }
      }

      await logEvent(match.ticketId, 'EMAIL_RECEIVED', fromEmail, { subject, method: match.method });

      // Récupère les derniers échanges du fil pour donner du contexte réel à l'analyse d'intention
      // (sans ça, un "ok merci" se juge sans savoir à quelle relance précise l'utilisateur répond).
      const recentMessages = await prisma.ticketMessage.findMany({
        where: { ticketId: match.ticketId },
        orderBy: { timestamp: 'desc' },
        take: 5,
        select: { direction: true, body: true, timestamp: true },
      });

      // Analyser l'intention de la réponse
      const intentResult = await analyzeIntent({
        subject, body: cleanBody,
        ticketTitle: ticket?.title,
        ticketSummary: ticket?.aiSummary,
        conversationHistory: recentMessages.reverse(),
        fromEmail,
      });

      await applyIntentActions(match.ticketId, intentResult, fromEmail, {
        fromEmail, fromName, emailAccountId: account.id,
        originalBody: bodyPreview, originalSubject: subject,
      });

      // Si réouverture, noter dans GLPI
      if (match.method === 'REOPEN') {
        await logEvent(match.ticketId, 'REOPENED', fromEmail, { conversationId });
        await prisma.ticket.update({ where: { id: match.ticketId }, data: { status: 'OPEN', closedAt: null } });
      }

      await prisma.incomingEmail.update({
        where: { id: incoming.id },
        data: { status: 'DONE', erpTicketId: match.ticketId, isNewTicket: false, aiIntent: intentResult.intent },
      });

      return prisma.incomingEmail.findUnique({ where: { id: incoming.id } });
    }

    // Étape 2 : analyse IA pour nouveau ticket
    const analysis = await analyzeEmail({ subject, body: cleanBody, from: fromEmail, fromName });

    if (analysis.isSpam) {
      await prisma.incomingEmail.update({
        where: { id: incoming.id },
        data: { status: 'SPAM', aiSummary: analysis.summary, aiIsSpam: true, aiConfidence: analysis.confidence },
      });
      return prisma.incomingEmail.findUnique({ where: { id: incoming.id } });
    }

    // Étape 2b : détecter un incident similaire déjà ouvert (même problème, autre site/magasin)
    const similarMatch = await findSimilarOpenTicket({
      subject, body: cleanBody, category: analysis.category,
    });

    if (similarMatch) {
      // Rattacher cet email au ticket similaire existant
      await prisma.ticketMessage.create({
        data: {
          ticketId: similarMatch.ticketId,
          direction: 'INBOUND',
          sender: fromEmail,
          recipients: toRecipients,
          ccRecipients,
          subject, body: bodyPreview, bodyHtml,
          outlookMessageId: graphMessageId,
          internetMessageId, inReplyTo, conversationId,
          timestamp: receivedAt,
        },
      });

      // Enregistrer le site impacté et détecter une promotion en incident majeur
      const becamesMajor = await attachSiteToTicket(similarMatch.ticketId, fromEmail, fromName);

      await logEvent(similarMatch.ticketId, 'EMAIL_RECEIVED', fromEmail, {
        subject,
        method: 'SIMILAR_INCIDENT',
        similarity: similarMatch.similarity,
        note: `Incident similaire détecté (${Math.round(similarMatch.similarity * 100)}% similarité) — rattaché au ticket #${similarMatch.ticketId}`,
      });

      if (becamesMajor) {
        await logEvent(similarMatch.ticketId, 'MAJOR_INCIDENT_PROMOTED', 'SYSTEM', {
          note: 'Promu en incident majeur — seuil de sites impactés atteint',
        });
      }

      // Mettre à jour lastUserReplyAt pour indiquer activité récente
      const updatedTicket = await prisma.ticket.update({
        where: { id: similarMatch.ticketId },
        data: { lastUserReplyAt: receivedAt },
        select: { glpiTicketId: true, impactedSites: true, isMajorIncident: true },
      });

      await processIncomingAttachments({
        account, graphMessageId, incomingEmailId: incoming.id,
        ticketId: similarMatch.ticketId, glpiTicketId: updatedTicket.glpiTicketId,
        simulatedAttachments: message.simulatedAttachments,
        bodyText: cleanBody,
      });

      if (updatedTicket.glpiTicketId) {
        try {
          await addGlpiFollowup(updatedTicket.glpiTicketId, `Email de ${fromName || fromEmail} <${fromEmail}> (site impacté supplémentaire) :\n\n${cleanBody}`);
        } catch (err) {
          console.error('[emailPipeline] Échec ajout followup GLPI:', err.message);
        }
      }

      // Notification "incident déjà connu" — envoyée directement ou mise en attente d'approbation
      // selon le réglage Paramètres > Automatisation > Auto-envoi des emails IA.
      const knownIncidentHtml = buildKnownIncidentNotificationHtml({
        toName: fromName,
        glpiTicketId: updatedTicket.glpiTicketId,
        originalSubject: similarMatch.ticketTitle,
        isMajor: updatedTicket.isMajorIncident,
        impactedCount: updatedTicket.impactedSites.length,
        signature: await getEmailSignature(),
      });
      await dispatchOrQueueEmail({
        ticketId: similarMatch.ticketId,
        glpiTicketId: updatedTicket.glpiTicketId,
        recipientEmail: fromEmail,
        ccRecipients,
        subject: `[Ticket #${updatedTicket.glpiTicketId}] ${similarMatch.ticketTitle}`,
        html: knownIncidentHtml,
        draftType: 'KNOWN_INCIDENT',
      });

      await prisma.incomingEmail.update({
        where: { id: incoming.id },
        data: {
          status: 'DONE',
          erpTicketId: similarMatch.ticketId,
          isNewTicket: false,
          aiSummary: analysis.summary,
          aiCategory: analysis.category,
          aiPriority: analysis.priority,
          aiTeam: analysis.team,
          aiConfidence: analysis.confidence,
          aiIsSpam: false,
          aiIntent: `SIMILAR_INCIDENT:${similarMatch.ticketId}`,
        },
      });

      return prisma.incomingEmail.findUnique({ where: { id: incoming.id } });
    }

    // Étape 3 : créer ticket GLPI + ERP — on garde le corps brut complet (bodyPreview) comme
    // contenu du ticket, pour ne jamais perdre d'information par rapport à l'email d'origine.
    const { glpiTicketId, erpTicketId } = await createTicketFromEmail({
      subject, body: bodyPreview, from: fromEmail, fromName, analysis, emailAccountId: account.id,
    });

    // Étape 4 : stocker conversationId + aiSummary sur le ticket ERP (immédiatement pour la détection future)
    await prisma.ticket.update({
      where: { id: erpTicketId },
      data: {
        aiSummary: analysis.summary,
        ...(conversationId ? { outlookConversationId: conversationId, status: 'WAITING_FOR_USER', lastUserReplyAt: receivedAt } : {}),
      },
    });

    // Étape 5 : enregistrer le message entrant
    await prisma.ticketMessage.create({
      data: {
        ticketId: erpTicketId,
        direction: 'INBOUND',
        sender: fromEmail,
        recipients: toRecipients,
        ccRecipients,
        subject, body: bodyPreview, bodyHtml,
        outlookMessageId: graphMessageId,
        internetMessageId, inReplyTo, conversationId,
        timestamp: receivedAt,
      },
    });

    await processIncomingAttachments({
      account, graphMessageId, incomingEmailId: incoming.id,
      ticketId: erpTicketId, glpiTicketId,
      simulatedAttachments: message.simulatedAttachments,
      bodyText: cleanBody,
    });

    await logEvent(erpTicketId, 'CREATED', fromEmail, { glpiTicketId, source: 'EMAIL' });
    await logEvent(erpTicketId, 'AI_ANALYZED', 'AI', { analysis });

    // Sauvegarder l'embedding pour la détection future d'incidents similaires
    await saveTicketEmbedding(erpTicketId, subject, cleanBody);

    // Étape 6 : accusé de réception — envoyé directement ou mis en attente d'approbation selon
    // le réglage Paramètres > Automatisation > Auto-envoi des emails IA.
    const pipelineSettings = await getSystemSettings();
    const acknowledgementHtml = buildAcknowledgementHtml({
      toName: fromName,
      glpiTicketId,
      originalSubject: subject,
      customMessage: pipelineSettings.acknowledgementMessage,
      signature: await getEmailSignature(),
    });
    await dispatchOrQueueEmail({
      ticketId: erpTicketId,
      glpiTicketId,
      recipientEmail: fromEmail,
      ccRecipients,
      subject: `[Ticket #${glpiTicketId}] ${subject}`,
      html: acknowledgementHtml,
      draftType: 'ACKNOWLEDGEMENT',
    });

    await prisma.incomingEmail.update({
      where: { id: incoming.id },
      data: {
        status: 'DONE', glpiTicketId, erpTicketId, isNewTicket: true,
        aiSummary: analysis.summary, aiCategory: analysis.category,
        aiPriority: analysis.priority, aiTeam: analysis.team,
        aiConfidence: analysis.confidence, aiIsSpam: false,
      },
    });
  } catch (err) {
    await prisma.incomingEmail.update({ where: { id: incoming.id }, data: { status: 'ERROR', error: err.message } });
  }

  return prisma.incomingEmail.findUnique({ where: { id: incoming.id } });
}

async function runEmailPipeline() {
  const pollResults = await pollAllAccounts();
  const results = [];
  for (const { account, messages, error } of pollResults) {
    if (error) {
      console.error(`[emailPipeline] Échec polling compte ${account.emailAddress} (id ${account.id}):`, error);
      results.push({ accountId: account.id, error });
      continue;
    }
    for (const message of messages) {
      const result = await processMessage(message, account);
      results.push({ accountId: account.id, emailId: result?.id, status: result?.status });
    }
  }
  return results;
}

module.exports = { runEmailPipeline, processMessage };
