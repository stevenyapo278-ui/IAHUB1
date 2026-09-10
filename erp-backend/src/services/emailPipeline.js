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
const { sendAcknowledgement, sendEmail } = require('./emailSender');
const { notifyNewPendingTicket } = require('./approvalReminderScheduler');
const { processIncomingAttachments } = require('./emailAttachmentProcessor');
const { stripSignature } = require('./signatureStripper');
const { logEvent } = require('./ticketEvent');
const { getSystemSettings } = require('./systemSettings');
const { emitTicketCreated, emitTicketAssigned, persistNotification, userHasPermission } = require('../utils/socket');
const { tryHandleReminderReply } = require('./draftReplyApproval');
const { getBreaker } = require('../utils/circuitBreaker');
const { htmlToText } = require('../utils/htmlToText');
const { isLowTrustSender } = require('./senderReputation');

// Wrapper pour appliquer les inbox rules sur TOUS les emails, quelle que soit l'issue du pipeline.
// Évite la duplication du try/catch à chaque point de sortie.
async function applyInboxRulesSafe(updated, context) {
  try {
    const matchedRule = await applyRulesToEmail(updated);
    if (matchedRule) {
      console.log(`[emailPipeline] Règle "${matchedRule.label}" appliquée sur email #${updated.id} (${context})`);
    }
  } catch (ruleErr) {
    console.error(`[emailPipeline] Erreur application règles sur email #${updated.id} (${context}):`, ruleErr.message);
  }
  return updated;
}
const { generateEmailSummary } = require('./emailSummaryGenerator');
const { applyRulesToEmail } = require('./inboxRuleEngine');
const { detectLocationFromSender, extractSignatureZone } = require('./locationDetector');
const { formatTicketTitle, UNDETERMINED } = require('../utils/ticketTitle');

const MAX_RETRIES = 3;const RETRY_DELAYS_MS = [180000, 600000, 1800000]; // 3min, 10min, 30min

