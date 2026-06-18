const prisma = require('../prismaClient');
const { pollAllAccounts } = require('./emailPoller');
const { analyzeEmail } = require('./mailAnalyzer');
const { createTicketFromEmail } = require('./glpiTicketCreator');
const { findExistingTicket } = require('./conversationMatcher');
const { findSimilarOpenTicket, attachSiteToTicket, saveTicketEmbedding } = require('./similarIncidentDetector');
const { analyzeIntent, applyIntentActions } = require('./intentAnalyzer');
const { sendAcknowledgement, sendKnownIncidentNotification } = require('./emailSender');
const { logEvent } = require('./ticketEvent');

const MESSAGE_SELECT = 'id,subject,from,toRecipients,receivedDateTime,bodyPreview,body,conversationId,internetMessageId,inReplyTo,references';

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
  const inReplyTo = message.inReplyTo || null;
  const references = message.references || null;

  const existing = await prisma.incomingEmail.findUnique({ where: { graphMessageId } });
  if (existing) return existing;

  const incoming = await prisma.incomingEmail.create({
    data: {
      graphMessageId, internetMessageId, conversationId, inReplyTo, references,
      emailAccountId: account.id, fromEmail, fromName, subject,
      bodyPreview, bodyHtml, receivedAt, status: 'PROCESSING',
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
          recipients: [account.emailAddress],
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

      await logEvent(match.ticketId, 'EMAIL_RECEIVED', fromEmail, { subject, method: match.method });

      // Analyser l'intention de la réponse
      const intent = await analyzeIntent({
        subject, body: bodyPreview,
        ticketTitle: ticket?.title,
        ticketSummary: ticket?.aiSummary,
      });

      await applyIntentActions(match.ticketId, intent, fromEmail);

      // Si réouverture, noter dans GLPI
      if (match.method === 'REOPEN') {
        await logEvent(match.ticketId, 'REOPENED', fromEmail, { conversationId });
        await prisma.ticket.update({ where: { id: match.ticketId }, data: { status: 'OPEN', closedAt: null } });
      }

      await prisma.incomingEmail.update({
        where: { id: incoming.id },
        data: { status: 'DONE', erpTicketId: match.ticketId, isNewTicket: false, aiIntent: intent },
      });

      return prisma.incomingEmail.findUnique({ where: { id: incoming.id } });
    }

    // Étape 2 : analyse IA pour nouveau ticket
    const analysis = await analyzeEmail({ subject, body: bodyPreview, from: fromEmail, fromName });

    if (analysis.isSpam) {
      await prisma.incomingEmail.update({
        where: { id: incoming.id },
        data: { status: 'SPAM', aiSummary: analysis.summary, aiIsSpam: true, aiConfidence: analysis.confidence },
      });
      return prisma.incomingEmail.findUnique({ where: { id: incoming.id } });
    }

    // Étape 2b : détecter un incident similaire déjà ouvert (même problème, autre site/magasin)
    const similarMatch = await findSimilarOpenTicket({
      subject, body: bodyPreview, category: analysis.category,
    });

    if (similarMatch) {
      // Rattacher cet email au ticket similaire existant
      await prisma.ticketMessage.create({
        data: {
          ticketId: similarMatch.ticketId,
          direction: 'INBOUND',
          sender: fromEmail,
          recipients: [account.emailAddress],
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

      // Envoyer notification "incident déjà connu" si Outlook configuré
      try {
        await sendKnownIncidentNotification({
          ticketId: similarMatch.ticketId,
          glpiTicketId: updatedTicket.glpiTicketId,
          toEmail: fromEmail,
          toName: fromName,
          originalSubject: similarMatch.ticketTitle,
          isMajor: updatedTicket.isMajorIncident,
          impactedCount: updatedTicket.impactedSites.length,
        });
      } catch {
        // Outlook non configuré — silencieux
      }

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

    // Étape 3 : créer ticket GLPI + ERP
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
        recipients: [account.emailAddress],
        subject, body: bodyPreview, bodyHtml,
        outlookMessageId: graphMessageId,
        internetMessageId, inReplyTo, conversationId,
        timestamp: receivedAt,
      },
    });

    await logEvent(erpTicketId, 'CREATED', fromEmail, { glpiTicketId, source: 'EMAIL' });
    await logEvent(erpTicketId, 'AI_ANALYZED', 'AI', { analysis });

    // Sauvegarder l'embedding pour la détection future d'incidents similaires
    await saveTicketEmbedding(erpTicketId, subject, bodyPreview);

    // Étape 6 : accusé de réception
    try {
      await sendAcknowledgement({ ticketId: erpTicketId, glpiTicketId, toEmail: fromEmail, toName: fromName, originalSubject: subject });
    } catch (e) {
      console.error('[emailPipeline] Accusé de réception échoué:', e.message);
    }

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
    if (error) { results.push({ accountId: account.id, error }); continue; }
    for (const message of messages) {
      const result = await processMessage(message, account);
      results.push({ accountId: account.id, emailId: result?.id, status: result?.status });
    }
  }
  return results;
}

module.exports = { runEmailPipeline, processMessage };
