const prisma = require('../prismaClient');
const { getActiveProvider, callProvider } = require('./mailAnalyzer');

const VALID_INTENTS = ['RESOLVED', 'STILL_PRESENT', 'NEW_INFO', 'QUESTION', 'REOPEN', 'NEW_ISSUE_IN_THREAD', 'UNKNOWN'];

// Seuils en dessous desquels on ne fait jamais confiance à l'IA pour modifier le statut automatiquement.
// Fermer/rouvrir un ticket à tort coûte plus cher qu'une fermeture ratée, donc seuil plus haut pour RESOLVED.
const CONFIDENCE_THRESHOLD_FOR_CLOSE = 0.7;
const CONFIDENCE_THRESHOLD_FOR_REOPEN = 0.6;

// Garde-fous anti-boucle/anti-dérive
const MAX_SPLITS_PER_TICKET = 3; // au-delà, on suppose un problème de classification plutôt que de vrais nouveaux sujets
const MAX_TICKET_LIFETIME_DAYS = 60; // au-delà, on ne réinitialise plus le compteur de relances indéfiniment

// Analyse l'intention d'un email de réponse utilisateur sur un ticket existant.
// conversationHistory (optionnel) = derniers messages du fil, pour donner du contexte réel à l'IA.
// Retourne { intent, confidence, newIssueSummary, isAutoReply }.
async function analyzeIntent({ subject, body, ticketTitle, ticketSummary, conversationHistory = [], fromEmail }) {
  const provider = await getActiveProvider();
  if (!provider) return { intent: 'UNKNOWN', confidence: 0, newIssueSummary: null, isAutoReply: false };

  const historyText = conversationHistory.length > 0
    ? conversationHistory
      .map((m) => `[${m.direction === 'INBOUND' ? 'Utilisateur' : 'Support'}] ${(m.body || '').substring(0, 300)}`)
      .join('\n---\n')
    : 'Aucun historique disponible.';

  const { getPrompt } = require('./promptTemplates');
  const prompt = await getPrompt('analyzeIntent', {
    ticketTitle,
    ticketSummary: ticketSummary || 'Non disponible',
    historyText,
    subject,
    body: body?.substring(0, 1000) || '',
  });

  let raw;
  try {
    raw = (await callProvider(provider, prompt)).trim();
  } catch {
    return { intent: 'UNKNOWN', confidence: 0, newIssueSummary: null, isAutoReply: false };
  }

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    const isAutoReply = parsed.isAutoReply === true;
    const intent = isAutoReply ? 'UNKNOWN' : (VALID_INTENTS.includes(parsed.intent) ? parsed.intent : 'UNKNOWN');
    const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0;
    return { intent, confidence: isAutoReply ? 0 : confidence, newIssueSummary: parsed.newIssueSummary || null, isAutoReply };
  } catch {
    return { intent: 'UNKNOWN', confidence: 0, newIssueSummary: null, isAutoReply: false };
  }
}

function daysSince(date) {
  if (!date) return 0;
  return (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24);
}