// ── Notification admin en cas d'échec d'analyse email ─────────────────
async function notifyAdminsEmailFailed({ incomingId, subject, fromEmail, error, errorDetail, retryCount, maxRetries, nextRetryAt, phase }) {
  try {
    // Trouver tous les ADMIN/SUPERADMIN actifs
    const admins = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPERADMIN'] }, isActive: true },
      select: { id: true, fullName: true },
    });
    if (!admins.length) return;

    // Filtrer : seuls les admins avec la permission 'inbox.sync' reçoivent la notification
    const eligibleAdmins = [];
    for (const admin of admins) {
      if (await userHasPermission(admin.id, 'inbox.sync')) {
        eligibleAdmins.push(admin);
      }
    }
    if (!eligibleAdmins.length) return;

    const isDeadLetter = phase === 'dead_letter';
    const title = isDeadLetter
      ? `❌ Analyse email échouée — email en attente manuelle`
      : `⚠️ Analyse email en retry (${retryCount}/${maxRetries})`;
    const retryInfo = nextRetryAt
      ? `Prochain essai dans ${Math.round((new Date(nextRetryAt).getTime() - Date.now()) / 60000)} min. `
      : '';
    const message = `${retryInfo}Email de « ${fromEmail || 'inconnu' }` +
      ` » — Objet : « ${subject} `.trim() + `»\nErreur : ${error}`;

    // Notification persistée pour chaque admin éligible (avec la permission 'inbox.sync')
    for (const admin of eligibleAdmins) {
      await persistNotification({
        userId: admin.id,
        type: isDeadLetter ? 'EMAIL_FAILED' : 'EMAIL_RETRY',
        title,
        message,
        link: '/inbox',
        metadata: { incomingId, subject, fromEmail, error, retryCount, phase },
      });
    }

    // Événement socket pour alerte temps réel — ciblé sur la room personnelle des seuls admins
    // éligibles (jamais la room broadcast 'notifications', qui contient tous les comptes avec
    // 'tickets.view' mais pas forcément la permission 'inbox.sync').
    const io = getIO();
    if (io) {
      const payload = {
        incomingId,
        subject,
        fromEmail,
        error,
        errorDetail,
        retryCount,
        maxRetries,
        phase,
        nextRetryAt,
      };
      for (const admin of eligibleAdmins) {
        io.to(`user:${admin.id}`).emit('email_analysis_failed', payload);
      }
    }

    // ── Email de notification aux adresses configurées ──────────────────
    const settings = await getSystemSettings();
    const recipientList = (settings?.emailFailureNotificationRecipients || []).length > 0
      ? settings.emailFailureNotificationRecipients
      : (settings?.emailFailureNotificationEmail || '').split(/[,;]/).map(e => e.trim()).filter(Boolean);

    if (recipientList.length > 0) {
      const { sendEmail: sendEmailNotification } = require('./emailSender');
      const retryInfoLine = nextRetryAt
        ? `<p>Prochain essai automatique dans <strong>${Math.round((new Date(nextRetryAt).getTime() - Date.now()) / 60000)} min</strong>.</p>`
        : '';
      const detailBlock = errorDetail
        ? `<blockquote style="border-left:3px solid #e53e3e;margin:12px 0;padding:8px 16px;color:#444;white-space:pre-wrap;font-size:13px">${errorDetail}</blockquote>`
        : `<blockquote style="border-left:3px solid #e53e3e;margin:12px 0;padding:8px 16px;color:#444">${error}</blockquote>`;
      const bodyHtml = `
<p>Bonjour,</p>
<p>Un email entrant n'a pas pu être traité par l'IA.</p>
<table style="border-collapse:collapse;margin:12px 0;font-size:13px">
  <tr><td style="padding:4px 12px;font-weight:bold">Expéditeur</td><td style="padding:4px 12px">${fromEmail || 'inconnu'}</td></tr>
  <tr><td style="padding:4px 12px;font-weight:bold">Objet</td><td style="padding:4px 12px">${subject || '(sans objet)'}</td></tr>
  <tr><td style="padding:4px 12px;font-weight:bold">Statut</td><td style="padding:4px 12px">${isDeadLetter ? 'Échec définitif' : `Relance (${retryCount}/${maxRetries})`}</td></tr>
</table>
${retryInfoLine}
<p>Détail de l'erreur :</p>
${detailBlock}
<p>Vous pouvez relancer le traitement manuellement depuis l'<a href="${settings?.frontendUrl || 'http://localhost:3000'}/inbox">Inbox</a>.</p>
`.trim();
      const subjectLine = `${isDeadLetter ? '❌' : '⚠️'} Email non traité — ${subject || '(sans objet)'}`;
      for (const notifyEmail of recipientList) {
        await sendEmailNotification({ to: notifyEmail, subject: subjectLine, bodyHtml, saveAsMessage: false })
          .catch((e) => console.error(`[emailPipeline] Échec envoi email notification vers ${notifyEmail}:`, e.message));
      }
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
  // Flag positionné par les routes unspam : indique que l'email est retraitement d'un SPAM
  // et que les règles de triage spam (couche 2) doivent être byspassées pour cette passe.
  const bypassSpamRules = message.bypassSpamRules === true;

  // ── Garde anti-boucle (1/2) : message émis par la boîte support elle-même ──
  // Cas typique : l'IA répond à un message dont le To contient la boîte de diffusion dont
  // elle est membre — Outlook lui re-delivre sa propre réponse comme un « nouveau » message
  // (nouveau graphMessageId → échappe à la déduplication). Sans ce garde, analyse → réponse
  // → re-analyse → … en boucle. Les auto-réponses externes (OOO) restent gérées en aval par
  // l'analyseur d'intention (isAutoReply → AI_AUTO_REPLY_IGNORED).
  const selfAddrNorm = (account?.emailAddress || '').toLowerCase().trim();
  if (selfAddrNorm && fromEmail.toLowerCase().trim() === selfAddrNorm) {
    console.warn(`[emailPipeline] Message de la boîte support elle-même ignoré (anti-boucle) : "${subject}"`);
    return null;
  }

  const existing = await prisma.incomingEmail.findUnique({ where: { graphMessageId } });
  // Mode retraitement (unspam) : si l'email est déjà en DB et qu'on bypasse les règles spam,
  // on continue le traitement en utilisant l'enregistrement existant (pas de doublon créé).
  if (existing && !bypassSpamRules) return existing;

  // ── Garde anti-boucle (2/2) : écho via boîte de diffusion ──
  // Quand la réponse de l'IA repasse par le groupe de diffusion, la copie re-délivrée dans la
  // boîte a un NOUVEAU graphMessageId mais le MÊME internetMessageId RFC que l'envoi original
  // (conservé sur le TicketMessage OUTBOUND à l'envoi). Une demande « légitimement dupliquée »
  // (même message reçu deux fois) partage aussi ce couple — dans les deux cas, il n'y a rien
  // à analyser : on ignore, et on trace l'événement sur le ticket si le fil est connu.
  if (internetMessageId) {
    const ownSend = await prisma.ticketMessage.findFirst({
      where: { internetMessageId, direction: 'OUTBOUND' },
      select: { id: true, ticketId: true },
    });
    if (ownSend) {
      console.warn(`[emailPipeline] Écho de notre propre envoi ignoré (anti-boucle) : "${subject}" (internetMessageId=${internetMessageId})`);
      if (ownSend.ticketId) {
        logEvent(ownSend.ticketId, 'EMAIL_LOOP_SKIPPED', 'SYSTEM', {
          internetMessageId,
          subject,
          method: 'ECHO_DETECTED',
          note: 'Copie de notre propre réponse revenue via boîte de diffusion — ignorée, aucune ré-analyse.',
        }).catch(() => {});
      }
      return null;
    }
  }

  // Réponse d'un responsable à un email de relance de brouillon ("j'approuve"/"je rejette") —
  // traité à part, ne doit pas créer de IncomingEmail/ticket (ce n'est pas une demande utilisateur).
  if (await tryHandleReminderReply({ inReplyTo, bodyPreview })) {
    return null;
  }

  // Corps nettoyé de la signature/disclaimer, calculé une seule fois ici et réutilisé par toutes
  // les analyses IA en aval (intention, filtrage des images, résumé) pour éviter qu'elles soient
  // biaisées par le texte de signature répété à chaque message du fil.
  // IMPORTANT — fils transférés ("FYI") : bodyPreview de Graph ne fait que ~255 caractères. Quand un
  // demandeur transfère une CONVERSATION ENTIÈRE vers l'adresse support, la vraie demande est plus
  // bas dans le fil. On convertit donc le bodyHtml complet en texte et on l'utilise si le preview
  // ne couvre qu'une petite partie du contenu réel.
  const fullThreadText = htmlToText(bodyHtml);
  const previewIsTruncated = fullThreadText.length > bodyPreview.length + 100; // marge : évite de remplacer par du bruit HTML
  const bodyForAnalysis = previewIsTruncated ? fullThreadText : bodyPreview;
  let cleanBody = await stripSignature(bodyForAnalysis);
  // Zone de signature (texte retiré par le stripper, ou fin du message en fallback) —
  // utilisée pour la détection STRICTE du lieu (signature + adresse email vs table Location)
  // et transmise à l'IA d'analyse pour la même comparaison.
  const signatureText = extractSignatureZone(bodyForAnalysis, cleanBody);

  let analysis = null;

  // En mode retraitement (bypassSpamRules), on réutilise l'enregistrement existant plutôt que d'en créer un.
  // Sinon on crée un nouvel enregistrement normalement.
  const incoming = existing ?? await prisma.incomingEmail.create({
    data: {
      graphMessageId, internetMessageId, conversationId, inReplyTo, references,
      emailAccountId: account.id, fromEmail, fromName, subject,
      bodyPreview, bodyHtml, receivedAt, status: 'PROCESSING',
      ccRecipients, hasAttachments,
    },
  });

  let cidMap = {};
  let savedAttachments = [];
  if (hasAttachments) {
    try {
      const attRes = await processIncomingAttachments({
        account,
        graphMessageId,
        incomingEmailId: incoming.id,
        ticketId: null,
        simulatedAttachments: message.simulatedAttachments,
        bodyText: cleanBody,
      });
      cidMap = attRes.cidMap || {};
      savedAttachments = attRes.saved || [];
      if (Object.keys(cidMap).length > 0) {
        const rewrittenIncomingHtml = rewriteCidRefs(incoming.bodyHtml, cidMap);
        if (rewrittenIncomingHtml !== incoming.bodyHtml) {
          await prisma.incomingEmail.update({
            where: { id: incoming.id },
            data: { bodyHtml: rewrittenIncomingHtml },
          });
          incoming.bodyHtml = rewrittenIncomingHtml;
        }
      }
    } catch (attErr) {
      console.warn(`[emailPipeline] Échec traitement pièces jointes incoming #${incoming.id}:`, attErr.message);
    }
  }

  // ── ANALYSE VISION IA DES CAPTURES D'ÉCRAN / IMAGES JOINTES ──
  // Si l'e-mail contient des images (captures d'écran), on extrait leur contenu par Vision IA
  // pour que toutes les analyses IA en aval (catégorisation, règles, résumé, tickets) disposent
  // du texte et du contexte visuel de la demande, même si le texte du mail est vide ou minimal.
  const imageAttachments = (savedAttachments || []).filter(
    (a) => a && a.localFilepath && (a.mimeType || '').startsWith('image/')
  );
  if (imageAttachments.length > 0) {
    try {
      const { analyzeImageAttachments } = require('./mailAnalyzer');
      const imageAnalysisText = await analyzeImageAttachments(imageAttachments.slice(0, 3));
      if (imageAnalysisText) {
        console.log(`[emailPipeline] ${imageAttachments.length} capture(s) d'écran analysée(s) par Vision IA pour l'email #${incoming.id}`);
        cleanBody = cleanBody ? `${cleanBody}\n\n${imageAnalysisText}` : imageAnalysisText;
      }
    } catch (imgErr) {
      console.warn(`[emailPipeline] Échec analyse vision des images:`, imgErr.message);
    }
  }

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

            // Brouillon stocké BRUT (replyHtml de l'IA, sans gabarit) : le gabarit commun
            // (bandeau « Réponse à votre demande » + signature) est ajouté au moment de
            // l'ENVOI (wrapDraftContentForSend, voir emailSender.js), pour que la signature
            // soit toujours celle du jour — même si elle change entre la génération du
            // brouillon et son approbation. Le placeholder #EN_ATTENTE reste remplacé par
            // le vrai numéro de ticket à l'envoi (voir ticketApproval.js, aiemaildraft.routes.js,
            // draftapproval.routes.js, draftReplyApproval.js).
            await prisma.aiEmailDraft.create({
              data: {
                ticketId: match.ticketId,
                recipientEmail: fromEmail,
                ccRecipients,
                subject: `[Ticket #EN_ATTENTE] ${subject}`,
                proposedContent: replyResult.replyHtml,
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
      return applyInboxRulesSafe(updated, 'followup');
    }

    // Couche 1 : Filtre technique minimal — UNIQUEMENT les messages véritablement automatiques
    // (bounces, mailer-daemon, messages machine) qui ne sont JAMAIS des tickets.
    // Les newsletters, emails d'information ou sujets suspects passent à l'IA (couche 3)
    // pour être analysés, puis orientés vers le centre de validation si besoin.
    // Bypassée si bypassSpamRules est actif (retraitement manuel d'un email classé spam à tort)
    const { checkEmailSpam } = require('./emailSpamFilter');
    const spamCheck = checkEmailSpam(headers, subject, bodyPreview, fromEmail);
    if (spamCheck.isSpam && !bypassSpamRules) {
      if (spamCheck.isTechnicalAutomated) {
        // Bounce, mailer-daemon, delivery failure : jamais un ticket — classer INFORMATIONAL
        console.log(`[emailPipeline] Email technique automatique ignoré (INFORMATIONAL) : ${spamCheck.reason}`);
        const updated = await prisma.incomingEmail.update({
          where: { id: incoming.id },
          data: { status: 'INFORMATIONAL', aiSummary: `Message automatique technique : ${spamCheck.reason}`, aiIsSpam: false, aiConfidence: 1.0, aiIntent: 'INFORMATIONAL' },
        });
        if (io) io.emit('email_updated', updated);
        return applyInboxRulesSafe(updated, 'spam-filter');
      }
      // Tout le reste (newsletters, OOO, sujets suspects) : laisser passer à l'IA
      console.log(`[emailPipeline] Email suspect mais non technique — transmis à l'IA pour analyse : ${spamCheck.reason}`);
    }

    // Couche 2 : Moteur de règles déterministe (sans appel LLM)
    // Byspassée si bypassSpamRules est actif (retraitement manuel d'un email classé spam à tort)
    const { evaluateRules } = require('./emailRuleEngine');
    const ruleMatch = bypassSpamRules ? null : await evaluateRules(subject, bodyPreview, fromEmail);

    if (ruleMatch) {
      console.log(`[emailPipeline] Correspondance avec la règle de triage: "${ruleMatch.label}"`);
      if (ruleMatch.isSpam) {
        // La règle suspecte cet email : au lieu de le bloquer en SPAM, on le passe en NEEDS_REVIEW
        // pour que la Hotline valide. Plus aucun email ne disparaît silencieusement.
        console.log(`[emailPipeline] Règle isSpam "${ruleMatch.label}" — orienté vers le centre de validation (NEEDS_REVIEW)`);
        const updated = await prisma.incomingEmail.update({
          where: { id: incoming.id },
          data: {
            status: 'NEEDS_REVIEW',
            aiSummary: `Signalé par règle : "${ruleMatch.label}" — en attente de validation Hotline`,
            aiIsSpam: false,
            aiConfidence: 0.8,
            aiIntent: 'NEEDS_REVIEW',
          },
        });
        if (io) io.emit('email_updated', updated);
        return applyInboxRulesSafe(updated, 'triage-spam');
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
      analysis = await validateAndCleanAnalysis(rawRuleAnalysis, [], [], { body: cleanBody });
      if (ruleMatch.ticketPriority) analysis.priority = ruleMatch.ticketPriority;
    } else {
      // Couche 3 : Fallback analyse IA pour nouveau ticket
      // Résolution de l'expéditeur pour injecter role/équipes/compétences dans le prompt IA
      let senderRole = 'inconnu';
      let senderTeams = 'aucune';
      let senderSkills = 'aucune';
      if (fromEmail) {
        const knownUser = await prisma.user.findUnique({
          where: { email: fromEmail.toLowerCase().trim() },
          select: {
            role: true,
            team: { select: { name: true } },
            skills: { select: { level: true, skill: { select: { name: true } } } },
          },
        });
        if (knownUser) {
          senderRole = knownUser.role;
          senderTeams = knownUser.team?.name || 'aucune';
          senderSkills = knownUser.skills?.map((s) => s.skill.name).join(', ') || 'aucune';
          console.log(`[emailPipeline] Expéditeur résolu : ${fromEmail} → role=${senderRole}, équipe=${senderTeams}`);
        }
      }
      analysis = await analyzeEmail({ subject, body: cleanBody, from: fromEmail, fromName, senderRole, senderTeams, senderSkills, signatureText });
    }

    // L'IA détecte un spam / email d'information / hors périmètre
    // → Plutôt que de rejeter, on oriente vers le centre de validation (NEEDS_REVIEW)
    //   pour que la Hotline puisse confirmer ou créer un ticket manuellement.
    if (analysis.isSpam || analysis.isInformational === true || analysis.requiresAction === false || analysis.ticketDecision === 'DO_NOT_CREATE') {
      const reason = analysis.decisionReason || (analysis.isSpam ? 'SPAM' : 'INFORMATION');
      console.log(`[emailPipeline] Email classé par l'IA comme non-actionnable (${reason}) — orienté NEEDS_REVIEW pour validation Hotline`);
      const updated = await prisma.incomingEmail.update({
        where: { id: incoming.id },
        data: {
          status: 'NEEDS_REVIEW',
          aiSummary: analysis.summary || 'Email considéré comme non-actionnable par l\'IA — vérification Hotline requise',
          aiCategory: analysis.category || null,
          aiPriority: 'P4',
          aiConfidence: analysis.confidence || 1.0,
          aiIsSpam: false, // on ne préjuge pas : c'est la Hotline qui décide
          aiIntent: reason,
        },
      });
      if (io) io.emit('email_updated', updated);
      return applyInboxRulesSafe(updated, 'ai-spam-info');
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
      return applyInboxRulesSafe(updated, 'needs-review');
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

      // Notification "incident déjà connu" — envoyée directement au demandeur
      await sendKnownIncidentNotification({
        ticketId: similarMatch.ticketId,
        toEmail: fromEmail,
        toName: fromName,
        originalSubject: similarMatch.ticketTitle,
        isMajor: updatedTicket.isMajorIncident,
        impactedCount: updatedTicket.impactedSites.length,
      }).catch((e) => console.error(`[emailPipeline] Échec notification incident connu vers ${fromEmail}:`, e.message));

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
      return applyInboxRulesSafe(updated, 'similar-incident');
    }

    // ── Résolution STRICTE du lieu ──────────────────────────────────────────
    // Règle : le lieu provient UNIQUEMENT d'une correspondance entre la signature /
    // l'adresse email de l'expéditeur et la table Location. Aucune correspondance →
    // "INDÉTERMINÉ" (jamais le nom d'une application ou d'un logiciel, jamais une
    // invention de l'IA, et plus aucun fallback sur l'historique du demandeur).
    let locationId = null;
    let resolvedLocationName = null;

    // 1) Détection déterministe : signature + adresse email vs table Location
    try {
      const activeLocations = await prisma.location.findMany({
        where: { isActive: true },
        select: { id: true, name: true, completename: true },
      });
      const detected = detectLocationFromSender({ fromEmail, fromName, signatureText, locations: activeLocations });
      if (detected) {
        locationId = detected.locationId;
        resolvedLocationName = detected.locationName;
        console.log(`[emailPipeline] Lieu résolu strictement via signature/email : "${resolvedLocationName}" pour ${fromEmail}`);
      }
    } catch (err) {
      console.error('[emailPipeline] Détection lieu échouée:', err.message);
    }

    // 2) Suggestion IA (déjà validée contre la base par le validateur) → re-vérification exacte
    if (!locationId && analysis.location) {
      const loc = await prisma.location.findFirst({
        where: { completename: analysis.location },
        select: { id: true, name: true, completename: true },
      });
      if (loc) {
        locationId = loc.id;
        resolvedLocationName = loc.name || loc.completename;
        console.log(`[emailPipeline] Lieu IA résolu : "${resolvedLocationName}" pour ${fromEmail}`);
      } else {
        console.log(`[emailPipeline] Lieu IA "${analysis.location}" introuvable en DB → INDÉTERMINÉ`);
      }
    }

    // 3) Aucune correspondance → INDÉTERMINÉ (affiché tel quel sur le ticket)
    if (!locationId) {
      resolvedLocationName = UNDETERMINED;
      console.log(`[emailPipeline] Aucun lieu correspondant (signature/email/IA) → INDÉTERMINÉ pour ${fromEmail}`);
    }

    // 3. Créer/mettre à jour l'association RequesterLocation si on a résolu un lieu
    if (locationId && fromEmail) {
      await prisma.requesterLocation.upsert({
        where: { email_locationId: { email: fromEmail.toLowerCase().trim(), locationId: locationId } },
        update: { lastUsedAt: new Date(), assignmentCount: { increment: 1 } },
        create: { email: fromEmail.toLowerCase().trim(), locationId: locationId },
      }).catch(() => {});
    }

    // Titre du ticket : EN MAJUSCULES, partie LIEU strictement alignée sur le lieu résolu
    // en base ("INDÉTERMINÉ" si aucun lieu ne correspond) — jamais le site deviné par l'IA.
    const formattedTitle = formatTicketTitle(analysis.suggestedTitle || subject, resolvedLocationName);
    if (formattedTitle && formattedTitle !== analysis.suggestedTitle) {
      console.log(`[emailPipeline] Titre formaté (majuscules + lieu strict) : "${formattedTitle}"`);
    }
    analysis.suggestedTitle = formattedTitle;

    // Étape 3 : créer ticket ERP dans une transaction
    const lowTrustSender = await isLowTrustSender(fromEmail).catch(() => false);

    const { erpTicketId, ticketMessageId } = await prisma.$transaction(async (tx) => {
      const created = await createTicketFromEmail({
        subject, body: cleanBody || bodyPreview, from: fromEmail, fromName, analysis, emailAccountId: account.id, locationId, locationName: resolvedLocationName, lowTrustSender, tx,
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

    // Étape 6 : accusé de réception automatique au demandeur — envoyé en RÉPONSE dans le
    // fil de l'email d'origine (createReply), avec les personnes en copie ET la liste To
    // d'origine (boîtes de diffusion comprises) pour une sémantique « Répondre à tous ».
    await sendAcknowledgement({
      ticketId: erpTicketId,
      toEmail: fromEmail,
      toName: fromName,
      originalSubject: subject,
      cc: ccRecipients,
      to: toRecipients,
      inReplyToGraphMessageId: graphMessageId,
      conversationId,
      inReplyTo: internetMessageId,
    }).catch((e) => console.error(`[emailPipeline] Échec envoi accusé de réception vers ${fromEmail}:`, e.message));

    // Notification IMMÉDIATE à la Hotline : le ticket est en attente d'approbation (PENDING) —
    // le mail part en même temps que la création, plus besoin d'attendre les 30/60 min du scheduler.
    // Best-effort : un échec ne doit jamais bloquer le pipeline.
    notifyNewPendingTicket(erpTicketId).catch((e) =>
      console.error(`[emailPipeline] Échec notification immédiate hotline ticket ${erpTicketId}:`, e.message)
    );

    const updated = await prisma.incomingEmail.update({
      where: { id: incoming.id },
      data: {
        status: 'DONE', erpTicketId, isNewTicket: true,
        aiSummary: analysis.summary, aiCategory: analysis.category,
        aiPriority: analysis.priority, aiTeam: analysis.team,
        aiConfidence: analysis.confidence, aiIsSpam: false,
      },
    });
    // Appliquer les règles de tri après l'analyse IA
    await applyInboxRulesSafe(updated, 'new-ticket');
    if (io) io.emit('email_updated', updated);
  } catch (err) {
    const isTransient = isTransientError(err);
    const currentRetryCount = incoming.retryCount || 0;
    const errorDetail = err.errorDetail || null;

    if (isTransient && currentRetryCount < MAX_RETRIES) {
      const nextDelay = RETRY_DELAYS_MS[currentRetryCount] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      const updated = await prisma.incomingEmail.update({
        where: { id: incoming.id },
        data: {
          status: 'RETRY',
          error: err.message,
          errorDetail,
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
        errorDetail,
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

      // ── Fallback : créer un ticket basique quand l'analyse échoue définitivement ──
      let fallbackTicketId = null;
      if (deadLetter) {
        try {
          const fallbackTicket = await prisma.ticket.create({
            data: {
              title: (subject || '(Email sans analyse IA)').substring(0, 200),
              content: (bodyPreview || bodyHtml || '').substring(0, 5000),
              status: 'OPEN',
              priority: 'P3',
              source: 'Email',
              origin: 'EMAIL',
              sourceEmail: fromEmail || null,
              sourceName: (fromEmail || '').split('@')[0],
              sourceSubject: subject || null,
              aiProcessed: false,
              aiSummary: `[FALLBACK] Analyse IA échouée — email nécessitant une révision manuelle. Erreur : ${err.message}`,
            },
          });
          fallbackTicketId = fallbackTicket.id;

          // Enregistrer le message dans le ticket
          await prisma.ticketMessage.create({
            data: {
              ticketId: fallbackTicket.id,
              direction: 'INBOUND',
              sender: fromEmail,
              recipients: [],
              ccRecipients: incoming.ccRecipients || [],
              subject,
              body: bodyPreview,
              bodyHtml,
              outlookMessageId: graphMessageId,
              internetMessageId,
              inReplyTo,
              conversationId,
              timestamp: receivedAt,
              summary: '[FALLBACK] Message brut — analyse IA échouée',
            },
          });

          console.log(`[emailPipeline] Ticket fallback #${fallbackTicket.id} créé pour email en échec (incoming #${incoming.id})`);
        } catch (fallbackErr) {
          console.error('[emailPipeline] Échec création ticket fallback:', fallbackErr.message);
        }
      }

      const updated = await prisma.incomingEmail.update({
        where: { id: incoming.id },
        data: {
          status: deadLetter ? 'DEAD_LETTER' : 'ERROR',
          error: err.message,
          errorDetail,
          lastError: err.message,
          retryCount: currentRetryCount + (deadLetter ? 0 : 1),
          erpTicketId: fallbackTicketId,
          isNewTicket: !!fallbackTicketId,
        },
      });
      if (io) io.emit('email_updated', updated);
      // Appliquer les inbox rules même sur les emails en échec (permet de trier les emails cassés)
      await applyInboxRulesSafe(updated, deadLetter ? 'dead-letter' : 'error');
      console.error(`[emailPipeline] ${deadLetter ? 'DEAD_LETTER' : 'ERROR'} incoming #${incoming.id}:`, err.message);
      // Notification admin pour échec définitif
      await notifyAdminsEmailFailed({
        incomingId: incoming.id,
        subject: subject || 'Objet inconnu',
        fromEmail,
        error: err.message,
        errorDetail,
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

// Limiteur de concurrence pour les appels IA simultanés (évite de saturer les providers)
async function runWithConcurrency(tasks, concurrency = 4) {
  const results = [];
  const executing = new Set();
  for (const task of tasks) {
    const p = task().then((result) => {
      executing.delete(p);
      return result;
    });
    executing.add(p);
    results.push(p);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  return Promise.allSettled(results);
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
    
    // Concurrence limitée à 4 appels IA simultanés pour ne pas saturer les providers
    const tasks = messages.map((m) => () => processMessage(m, account));
    const settled = await runWithConcurrency(tasks, 4);
    
    for (const res of settled) {
      if (res.status === 'fulfilled') {
        results.push({ accountId: account.id, emailId: res.value?.id, status: res.value?.status });
      } else {
        console.error(`[emailPipeline] Erreur traitement (${account.emailAddress}):`, res.reason);
        results.push({ accountId: account.id, error: res.reason?.message || res.reason });
      }
    }
  }
  return results;
}

function rewriteCidRefs(html, cidMap) {
  if (!html || !cidMap || Object.keys(cidMap).length === 0) return html;
  return html.replace(/cid:([^"'>\s]+)/gi, (match, cid) => {
    const cleanCid = cid.replace(/^<|>$/g, '');
    const mapped = cidMap[cleanCid] || cidMap[cid];
    if (mapped) return mapped;
    const docId = cidMap[cid] || cidMap[cleanCid];
    return docId ? (String(docId).startsWith('/') ? docId : `/glpi/document/${docId}/file`) : match;
  });
}

module.exports = { runEmailPipeline, processMessage };
