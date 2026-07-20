const prisma = require('../prismaClient');
const { getIO } = require('../utils/socket');
const { pollAllAccounts } = require('./emailPoller');
const { analyzeEmail } = require('./mailAnalyzer');
const { createTicketFromEmail, addGlpiFollowup } = require('./glpiTicketCreator');
const { findExistingTicket } = require('./conversationMatcher');
const { findSimilarOpenTicket, attachSiteToTicket, saveTicketEmbedding } = require('./similarIncidentDetector');
const { analyzeIntent, applyIntentActions } = require('./intentAnalyzer');
const { decideFollowupAction } = require('./followupEscalation');
const { generateFollowupReply } = require('./followupReplyGenerator');
const { buildAcknowledgementHtml, buildKnownIncidentNotificationHtml, sendEmail, getEmailSignature } = require('./emailSender');
const { processIncomingAttachments } = require('./emailAttachmentProcessor');
const { stripSignature } = require('./signatureStripper');
const { logEvent } = require('./ticketEvent');
const { getSystemSettings } = require('./systemSettings');
const { emitTicketCreated, emitTicketAssigned } = require('../utils/socket');
const { tryHandleReminderReply } = require('./draftReplyApproval');

// Selon le réglage "Auto-envoi des emails sans validation humaine" (Paramètres > Automatisation) :
// envoie directement l'email, ou crée un AiEmailDraft en attente d'approbation comme aujourd'hui.
async function dispatchOrQueueEmail({ ticketId, glpiTicketId, recipientEmail, ccRecipients, subject, html, draftType, inReplyToGraphMessageId, outlookConversationId }) {
  const settings = await getSystemSettings();
  if (settings.autoSendAiEmails) {
    await sendEmail({ ticketId, to: recipientEmail, cc: ccRecipients, subject, bodyHtml: html, saveAsMessage: true, inReplyToGraphMessageId, conversationId: outlookConversationId });
    await logEvent(ticketId, 'EMAIL_SENT', 'AI', { to: recipientEmail, cc: ccRecipients, subject, autoSent: true });
  } else {
    await prisma.aiEmailDraft.create({
      data: { ticketId, glpiTicketId, recipientEmail, ccRecipients, subject, proposedContent: html, inReplyToGraphMessageId, outlookConversationId },
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

  const io = getIO();
  if (io) {
    io.emit('email_received', incoming);
  }

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

      // Conversation IA multi-tours : tente de répondre directement à l'utilisateur sur les emails
      // de suivi (au-delà du simple changement de statut ci-dessus), avec validation humaine
      // systématique (AiEmailDraft PENDING) et escalade automatique si la conversation tourne en
      // rond (followupEscalation.js — seuil de tours prioritaire sur la confiance).
      if (!intentResult.isAutoReply) {
        const ticketForFollowup = await prisma.ticket.findUnique({ where: { id: match.ticketId } });
        const followupDecision = decideFollowupAction({
          intent: intentResult.intent,
          confidence: intentResult.confidence,
          aiExchangeCount: ticketForFollowup?.aiExchangeCount || 0,
        });

        if (followupDecision.action === 'ESCALATE') {
          await prisma.ticket.update({ where: { id: match.ticketId }, data: { status: 'WAITING_FOR_USER' } });
          await logEvent(match.ticketId, 'AI_CONVERSATION_ESCALATED', 'AI', { reason: followupDecision.reason });
          await logEvent(match.ticketId, 'NEEDS_HUMAN_REVIEW', 'AI', { reason: followupDecision.reason });
        } else if (followupDecision.action === 'GENERATE_DRAFT') {
          const replyResult = await generateFollowupReply({
            ticketId: match.ticketId,
            lastMessageBody: cleanBody,
            fromEmail, fromName,
          });

          if (!replyResult.canAnswer) {
            await prisma.ticket.update({ where: { id: match.ticketId }, data: { status: 'WAITING_FOR_USER' } });
            await logEvent(match.ticketId, 'AI_CONVERSATION_ESCALATED', 'AI', { reason: 'GENERATION_FAILED' });
            await logEvent(match.ticketId, 'NEEDS_HUMAN_REVIEW', 'AI', { reason: 'GENERATION_FAILED' });
          } else {
            const nextExchangeTurn = (ticketForFollowup?.aiExchangeCount || 0) + 1;
            await prisma.ticket.update({ where: { id: match.ticketId }, data: { aiExchangeCount: nextExchangeTurn } });

            const followupHtml = `${replyResult.replyHtml}${await getEmailSignature()}`;
            await prisma.aiEmailDraft.create({
              data: {
                ticketId: match.ticketId,
                glpiTicketId: ticketForFollowup?.glpiTicketId,
                recipientEmail: fromEmail,
                ccRecipients,
                subject: `[Ticket #${ticketForFollowup?.glpiTicketId}] ${subject}`,
                proposedContent: followupHtml,
                draftKind: 'CONVERSATION_FOLLOWUP',
                exchangeTurn: nextExchangeTurn,
                inReplyToGraphMessageId: graphMessageId,
                outlookConversationId: conversationId,
              },
            });
            await logEvent(match.ticketId, 'AI_FOLLOWUP_DRAFT_GENERATED', 'AI', {
              exchangeTurn: nextExchangeTurn,
              lowConfidenceIntent: followupDecision.lowConfidenceIntent,
              confidence: replyResult.confidence,
            });
          }
        }
      }

      // Si réouverture, noter dans GLPI
      if (match.method === 'REOPEN') {
        await logEvent(match.ticketId, 'REOPENED', fromEmail, { conversationId });
        await prisma.ticket.update({ where: { id: match.ticketId }, data: { status: 'OPEN', closedAt: null } });
      }

      const updated = await prisma.incomingEmail.update({
        where: { id: incoming.id },
        data: { status: 'DONE', erpTicketId: match.ticketId, isNewTicket: false, aiIntent: intentResult.intent },
      });

      if (io) io.emit('email_updated', updated);
      return updated;
    }

    // Couche 1 : Pré-filtre spam déterministe (sans appel LLM)
    const { checkEmailSpam } = require('./emailSpamFilter');
    const spamCheck = checkEmailSpam(headers, subject, bodyPreview, fromEmail);
    if (spamCheck.isSpam) {
      console.log(`[emailPipeline] Spam détecté par filtre déterministe: ${spamCheck.reason}`);
      const updated = await prisma.incomingEmail.update({
        where: { id: incoming.id },
        data: { status: 'SPAM', aiSummary: `Spam filtré : ${spamCheck.reason}`, aiIsSpam: true, aiConfidence: 1.0 },
      });
      if (io) io.emit('email_updated', updated);
      return updated;
    }

    // Couche 2 : Moteur de règles déterministe (sans appel LLM)
    const { evaluateRules } = require('./emailRuleEngine');
    const ruleMatch = await evaluateRules(subject, bodyPreview, fromEmail);

    let analysis;
    if (ruleMatch) {
      console.log(`[emailPipeline] Correspondance avec la règle de triage: "${ruleMatch.label}"`);
      if (ruleMatch.isSpam) {
        const updated = await prisma.incomingEmail.update({
          where: { id: incoming.id },
          data: { status: 'SPAM', aiSummary: `Spam filtré (règle) : ${ruleMatch.label}`, aiIsSpam: true, aiConfidence: 1.0 },
        });
        if (io) io.emit('email_updated', updated);
        return updated;
      }

      analysis = {
        summary: `Règle de triage appliquée : "${ruleMatch.label}"`,
        category: ruleMatch.category,
        priority: ruleMatch.ticketPriority || 'P3',
        suggestedTitle: subject.substring(0, 80),
        suggestedSkill: ruleMatch.skillName,
        confidence: 1.0,
        isSpam: false
      };
    } else {
      // Couche 3 : Fallback analyse IA pour nouveau ticket
      analysis = await analyzeEmail({ subject, body: cleanBody, from: fromEmail, fromName });
    }

    if (analysis.isSpam) {
      const updated = await prisma.incomingEmail.update({
        where: { id: incoming.id },
        data: { status: 'SPAM', aiSummary: analysis.summary, aiIsSpam: true, aiConfidence: analysis.confidence },
      });
      if (io) io.emit('email_updated', updated);
      return updated;
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
        inReplyToGraphMessageId: graphMessageId,
        outlookConversationId: conversationId,
      });

      const updated = await prisma.incomingEmail.update({
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

      if (io) io.emit('email_updated', updated);
      return updated;
    }

    // Résoudre le lieu détecté par l'IA en un ID de lieu GLPI
    let locationId = null;
    if (analysis.location) {
      const loc = await prisma.glpiLocation.findFirst({
        where: { completename: analysis.location },
        select: { glpiLocationId: true },
      });
      if (loc) locationId = loc.glpiLocationId;
    }

    // Étape 3 : créer ticket GLPI + ERP dans une transaction pour éviter l'incohérence
    const { glpiTicketId, erpTicketId } = await prisma.$transaction(async (tx) => {
      const created = await createTicketFromEmail({
        subject, body: bodyPreview, from: fromEmail, fromName, analysis, emailAccountId: account.id, locationId, tx
      });

      // Étape 4 : stocker conversationId + aiSummary sur le ticket ERP
      await tx.ticket.update({
        where: { id: created.erpTicketId },
        data: {
          aiSummary: analysis.summary,
          ...(conversationId ? { outlookConversationId: conversationId, status: 'WAITING_FOR_USER', lastUserReplyAt: receivedAt } : {}),
        },
      });

      // Étape 5 : enregistrer le message entrant
      await tx.ticketMessage.create({
        data: {
          ticketId: created.erpTicketId,
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

      await logEvent(created.erpTicketId, 'CREATED', fromEmail, { glpiTicketId: created.glpiTicketId, source: 'EMAIL' }, tx);
      await logEvent(created.erpTicketId, 'AI_ANALYZED', 'AI', { analysis }, tx);

      return created;
    });

    await processIncomingAttachments({
      account, graphMessageId, incomingEmailId: incoming.id,
      ticketId: erpTicketId, glpiTicketId,
      simulatedAttachments: message.simulatedAttachments,
      bodyText: cleanBody,
    });

    // Émettre l'événement temps réel pour les notifications
    try {
      const fullTicket = await prisma.ticket.findUnique({
        where: { id: erpTicketId },
        select: { id: true, title: true, priority: true, status: true, category: true, createdAt: true, assignedToId: true },
      });
      if (fullTicket) {
        emitTicketCreated(fullTicket);
        if (fullTicket.assignedToId) {
          emitTicketAssigned(fullTicket.id, fullTicket.title, fullTicket.assignedToId, 'ai_skills');
        }
      }
    } catch (err) {
      console.error('[emailPipeline] Échec émission socket:', err.message);
    }

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
      inReplyToGraphMessageId: graphMessageId,
      outlookConversationId: conversationId,
    });

    const updated = await prisma.incomingEmail.update({
      where: { id: incoming.id },
      data: {
        status: 'DONE', glpiTicketId, erpTicketId, isNewTicket: true,
        aiSummary: analysis.summary, aiCategory: analysis.category,
        aiPriority: analysis.priority, aiTeam: analysis.team,
        aiConfidence: analysis.confidence, aiIsSpam: false,
      },
    });
    if (io) io.emit('email_updated', updated);
  } catch (err) {
    const updated = await prisma.incomingEmail.update({ where: { id: incoming.id }, data: { status: 'ERROR', error: err.message } });
    if (io) io.emit('email_updated', updated);
  }

  return prisma.incomingEmail.findUnique({ where: { id: incoming.id } });
}

function chunkArray(array, size) {
  const chunked = [];
  for (let i = 0; i < array.length; i += size) {
    chunked.push(array.slice(i, i + size));
  }
  return chunked;
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
    
    // Parallélisation par lots de 5 pour éviter d'engorger la boucle événementielle et la BDD
    const chunks = chunkArray(messages, 5);
    for (const chunk of chunks) {
      const chunkPromises = chunk.map(m => processMessage(m, account));
      const settled = await Promise.allSettled(chunkPromises);
      
      for (const res of settled) {
        if (res.status === 'fulfilled') {
          results.push({ accountId: account.id, emailId: res.value?.id, status: res.value?.status });
        } else {
          console.error(`[emailPipeline] Erreur traitement lot (${account.emailAddress}):`, res.reason);
          results.push({ accountId: account.id, error: res.reason?.message || res.reason });
        }
      }
    }
  }
  return results;
}

module.exports = { runEmailPipeline, processMessage };
