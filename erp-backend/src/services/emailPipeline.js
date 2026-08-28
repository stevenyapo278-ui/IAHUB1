const prisma = require('../prismaClient');
const { getIO } = require('../utils/socket');
const { pollAllAccounts } = require('./emailPoller');
const { analyzeEmail } = require('./mailAnalyzer');
const { createTicketFromEmail } = require('./ticketCreator');
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
const { emitTicketCreated, emitTicketAssigned, persistNotification } = require('../utils/socket');
const { tryHandleReminderReply } = require('./draftReplyApproval');
const { getBreaker } = require('../utils/circuitBreaker');
const { isLowTrustSender } = require('./senderReputation');
const { generateEmailSummary } = require('./emailSummaryGenerator');

const MAX_RETRIES = 3;const RETRY_DELAYS_MS = [180000, 600000, 1800000]; // 3min, 10min, 30min

// ── Notification admin en cas d'échec d'analyse email ─────────────────
async function notifyAdminsEmailFailed({ incomingId, subject, fromEmail, error, retryCount, maxRetries, nextRetryAt, phase }) {
  try {
    // Trouver tous les ADMIN/SUPERADMIN actifs
    const admins = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPERADMIN'] }, isActive: true },
      select: { id: true, fullName: true },
    });
    if (!admins.length) return;

    const isDeadLetter = phase === 'dead_letter';
    const title = isDeadLetter
      ? `❌ Analyse email échouée — email en attente manuelle`
      : `⚠️ Analyse email en retry (${retryCount}/${maxRetries})`;
    const retryInfo = nextRetryAt
      ? `Prochain essai dans ${Math.round((new Date(nextRetryAt).getTime() - Date.now()) / 60000)} min. `
      : '';
    const message = `${retryInfo}Email de « ${fromEmail || 'inconnu' }` +
      ` » — Objet : « ${subject} `.trim() + `»\nErreur : ${error}`;

    // Notification persistée pour chaque admin
    for (const admin of admins) {
      await persistNotification({
        userId: admin.id,
        type: isDeadLetter ? 'EMAIL_FAILED' : 'EMAIL_RETRY',
        title,
        message,
        link: '/inbox',
        metadata: { incomingId, subject, fromEmail, error, retryCount, phase },
      });
    }

    // Événement socket pour alerte temps réel
    if (io) {
      io.to('notifications').emit('email_analysis_failed', {
        incomingId,
        subject,
        fromEmail,
        error,
        retryCount,
        maxRetries,
        phase,
        nextRetryAt,
      });
    }
  } catch (err) {
    console.error('[emailPipeline] Erreur notification admin:', err.message);
  }
}


function isTransientError(err) {
  const msg = (err?.message || '').toLowerCase();
  const status = err?.status || err?.response?.status;
  return (
    status === 429 ||
    status >= 500 ||
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('too many requests') ||
    msg.includes('rate limit') ||
    msg.includes('service unavailable') ||
    msg.includes('temporarily') ||
    msg.includes('circuit_open')
  );
}

