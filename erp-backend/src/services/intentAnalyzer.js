const prisma = require('../prismaClient');
const { getActiveProviders, callProviderWithFallback } = require('./mailAnalyzer');
const { formatHistoryItems } = require('./conversationContext');
const { senderPromptVars } = require('./senderIdentity');

const VALID_INTENTS = ['RESOLVED', 'STILL_PRESENT', 'NEW_INFO', 'QUESTION', 'REOPEN', 'NEW_ISSUE_IN_THREAD', 'UNKNOWN'];

// Seuils en dessous desquels on ne fait jamais confiance à l'IA pour modifier le statut automatiquement.
// Fermer/rouvrir un ticket à tort coûte plus cher qu'une fermeture ratée, donc seuil plus haut pour RESOLVED.
// Depuis la robustification : le seuil de clôture est désormais APPLIQUÉ à la suggestion elle-même
// (une détection RESOLVED trop peu confiante ne propose AUCUNE clôture à la Hotline).
const CONFIDENCE_THRESHOLD_FOR_CLOSE = 0.7;
const CONFIDENCE_THRESHOLD_FOR_REOPEN = 0.6;

// Nombre max de suggestions de clôture émises sur un même ticket (anti-boucle : après 2 rejets
// de la Hotline, on ne re-suggère plus jamais sur ce ticket — le compteur est remis à 0 à la validation).
const MAX_CLOSE_SUGGESTIONS = 2;

// Garde-fous anti-boucle/anti-dérive
const MAX_TICKET_LIFETIME_DAYS = 60; // au-delà, on ne réinitialise plus le compteur de relances indéfiniment

// Analyse l'intention d'un email de réponse utilisateur sur un ticket existant.
// conversationHistory (optionnel) = derniers éléments du fil (messages email + suivis ERP),
// pour donner du contexte réel à l'IA. sender (optionnel) = identité plateforme de l'expéditeur
// (rôle, appartenance au ticket) injectée dans le prompt — sans elle, l'IA ne sait pas qui parle.
// Retourne { intent, confidence, newIssueSummary, isAutoReply, evidence, userAnsweredSupport }.
async function analyzeIntent({ subject, body, ticketTitle, ticketSummary, conversationHistory = [], fromEmail, sender = null, ticketId, headers = {} }) {
  // Pré-filtre heuristique zéro-coût : les messages triviaux ou purement automatiques sont
  // traités sans appel LLM (comportement UNKNOWN / isAutoReply, identique aux branches existantes).
  const { prefilterReply } = require('./intentPrefilter');
  const pre = prefilterReply({ body, subject });
  if (pre.skip) {
    return {
      intent: pre.intent || 'UNKNOWN',
      confidence: 0,
      newIssueSummary: null,
      isAutoReply: !!pre.isAutoReply,
      evidence: null,
      userAnsweredSupport: false,
    };
  }

  const providers = await getActiveProviders();
  if (providers.length === 0) {
    return { intent: 'UNKNOWN', confidence: 0, newIssueSummary: null, isAutoReply: false, evidence: null, userAnsweredSupport: false };
  }

  const historyText = formatHistoryItems(conversationHistory, 300);

  // Boucle de retour d'apprentissage : les dernières clôtures suggérées par l'IA et REJETÉES par la
  // Hotline (avec leur motif) sont injectées dans le prompt pour éviter de reproduire les mêmes erreurs
  // de classification sur le même ticket.
  let recentRejections = 'Aucun rejet récent sur ce ticket.';
  if (ticketId) {
    try {
      const rejects = await prisma.ticketEvent.findMany({
        where: { ticketId, type: 'CLOSURE_REJECTED' },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { payload: true, createdAt: true },
      });
      if (rejects.length > 0) {
        recentRejections = rejects.map((r) =>
          `- ${new Date(r.createdAt).toLocaleDateString('fr-FR')} : motif « ${r.payload?.reason || 'non précisé'} » (confiance IA ${r.payload?.confidence ?? '?'})`
        ).join('\n');
      }
    } catch {
      // en cas d'échec de lecture, on analyse sans le contexte supplémentaire
    }
  }

  const { getPrompt } = require('./promptTemplates');
  const prompt = await getPrompt('analyzeIntent', {
    ticketTitle,
    ticketSummary: ticketSummary || 'Non disponible',
    historyText,
    subject,
    body: body?.substring(0, 4000) || '',
    recentRejections,
    ...senderPromptVars(sender),
  });

  let raw;
  try {
    raw = (await callProviderWithFallback(providers, prompt, 'email')).trim();
  } catch {
    return { intent: 'UNKNOWN', confidence: 0, newIssueSummary: null, isAutoReply: false, evidence: null, userAnsweredSupport: false };
  }

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);

    const { validateAndCleanIntent } = require('./emailAnalysisValidator');
    const validated = validateAndCleanIntent(parsed, headers, body);

    return {
      intent: validated.intent,
      confidence: validated.isAutoReply ? 0 : (typeof validated.confidence === 'number' ? Math.max(0, Math.min(1, validated.confidence)) : 0),
      newIssueSummary: validated.newIssueSummary || null,
      isAutoReply: validated.isAutoReply === true,
      evidence: validated.evidence || null,
      userAnsweredSupport: validated.userAnsweredSupport === true,
    };
  } catch {
    return { intent: 'UNKNOWN', confidence: 0, newIssueSummary: null, isAutoReply: false, evidence: null, userAnsweredSupport: false };
  }
}

