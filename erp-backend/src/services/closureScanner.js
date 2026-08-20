const prisma = require('../prismaClient');
const { getActiveProviders, callProviderWithFallback } = require('./mailAnalyzer');

// Analyse proactive d'un lot de tickets : l'IA détecte les résolutions probables sur les tickets
// ouverts sans réponse utilisateur récente, et propose une clôture à la Hotline (mêmes garde-fous
// que le flux réactif : confiance >= 0.7, preuve exigée, maximum 2 suggestions par ticket).
const CONFIDENCE_THRESHOLD_FOR_CLOSE = 0.7;
const MAX_CLOSE_SUGGESTIONS = 2;
const MIN_HISTORY_LENGTH = 2; // un vrai échange (au moins un message support + contexte) est requis

function daysSince(date) {
  if (!date) return 0;
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

function historyToText(history) {
  return history.length > 0
    ? history
      .map((m) => `[${m.direction === 'INBOUND' ? 'Utilisateur' : 'Support'}] ${(m.body || '').substring(0, 300)}`)
      .join('\n---\n')
    : 'Aucun historique disponible.';
}

// Analyse un ticket candidat et le marque closeSuggested si l'IA conclut à une résolution probable.
async function analyzeCandidate(ticket, cutoff) {
  const { logEvent } = require('./ticketEvent');

  // Récupère les derniers échanges pour le contexte réel
  const recentMessages = await prisma.ticketMessage.findMany({
    where: { ticketId: ticket.id },
    orderBy: { timestamp: 'desc' },
    take: 6,
    select: { direction: true, body: true, timestamp: true },
  });
  const history = recentMessages.reverse();
  if (history.length < MIN_HISTORY_LENGTH) {
    return { action: 'SKIP_NO_HISTORY' };
  }

  const lastDate = new Date(history[history.length - 1].timestamp);
  // L'utilisateur vient de répondre : le flux réactif s'en charge, on n'interfère pas
  if (history[history.length - 1].direction === 'INBOUND' && Date.now() - lastDate.getTime() < 24 * 3600 * 1000) {
    return { action: 'SKIP_RECENT_USER_REPLY' };
  }

  const providers = await getActiveProviders();
  if (providers.length === 0) {
    return { action: 'SKIP_NO_PROVIDER' };
  }

  // Boucle de rétroaction : injecte les clôtures rejetées récemment sur ce ticket pour éviter
  // de reproduire les mêmes erreurs de classification.
  let recentRejections = 'Aucun rejet récent sur ce ticket.';
  try {
    const rejects = await prisma.ticketEvent.findMany({
      where: { ticketId: ticket.id, type: 'CLOSURE_REJECTED' },
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

  const { getPrompt } = require('./promptTemplates');
  const prompt = await getPrompt('analyzeClosureCandidate', {
    ticketTitle: ticket.title,
    ticketSummary: ticket.aiSummary || 'Non disponible',
    historyText: historyToText(history),
    daysSinceLastUserReply: ticket.lastUserReplyAt ? daysSince(ticket.lastUserReplyAt) : null,
    daysSinceOpened: daysSince(ticket.firstOpenedAt || ticket.createdAt),
    recentRejections,
  });

  let raw;
  try {
    raw = (await callProviderWithFallback(providers, prompt)).trim();
  } catch {
    return { action: 'SKIP_PROVIDER_ERROR' };
  }

  let parsed;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  } catch {
    return { action: 'SKIP_UNPARSEABLE' };
  }

  const resolved = parsed.resolved === true;
  const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0;
  const evidence = typeof parsed.evidence === 'string' ? parsed.evidence.trim() : '';

  if (!resolved) return { action: 'SKIP_NOT_RESOLVED', confidence };
  if (confidence < CONFIDENCE_THRESHOLD_FOR_CLOSE) return { action: 'SKIP_LOW_CONFIDENCE', confidence };
  if (!evidence) return { action: 'SKIP_NO_EVIDENCE', confidence };

  // Propose la clôture à la Hotline (aucun changement de statut : le ticket reste actif tant
  // que la validation humaine n'a pas eu lieu)
  await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      closeSuggested: true,
      closeSuggestedAt: new Date(),
      closeSuggestionConfidence: confidence,
      closeSuggestionCount: (ticket.closeSuggestionCount || 0) + 1,
    },
  });
  await logEvent(ticket.id, 'CLOSURE_SUGGESTED', 'AI_PROACTIVE_SCAN', {
    intent: 'RESOLVED', confidence, evidence, reason: 'proactive_scan', daysSilent: daysSince(ticket.lastUserReplyAt),
  });

  return { action: 'SUGGESTED', confidence, evidence };
}

// Scanne les tickets ouverts sans réponse utilisateur récente et retourne un résumé des actions.
async function runClosureAnalysis({ minDaysWithoutReply = 4, limit = 25 } = {}) {
  const cutoff = new Date(Date.now() - minDaysWithoutReply * 24 * 60 * 60 * 1000);
  const candidates = await prisma.ticket.findMany({
    where: {
      status: { notIn: ['SOLVED', 'CLOSED'] },
      closeSuggested: false,
      closeSuggestionCount: { lt: MAX_CLOSE_SUGGESTIONS },
      OR: [
        { lastUserReplyAt: { lt: cutoff } },
        { lastUserReplyAt: null, updatedAt: { lt: cutoff } },
      ],
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
    select: {
      id: true, title: true, aiSummary: true, status: true, closeSuggestionCount: true,
      firstOpenedAt: true, createdAt: true, updatedAt: true, lastUserReplyAt: true,
    },
  });

  const results = [];
  for (const ticket of candidates) {
    const r = await analyzeCandidate(ticket, cutoff);
    results.push({ ticketId: ticket.id, ...r });
  }

  const counts = {};
  for (const r of results) counts[r.action] = (counts[r.action] || 0) + 1;

  return {
    scanned: candidates.length,
    suggested: counts.SUGGESTED || 0,
    skipped: {
      noHistory: counts.SKIP_NO_HISTORY || 0,
      recentUserReply: counts.SKIP_RECENT_USER_REPLY || 0,
      noProvider: counts.SKIP_NO_PROVIDER || 0,
      notResolved: counts.SKIP_NOT_RESOLVED || 0,
      lowConfidence: counts.SKIP_LOW_CONFIDENCE || 0,
      noEvidence: counts.SKIP_NO_EVIDENCE || 0,
      providerError: counts.SKIP_PROVIDER_ERROR || 0,
      unparseable: counts.SKIP_UNPARSEABLE || 0,
    },
    results,
  };
}

module.exports = { runClosureAnalysis };