// Selon le réglage "Auto-envoi des emails sans validation humaine" (Paramètres > Automatisation) :
// envoie directement l'email, ou crée un AiEmailDraft en attente d'approbation comme aujourd'hui.
async function dispatchOrQueueEmail({ ticketId, recipientEmail, ccRecipients, subject, html, draftType, inReplyToGraphMessageId, outlookConversationId }) {
  const settings = await getSystemSettings();
  if (settings.autoSendAiEmails) {
    await sendEmail({ ticketId, to: recipientEmail, cc: ccRecipients, subject, bodyHtml: html, saveAsMessage: true, inReplyToGraphMessageId, conversationId: outlookConversationId });
    await logEvent(ticketId, 'EMAIL_SENT', 'AI', { to: recipientEmail, cc: ccRecipients, subject, autoSent: true });
  } else {
    await prisma.aiEmailDraft.create({
      data: { ticketId, recipientEmail, ccRecipients, subject, proposedContent: html, inReplyToGraphMessageId, outlookConversationId },
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

  let analysis = null;

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
      const ticketMsg = await prisma.ticketMessage.create({
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
          summary: analysis?.summary || null,
          ticketStatusAtTime: ticket?.status || null,
        },
      });

      // Générer le résumé IA en arrière-plan si pas encore disponible
      if (!ticketMsg.summary) {
        generateEmailSummary({ body: cleanBody, direction: 'INBOUND' })
          .then((summary) => {
            if (summary) return prisma.ticketMessage.update({ where: { id: ticketMsg.id }, data: { summary } });
          })
          .catch(() => {});
      }

      const { cidMap } = await processIncomingAttachments({
        account, graphMessageId, incomingEmailId: incoming.id,
        ticketId: match.ticketId,
        simulatedAttachments: message.simulatedAttachments,
        bodyText: cleanBody,
      });

      const rewrittenHtml = rewriteCidRefs(ticketMsg.bodyHtml, cidMap);
      if (rewrittenHtml !== ticketMsg.bodyHtml) {
        await prisma.ticketMessage.update({
          where: { id: ticketMsg.id },
          data: { bodyHtml: rewrittenHtml },
        });
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
        ticketId: match.ticketId, // pour injecter les rejets récents dans le prompt
        headers,
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
                recipientEmail: fromEmail,
                ccRecipients,
                subject: `[Ticket #${match.ticketId}] ${subject}`,
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

    // Couche 1 : Pré-filtre spam et mails d'information déterministe (sans appel LLM)
    const { checkEmailSpam } = require('./emailSpamFilter');
    const spamCheck = checkEmailSpam(headers, subject, bodyPreview, fromEmail);
    if (spamCheck.isSpam) {
      const targetStatus = spamCheck.isInformational ? 'INFORMATIONAL' : 'SPAM';
      console.log(`[emailPipeline] Email filtré (${targetStatus}) par filtre déterministe: ${spamCheck.reason}`);
      const updated = await prisma.incomingEmail.update({
        where: { id: incoming.id },
        data: { status: targetStatus, aiSummary: `Filtré (${targetStatus}) : ${spamCheck.reason}`, aiIsSpam: true, aiConfidence: 1.0, aiIntent: 'INFORMATIONAL' },
      });
      if (io) io.emit('email_updated', updated);
      return updated;
    }

    // Couche 2 : Moteur de règles déterministe (sans appel LLM)
    const { evaluateRules } = require('./emailRuleEngine');
    const ruleMatch = await evaluateRules(subject, bodyPreview, fromEmail);

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

      const rawRuleAnalysis = {
        summary: `Règle de triage appliquée : "${ruleMatch.label}"`,
        category: ruleMatch.category,
        impact: ruleMatch.impact || 'MEDIUM',
        urgency: ruleMatch.urgency || 'MEDIUM',
        suggestedTitle: subject.substring(0, 80),
        suggestedSkill: ruleMatch.skillName,
        confidence: 1.0,
        ticketDecision: 'CREATE',
        emailType: 'HUMAN_REQUEST',
        requestType: 'INCIDENT',
        isSpam: false,
        isInformational: false,
        requiresAction: true,
      };

      const { validateAndCleanAnalysis } = require('./emailAnalysisValidator');
      analysis = validateAndCleanAnalysis(rawRuleAnalysis, [], [], { body: cleanBody });
      if (ruleMatch.ticketPriority) analysis.priority = ruleMatch.ticketPriority;
    } else {
      // Couche 3 : Fallback analyse IA pour nouveau ticket
      analysis = await analyzeEmail({ subject, body: cleanBody, from: fromEmail, fromName });
    }

    // Bloquer la création de ticket si l'IA ou le filtre détecte un email d'information, un spam ou DO_NOT_CREATE
    if (analysis.isSpam || analysis.isInformational === true || analysis.requiresAction === false || analysis.ticketDecision === 'DO_NOT_CREATE') {
      const targetStatus = (analysis.isSpam || analysis.emailType === 'SPAM') ? 'SPAM' : 'INFORMATIONAL';
      console.log(`[emailPipeline] Email d'information ou hors périmètre support filtré (${targetStatus}) par l'IA (motif: ${analysis.decisionReason || 'INFO'}, résumé: "${analysis.summary}")`);
      const updated = await prisma.incomingEmail.update({
        where: { id: incoming.id },
        data: {
          status: targetStatus,
          aiSummary: analysis.summary || 'Email d\'information filtré par l\'IA',
          aiCategory: analysis.category || null,
          aiPriority: 'P4',
          aiConfidence: analysis.confidence || 1.0,
          aiIsSpam: true,
          aiIntent: analysis.decisionReason || 'INFORMATIONAL',
        },
      });
      if (io) io.emit('email_updated', updated);
      return updated;
    }

    // Traitement des e-mails ambigus ou à faible confiance (NEEDS_REVIEW)
    if (analysis.ticketDecision === 'NEEDS_REVIEW') {
      console.log(`[emailPipeline] Email ambigu ou confiance faible (confiance: ${analysis.confidence}), marqué pour révision Hotline`);
      const updated = await prisma.incomingEmail.update({
        where: { id: incoming.id },
        data: {
          status: 'NEEDS_REVIEW',
          aiSummary: analysis.summary || 'Email nécessitant une révision Hotline',
          aiCategory: analysis.category || null,
          aiPriority: analysis.priority || 'P3',
          aiConfidence: analysis.confidence || 0.5,
          aiIsSpam: false,
          aiIntent: 'NEEDS_REVIEW',
        },
      });
      if (io) io.emit('email_updated', updated);
      return updated;
    }

    // Étape 2b : détecter un incident similaire déjà ouvert (même problème, autre site/magasin)
    const similarMatch = await findSimilarOpenTicket({
      subject, body: cleanBody, category: analysis.category,
    });      if (similarMatch) {
      // Rattacher cet email au ticket similaire existant
      const similarTicket = await prisma.ticket.findUnique({ where: { id: similarMatch.ticketId }, select: { status: true } });
      const similarSummary = analysis?.summary || null;
      const ticketMsg = await prisma.ticketMessage.create({
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
          summary: similarSummary,
          ticketStatusAtTime: similarTicket?.status || null,
        },
      });

      // Générer le résumé IA en arrière-plan si pas encore disponible
      if (!ticketMsg.summary) {
        generateEmailSummary({ body: cleanBody, direction: 'INBOUND' })
          .then((summary) => {
            if (summary) return prisma.ticketMessage.update({ where: { id: ticketMsg.id }, data: { summary } });
          })
          .catch(() => {});
      }

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
        select: { impactedSites: true, isMajorIncident: true },
      });

      const { cidMap } = await processIncomingAttachments({
        account, graphMessageId, incomingEmailId: incoming.id,
        ticketId: similarMatch.ticketId,
        simulatedAttachments: message.simulatedAttachments,
        bodyText: cleanBody,
      });

      const rewrittenHtml = rewriteCidRefs(ticketMsg.bodyHtml, cidMap);
      if (rewrittenHtml !== ticketMsg.bodyHtml) {
        await prisma.ticketMessage.update({
          where: { id: ticketMsg.id },
          data: { bodyHtml: rewrittenHtml },
        });
      }

      // Notification "incident déjà connu" — envoyée directement ou mise en attente d'approbation
      // selon le réglage Paramètres > Automatisation > Auto-envoi des emails IA.
      const knownIncidentHtml = buildKnownIncidentNotificationHtml({
        toName: fromName,
        originalSubject: similarMatch.ticketTitle,
        isMajor: updatedTicket.isMajorIncident,
        impactedCount: updatedTicket.impactedSites.length,
        signature: await getEmailSignature(),
      });
      await dispatchOrQueueEmail({
        ticketId: similarMatch.ticketId,
        recipientEmail: fromEmail,
        ccRecipients,
        subject: `[Ticket #${similarMatch.ticketId}] ${similarMatch.ticketTitle}`,
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

    // Résoudre le lieu : 1) fallback RequesterLocation (historique du demandeur), 2) suggestion IA
    let locationId = null;
    let resolvedLocationName = null; // nom du lieu finalement retenu (pour cohérence du titre)

    // 1. Fallback RequesterLocation — si on a déjà associé cet email à un lieu, l'utiliser
    //    Cela évite de devoir deviner le lieu à chaque fois pour un demandeur connu.
    if (!locationId && fromEmail) {
      const knownLocation = await prisma.requesterLocation.findFirst({
        where: { email: fromEmail.toLowerCase().trim() },
        orderBy: { lastUsedAt: 'desc' },
        select: { glpiLocationId: true, glpiLocation: { select: { id: true, name: true, completename: true } } },
      });
      if (knownLocation?.glpiLocation) {
        locationId = knownLocation.glpiLocation.id;
        resolvedLocationName = knownLocation.glpiLocation.name || knownLocation.glpiLocation.completename;
        // Mettre à jour le compteur et la date de dernière utilisation
        await prisma.requesterLocation.updateMany({
          where: { email: fromEmail.toLowerCase().trim() },
          data: { lastUsedAt: new Date(), assignmentCount: { increment: 1 } },
        }).catch(() => {});
        console.log(`[emailPipeline] Lieu résolu via historique demandeur : "${resolvedLocationName}" pour ${fromEmail}`);
      }
    }

    // 2. Suggestion IA (peut override l'historique du demandeur si l'IA trouve mieux)
    if (analysis.location) {
      const loc = await prisma.glpiLocation.findFirst({
        where: { completename: analysis.location },
        select: { id: true, name: true, completename: true },
      });
      if (loc) {
        // Si l'IA a trouvé un lieu différent de l'historique, on le note mais on garde l'historique
        // (l'historique est plus fiable que la devinette IA)
        if (locationId && locationId !== loc.id) {
          console.log(`[emailPipeline] Lieu IA "${loc.completename}" ignoré — lieu historique "${resolvedLocationName}" conservé`);
        } else {
          locationId = loc.id;
          resolvedLocationName = loc.name || loc.completename;
        }
      }
    }

    // 3. Créer/mettre à jour l'association RequesterLocation si on a résolu un lieu
    if (locationId && fromEmail) {
      await prisma.requesterLocation.upsert({
        where: { email_glpiLocationId: { email: fromEmail.toLowerCase().trim(), glpiLocationId: locationId } },
        update: { lastUsedAt: new Date(), assignmentCount: { increment: 1 } },
        create: { email: fromEmail.toLowerCase().trim(), glpiLocationId: locationId },
      }).catch(() => {});
    }

    // 2. Aligner le titre avec le lieu résolu pour éviter toute incohérence SITE ≠ LIEU
    //    Si le titre IA contient " : " (format "SITE : ACTION"), on remplace la partie SITE
    //    par le nom du lieu réellement assigné dès lors que les deux diffèrent.
    if (resolvedLocationName && analysis.suggestedTitle && analysis.suggestedTitle.includes(' : ')) {
      const colonIdx = analysis.suggestedTitle.indexOf(' : ');
      const aiSite = analysis.suggestedTitle.substring(0, colonIdx).trim().toUpperCase();
      const action = analysis.suggestedTitle.substring(colonIdx + 3).trim();
      const resolvedSiteUpper = resolvedLocationName.toUpperCase();
      if (aiSite !== resolvedSiteUpper) {
        // Reconstruire le titre avec le lieu réel plutôt que celui deviné par l'IA
        analysis.suggestedTitle = `${resolvedLocationName} : ${action}`.substring(0, 80);
        console.log(`[emailPipeline] Titre aligné sur le lieu résolu : "${analysis.suggestedTitle}" (site IA "${aiSite}" → "${resolvedLocationName}")`);
      }
    }

    // Étape 3 : créer ticket ERP dans une transaction
    const lowTrustSender = await isLowTrustSender(fromEmail).catch(() => false);

    const { erpTicketId, ticketMessageId } = await prisma.$transaction(async (tx) => {
      const created = await createTicketFromEmail({
        subject, body: bodyPreview, from: fromEmail, fromName, analysis, emailAccountId: account.id, locationId, lowTrustSender, tx,
        escalateMinutes: ruleMatch?.autoEscalateMinutes || null,
        triageRuleId: ruleMatch?.id || null,
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
      const initialStatus = conversationId ? 'WAITING_FOR_USER' : 'NEW';
      const ticketMsg = await tx.ticketMessage.create({
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
          summary: analysis?.summary || null,
          ticketStatusAtTime: initialStatus,
        },
      });

      await logEvent(created.erpTicketId, 'CREATED', fromEmail, { source: 'EMAIL' }, tx);
      await logEvent(created.erpTicketId, 'AI_ANALYZED', 'AI', { analysis }, tx);

      // Expéditeur dégradé par la boucle de rétroaction (taux de rejets élevé) : tracer pour la Hotline
      if (lowTrustSender) {
        await logEvent(created.erpTicketId, 'AI_LOW_TRUST_SENDER', 'SYSTEM', {
          note: `Expéditeur ${fromEmail} dégradé par la boucle de rétroaction (taux de rejets élevé) — ticket marqué à risque`,
        }, tx);
      }

      return { ...created, ticketMessageId: ticketMsg.id };
    });

    const { cidMap } = await processIncomingAttachments({
      account, graphMessageId, incomingEmailId: incoming.id,
      ticketId: erpTicketId,
      simulatedAttachments: message.simulatedAttachments,
      bodyText: cleanBody,
    });

    // Réécrit les références cid: dans le bodyHtml pour pointer vers le proxy GLPI
    if (ticketMessageId && cidMap && Object.keys(cidMap).length > 0) {
      const ticketMsg = await prisma.ticketMessage.findUnique({
        where: { id: ticketMessageId },
        select: { bodyHtml: true },
      });
      if (ticketMsg) {
        const rewrittenHtml = rewriteCidRefs(ticketMsg.bodyHtml, cidMap);
        if (rewrittenHtml !== ticketMsg.bodyHtml) {
          await prisma.ticketMessage.update({
            where: { id: ticketMessageId },
            data: { bodyHtml: rewrittenHtml },
          });
        }
      }
    }

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
      ticketId: erpTicketId,
      originalSubject: subject,
      customMessage: pipelineSettings.acknowledgementMessage,
      signature: await getEmailSignature(),
    });
    await dispatchOrQueueEmail({
      ticketId: erpTicketId,
      recipientEmail: fromEmail,
      ccRecipients,
      subject: `[Ticket #${erpTicketId}] ${subject}`,
      html: acknowledgementHtml,
      draftType: 'ACKNOWLEDGEMENT',
      inReplyToGraphMessageId: graphMessageId,
      outlookConversationId: conversationId,
    });

    const updated = await prisma.incomingEmail.update({
      where: { id: incoming.id },
      data: {
        status: 'DONE', erpTicketId, isNewTicket: true,
        aiSummary: analysis.summary, aiCategory: analysis.category,
        aiPriority: analysis.priority, aiTeam: analysis.team,
        aiConfidence: analysis.confidence, aiIsSpam: false,
      },
    });
    if (io) io.emit('email_updated', updated);
  } catch (err) {
    const isTransient = isTransientError(err);
    const currentRetryCount = incoming.retryCount || 0;

    if (isTransient && currentRetryCount < MAX_RETRIES) {
      const nextDelay = RETRY_DELAYS_MS[currentRetryCount] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      const updated = await prisma.incomingEmail.update({
        where: { id: incoming.id },
        data: {
          status: 'RETRY',
          error: err.message,
          lastError: err.message,
          retryCount: currentRetryCount + 1,
          nextRetryAt: new Date(Date.now() + nextDelay),
        },
      });
      if (io) io.emit('email_updated', updated);
      // Notification admin pour chaque retry
      await notifyAdminsEmailFailed({
        incomingId: incoming.id,
        subject: subject || 'Objet inconnu',
        fromEmail,
        error: err.message,
        retryCount: currentRetryCount + 1,
        maxRetries: MAX_RETRIES,
        nextRetryAt: updated.nextRetryAt,
        phase: 'retry',
      });
      logger?.warn?.('[emailPipeline] Erreur transitoire, mise en file d\'attente de réessai', {
        incomingId: incoming.id, retryCount: currentRetryCount + 1, nextRetryAt: updated.nextRetryAt, error: err.message,
      }) || console.warn(`[emailPipeline] Retry ${currentRetryCount + 1}/${MAX_RETRIES} pour incoming #${incoming.id} dans ${nextDelay / 1000}s`);
    } else {
      const deadLetter = !isTransient || currentRetryCount >= MAX_RETRIES;
      const updated = await prisma.incomingEmail.update({
        where: { id: incoming.id },
        data: {
          status: deadLetter ? 'DEAD_LETTER' : 'ERROR',
          error: err.message,
          lastError: err.message,
          retryCount: currentRetryCount + (deadLetter ? 0 : 1),
        },
      });
      if (io) io.emit('email_updated', updated);
      console.error(`[emailPipeline] ${deadLetter ? 'DEAD_LETTER' : 'ERROR'} incoming #${incoming.id}:`, err.message);
      // Notification admin pour échec définitif
      await notifyAdminsEmailFailed({
        incomingId: incoming.id,
        subject: subject || 'Objet inconnu',
        fromEmail,
        error: err.message,
        retryCount: currentRetryCount + (deadLetter ? 0 : 1),
        maxRetries: MAX_RETRIES,
        nextRetryAt: null,
        phase: deadLetter ? 'dead_letter' : 'error',
      });
    }
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

function rewriteCidRefs(html, cidMap) {
  if (!html || !cidMap || Object.keys(cidMap).length === 0) return html;
  return html.replace(/cid:([^"'>\s]+)/gi, (match, cid) => {
    const docId = cidMap[cid];
    return docId ? `/glpi/document/${docId}/file` : match;
  });
}

module.exports = { runEmailPipeline, processMessage };