// Applique les changements de statut selon l'intention détectée et le niveau de confiance.
// context.fromEmail/fromName/originalBody/originalSubject servent à créer le nouveau ticket en cas de NEW_ISSUE_IN_THREAD.
async function applyIntentActions(ticketId, { intent, confidence, newIssueSummary, isAutoReply }, actor = 'AI', context = {}) {
  const { logEvent } = require('./ticketEvent');
  const { updateGlpiTicket, createTicketFromEmail } = require('./glpiTicketCreator');
  const { fromEmail, fromName, emailAccountId, originalBody, originalSubject } = context;

  // Réponse automatique détectée (auto-reply, disclaimer, accusé système) : on ne change rien au statut,
  // on trace juste l'événement pour audit. Évite qu'un "résolu" présent dans une signature ferme un ticket.
  if (isAutoReply) {
    await logEvent(ticketId, 'AI_AUTO_REPLY_IGNORED', actor, { intent, confidence });
    return intent;
  }

  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  const lifetimeExceeded = daysSince(ticket?.firstOpenedAt || ticket?.createdAt) > MAX_TICKET_LIFETIME_DAYS;

  const updates = {};
  const canCloseAutomatically = confidence >= CONFIDENCE_THRESHOLD_FOR_CLOSE;
  const canReopenAutomatically = confidence >= CONFIDENCE_THRESHOLD_FOR_REOPEN;

  if (intent === 'RESOLVED') {
    if (canCloseAutomatically) {
      updates.status = 'SOLVED';
      updates.solvedAt = new Date();
    } else {
      // Confiance insuffisante pour fermer automatiquement : on laisse la main à un humain.
      updates.status = 'WAITING_FOR_USER';
      updates.lastUserReplyAt = new Date();
      await logEvent(ticketId, 'AI_LOW_CONFIDENCE_CLOSE_SKIPPED', actor, { intent, confidence });
    }
  } else if (intent === 'STILL_PRESENT' || intent === 'NEW_INFO') {
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
  } else if (intent === 'REOPEN') {
    if (canReopenAutomatically) {
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
    // Le problème initial est résolu : on ferme ce ticket (si confiance suffisante), et on ouvre
    // un ticket séparé pour le nouveau sujet évoqué dans le même mail, plutôt que de tout mélanger.
    if (canCloseAutomatically) {
      updates.status = 'SOLVED';
      updates.solvedAt = new Date();
    } else {
      updates.status = 'WAITING_FOR_USER';
      updates.lastUserReplyAt = new Date();
    }

    const splitCount = ticket?.splitCount || 0;
    if (newIssueSummary && fromEmail && splitCount < MAX_SPLITS_PER_TICKET) {
      const { erpTicketId, glpiTicketId } = await createTicketFromEmail({
        subject: originalSubject || `Nouveau sujet détecté dans le suivi du ticket #${ticketId}`,
        body: originalBody || newIssueSummary,
        from: fromEmail,
        fromName,
        analysis: { suggestedTitle: newIssueSummary, summary: newIssueSummary, priority: 'P3' },
        emailAccountId,
      });
      updates.splitCount = splitCount + 1;
      await logEvent(ticketId, 'SPLIT_NEW_ISSUE', actor, { newTicketId: erpTicketId, newGlpiTicketId: glpiTicketId, newIssueSummary });
      await logEvent(erpTicketId, 'CREATED_FROM_SPLIT', actor, { originTicketId: ticketId });
    } else if (newIssueSummary && splitCount >= MAX_SPLITS_PER_TICKET) {
      // Trop de scissions déjà faites depuis ce ticket : probablement une mauvaise classification répétée.
      // On n'ouvre plus de nouveau ticket automatiquement, on signale pour revue humaine.
      updates.status = 'WAITING_FOR_USER';
      await logEvent(ticketId, 'AI_SPLIT_LIMIT_REACHED', actor, { splitCount, newIssueSummary });
    }
  } else if (intent === 'QUESTION' || intent === 'UNKNOWN') {
    updates.status = 'WAITING_FOR_USER';
    updates.lastUserReplyAt = new Date();
  }

  if (Object.keys(updates).length > 0) {
    const updated = await prisma.ticket.update({ where: { id: ticketId }, data: updates });
    await logEvent(ticketId, 'STATUS_CHANGED', actor, { intent, confidence, newStatus: updates.status });

    if (updates.status === 'WAITING_FOR_USER') {
      await logEvent(ticketId, 'NEEDS_HUMAN_REVIEW', actor, { intent, confidence, reason: 'low_confidence_or_split_limit' });
    }

    if (updates.status && updated.glpiTicketId) {
      try {
        await updateGlpiTicket(updated.glpiTicketId, { status: updates.status });
      } catch (err) {
        console.error('[intentAnalyzer] Échec synchro statut GLPI:', err.message);
      }
    }
  }

  return intent;
}

module.exports = { analyzeIntent, applyIntentActions };
