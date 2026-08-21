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
// Retourne un objet détaillé avec ticketId, action, confiance, preuve, et infos contextuelles.
async function analyzeCandidate(ticket, cutoff) {
  const { logEvent } = require('./ticketEvent');

  // Infos contextuelles du ticket pour l'affichage détaillé
  const ticketDetails = await prisma.ticket.findUnique({
    where: { id: ticket.id },
    select: {
      id: true, title: true, content: true, status: true, priority: true, category: true,
      aiSummary: true, closeSuggestionCount: true, firstOpenedAt: true, createdAt: true,
      updatedAt: true, lastUserReplyAt: true, assignedTo: { select: { fullName: true } },
      requester: { select: { fullName: true, email: true } },
      slaResponseDueAt: true, slaResolutionDueAt: true, slaBreachedAt: true,
      dueDate: true,
    },
  });

  const context = {
    ticketId: ticket.id,
    title: ticketDetails?.title || ticket.title,
    content: ticketDetails?.content?.substring(0, 200) || '',
    status: ticketDetails?.status || ticket.status,
    priority: ticketDetails?.priority || 'P3',
    category: ticketDetails?.category || null,
    aiSummary: ticketDetails?.aiSummary || ticket.aiSummary || null,
    assignedTo: ticketDetails?.assignedTo?.fullName || null,
    requester: ticketDetails?.requester?.fullName || null,
    daysOpen: daysSince(ticket.firstOpenedAt || ticket.createdAt),
    daysSilent: ticket.lastUserReplyAt ? daysSince(ticket.lastUserReplyAt) : null,
    slaBreached: !!ticketDetails?.slaBreachedAt,
    slaResolutionOverdue: ticketDetails?.slaResolutionDueAt && new Date(ticketDetails.slaResolutionDueAt) < new Date(),
    dueDateOverdue: ticketDetails?.dueDate && new Date(ticketDetails.dueDate) < new Date(),
    previousSuggestions: ticket.closeSuggestionCount || 0,
  };

  // Récupère les derniers échanges pour le contexte réel
  const recentMessages = await prisma.ticketMessage.findMany({
    where: { ticketId: ticket.id },
    orderBy: { timestamp: 'desc' },
    take: 6,
    select: { direction: true, body: true, timestamp: true },
  });
  const history = recentMessages.reverse();
  if (history.length < MIN_HISTORY_LENGTH) {
    return { ...context, action: 'SKIP_NO_HISTORY', confidence: null, evidence: '', reasoning: 'Pas assez d\'échanges dans l\'historique' };
  }

  const lastDate = new Date(history[history.length - 1].timestamp);
  // L'utilisateur vient de répondre : le flux réactif s'en charge, on n'interfère pas
  if (history[history.length - 1].direction === 'INBOUND' && Date.now() - lastDate.getTime() < 24 * 3600 * 1000) {
    return { ...context, action: 'SKIP_RECENT_USER_REPLY', confidence: null, evidence: '', reasoning: 'L\'utilisateur a répondu récemment (< 24h)' };
  }

  const providers = await getActiveProviders();
  if (providers.length === 0) {
    return { ...context, action: 'SKIP_NO_PROVIDER', confidence: null, evidence: '', reasoning: 'Aucun fournisseur IA configuré' };
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
  } catch (err) {
    return { ...context, action: 'SKIP_PROVIDER_ERROR', confidence: null, evidence: '', reasoning: `Erreur provider IA: ${err.message}` };
  }

  let parsed;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  } catch {
    return { ...context, action: 'SKIP_UNPARSEABLE', confidence: null, evidence: '', reasoning: 'Réponse IA non parsable' };
  }

  const resolved = parsed.resolved === true;
  const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0;
  const evidence = typeof parsed.evidence === 'string' ? parsed.evidence.trim() : '';

  if (!resolved) return { ...context, action: 'SKIP_NOT_RESOLVED', confidence, evidence, reasoning: 'L\'IA estime que le problème n\'est pas résolu' };
  if (confidence < CONFIDENCE_THRESHOLD_FOR_CLOSE) return { ...context, action: 'SKIP_LOW_CONFIDENCE', confidence, evidence, reasoning: `Confiance ${(confidence * 100).toFixed(0)}% < seuil ${(CONFIDENCE_THRESHOLD_FOR_CLOSE * 100).toFixed(0)}%` };
  if (!evidence) return { ...context, action: 'SKIP_NO_EVIDENCE', confidence, evidence, reasoning: 'Aucune preuve fournie par l\'IA' };

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

  return { ...context, action: 'SUGGESTED', confidence, evidence, reasoning: 'L\'IA estime que le problème est résolu avec confiance élevée' };
}

// Scanne les tickets ouverts sans réponse utilisateur récente et retourne un résumé détaillé des actions.
// Chaque résultat inclut les infos contextuelles du ticket pour un affichage riche côté frontend.
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
    results.push(r);
  }

  const counts = {};
  for (const r of results) counts[r.action] = (counts[r.action] || 0) + 1;

  // Grouper les résultats par catégorie pour un affichage structuré
  const suggested = results.filter((r) => r.action === 'SUGGESTED');
  const needsReview = results.filter((r) =>
    ['SKIP_LOW_CONFIDENCE', 'SKIP_NOT_RESOLVED'].includes(r.action)
  );
  const skipped = results.filter((r) => !['SUGGESTED', 'SKIP_LOW_CONFIDENCE', 'SKIP_NOT_RESOLVED'].includes(r.action));

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
    // Résultats groupés pour l'affichage détaillé
    suggestedResults: suggested,
    needsReviewResults: needsReview,
    skippedResults: skipped,
    // Tous les résultats bruts pour référence
    results,
  };
}

module.exports = { runClosureAnalysis };