function daysSince(date) {
  if (!date) return 0;
  return (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24);
}

// Applique les changements de statut selon l'intention détectée et le niveau de confiance.
// context.fromEmail/fromName/originalBody/originalSubject servent à remplir les suggestions
// (réponse sur ticket fermé, ou nouvelle demande détectée sur un ticket en cours).
async function applyIntentActions(ticketId, { intent, confidence, newIssueSummary, isAutoReply }, actor = 'AI', context = {}) {
  const { logEvent } = require('./ticketEvent');
  const { fromEmail, originalBody, originalSubject, originalBodyHtml } = context;

  // Réponse automatique détectée (auto-reply, disclaimer, accusé système) : on ne change rien au statut,
  // on trace juste l'événement pour audit. Évite qu'un "résolu" présent dans une signature ferme un ticket.
  if (isAutoReply) {
    await logEvent(ticketId, 'AI_AUTO_REPLY_IGNORED', actor, { intent, confidence });
    return intent;
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { assignedTo: { select: { email: true, fullName: true } } },
  });
  const lifetimeExceeded = daysSince(ticket?.firstOpenedAt || ticket?.createdAt) > MAX_TICKET_LIFETIME_DAYS;

  const updates = {};
  const canReopenAutomatically = confidence >= CONFIDENCE_THRESHOLD_FOR_REOPEN;

  if (intent === 'RESOLVED') {
    const wasClosed = ['SOLVED', 'CLOSED'].includes(ticket?.status);
    if (wasClosed) {
      // Ticket déjà fermé : inutile de suggérer une clôture. On notifie juste que le demandeur a confirmé la résolution.
      await logEvent(ticketId, 'RESOLUTION_CONFIRMED_ON_CLOSED', actor, { intent, confidence, originalStatus: ticket.status });
    } else {
      // Toute détection de résolution est soumise à validation humaine : plus aucune
      // clôture automatique. Le ticket est marqué "clôture suggérée" et apparaît dans
      // le Centre de Validation jusqu'à la décision de la Hotline.
      const canSuggestClose = confidence >= CONFIDENCE_THRESHOLD_FOR_CLOSE
        && (ticket?.closeSuggestionCount || 0) < MAX_CLOSE_SUGGESTIONS;
      if (canSuggestClose) {
        updates.closeSuggested = true;
        updates.closeSuggestedAt = new Date();
        updates.closeSuggestionConfidence = confidence;
        updates.closeSuggestionCount = (ticket?.closeSuggestionCount || 0) + 1;
        updates.status = 'WAITING_FOR_USER';
        updates.lastUserReplyAt = new Date();
        await logEvent(ticketId, 'CLOSURE_SUGGESTED', actor, { intent, confidence });
      } else {
        updates.status = 'WAITING_FOR_USER';
        updates.lastUserReplyAt = new Date();
        if (!lifetimeExceeded) {
          updates.reminderCount = 0;
          updates.reminderSentAt = null;
        }
        const reason = (ticket?.closeSuggestionCount || 0) >= MAX_CLOSE_SUGGESTIONS ? 'limit_reached' : 'low_confidence';
        await logEvent(ticketId, 'CLOSURE_NOT_SUGGESTED', actor, { intent, confidence, reason });
      }
    }
  } else if (intent === 'STILL_PRESENT' || intent === 'NEW_INFO') {
    // Si le ticket est déjà SOLVED ou CLOSED, on ne le rouvre pas automatiquement.
    // On crée une suggestion "réponse sur ticket fermé" pour que la Hotline décide.
    const wasClosed = ['SOLVED', 'CLOSED'].includes(ticket?.status);
    if (wasClosed) {
      updates.replyOnClosedSuggested = true;
      updates.replyOnClosedSuggestedAt = new Date();
      updates.replyOnClosedSender = fromEmail;
      updates.replyOnClosedSubject = originalSubject || '';
      updates.replyOnClosedBody = (originalBody || '').substring(0, 5000);
      updates.replyOnClosedBodyHtml = originalBodyHtml || null;
      await logEvent(ticketId, 'REPLY_ON_CLOSED_SUGGESTED', actor, { intent, confidence, originalStatus: ticket.status });
      // On ne touche PAS au statut : le ticket reste SOLVED/CLOSED.
    } else {
      updates.status = 'OPEN';
      updates.lastUserReplyAt = new Date();
      if (!ticket?.firstOpenedAt) updates.firstOpenedAt = new Date();
      // Au-delà de la durée de vie max, on ne remet plus le compteur de relances à zéro :
      // le ticket continue d'avancer vers la pré-clôture/clôture au lieu de boucler indéfiniment.
      if (!lifetimeExceeded) {
        updates.reminderCount = 0;
        updates.reminderSentAt = null;
      } else {
        await logEvent(ticketId, 'AI_LIFETIME_EXCEEDED', actor, { intent, daysSinceOpened: Math.round(daysSince(ticket?.firstOpenedAt)) });
      }
    }
  } else if (intent === 'REOPEN') {
    const wasClosed = ['SOLVED', 'CLOSED'].includes(ticket?.status);
    if (wasClosed) {
      // Ticket fermé/résolu : on ne rouvre pas, on suggère une décision humaine.
      updates.replyOnClosedSuggested = true;
      updates.replyOnClosedSuggestedAt = new Date();
      updates.replyOnClosedSender = fromEmail;
      updates.replyOnClosedSubject = originalSubject || '';
      updates.replyOnClosedBody = (originalBody || '').substring(0, 5000);
      updates.replyOnClosedBodyHtml = originalBodyHtml || null;
      await logEvent(ticketId, 'REPLY_ON_CLOSED_SUGGESTED', actor, { intent, confidence, originalStatus: ticket.status });
    } else if (canReopenAutomatically) {
      updates.status = 'OPEN';
      updates.closedAt = null;
      updates.lastUserReplyAt = new Date();
      updates.reminderCount = 0;
      await logEvent(ticketId, 'REOPENED', actor, { intent, confidence });
    } else {
      // Confiance insuffisante pour rouvrir automatiquement un ticket déjà clos : revue humaine requise.
      updates.status = 'WAITING_FOR_USER';
      updates.lastUserReplyAt = new Date();
      await logEvent(ticketId, 'AI_LOW_CONFIDENCE_REOPEN_SKIPPED', actor, { intent, confidence });
    }
  } else if (intent === 'NEW_ISSUE_IN_THREAD') {
    const wasClosed = ['SOLVED', 'CLOSED'].includes(ticket?.status);
    if (wasClosed) {
      // Ticket fermé/résolu avec un nouveau sujet dans la réponse : suggestion reply-on-closed.
      updates.replyOnClosedSuggested = true;
      updates.replyOnClosedSuggestedAt = new Date();
      updates.replyOnClosedSender = fromEmail;
      updates.replyOnClosedSubject = originalSubject || '';
      updates.replyOnClosedBody = (originalBody || '').substring(0, 5000);
      updates.replyOnClosedBodyHtml = originalBodyHtml || null;
      await logEvent(ticketId, 'REPLY_ON_CLOSED_SUGGESTED', actor, { intent, confidence, originalStatus: ticket.status, newIssueSummary });
    } else {
      // Ticket EN COURS : la réponse porte sur un AUTRE besoin. On ne touche ni au statut ni
      // au ticket d'origine (le problème initial peut être toujours d'actualité) — on pose
      // seulement la suggestion « nouvelle demande » : la Hotline créera un ticket séparé ou
      // ignorera depuis le Centre de Validation.
      const alreadySuggested = !!ticket?.newTicketSuggested;
      updates.newTicketSuggested = true;
      updates.newTicketSuggestedAt = new Date();
      updates.newTicketSuggestedSender = fromEmail;
      updates.newTicketSuggestedSubject = originalSubject || '';
      updates.newTicketSuggestedSummary = (newIssueSummary || '').substring(0, 300);
      updates.newTicketSuggestedBody = (originalBody || '').substring(0, 5000);
      updates.newTicketSuggestedBodyHtml = originalBodyHtml || null;
      // Anti-boucle : un email supplémentaire du même fil rafraîchit la suggestion
      // (corps/expéditeur à jour) sans re-notifier ni re-journaliser à chaque message.
      if (!alreadySuggested) {
        await logEvent(ticketId, 'NEW_TICKET_SUGGESTED', actor, { intent, confidence, newIssueSummary });
      }
    }
  } else if (intent === 'QUESTION' || intent === 'UNKNOWN') {
    const wasClosed = ['SOLVED', 'CLOSED'].includes(ticket?.status);
    if (wasClosed) {
      // Ticket fermé : on ne touche surtout pas au statut (sinon il se « dé-ferme » tout seul
      // en WAITING_FOR_USER sans jamais apparaître dans le Centre de Validation). On pose la
      // suggestion : la Hotline décide entre rouvrir et créer une nouvelle demande.
      updates.replyOnClosedSuggested = true;
      updates.replyOnClosedSuggestedAt = new Date();
      updates.replyOnClosedSender = fromEmail;
      updates.replyOnClosedSubject = originalSubject || '';
      updates.replyOnClosedBody = (originalBody || '').substring(0, 5000);
      updates.replyOnClosedBodyHtml = originalBodyHtml || null;
      await logEvent(ticketId, 'REPLY_ON_CLOSED_SUGGESTED', actor, { intent, confidence, originalStatus: ticket.status });
    } else {
      updates.status = 'WAITING_FOR_USER';
      updates.lastUserReplyAt = new Date();
    }
  }

  if (Object.keys(updates).length > 0) {
    const updated = await prisma.ticket.update({ where: { id: ticketId }, data: updates });
    // Certains effets (suggestions reply-on-closed / nouvelle demande) n'ont PAS de changement
    // de statut : ne pas journaliser un « statut modifié » fantôme avec newStatus undefined.
    if (updates.status) {
      await logEvent(ticketId, 'STATUS_CHANGED', actor, { intent, confidence, newStatus: updates.status });
    }

    if (updates.status === 'WAITING_FOR_USER') {
      await logEvent(ticketId, 'NEEDS_HUMAN_REVIEW', actor, { intent, confidence, reason: 'low_confidence' });
    }

    // Si le ticket était SOLVED/CLOSED et repasse en OPEN → notifier le technicien assigné
    const wasClosed = ['SOLVED', 'CLOSED'].includes(ticket?.status);
    const isOpenNow = updates.status === 'OPEN';
    if (wasClosed && isOpenNow && ticket?.assignedTo?.email) {
      const { sendReopenNotificationEmail } = require('./emailSender');
      sendReopenNotificationEmail({
        ticketId: ticket.id,
        glpiTicketId: ticket.glpiTicketId,
        ticketTitle: ticket.title,
        priority: ticket.priority,
        category: ticket.category,
        technicianEmail: ticket.assignedTo.email,
        technicianName: ticket.assignedTo.fullName,
        requesterName: context?.fromName || context?.fromEmail || 'Utilisateur',
      }).catch((err) => console.error(`[intentAnalyzer] Échec email réouverture (ticket ${ticketId}):`, err.message));
    }
  }

  return intent;
}

module.exports = { analyzeIntent, applyIntentActions };
