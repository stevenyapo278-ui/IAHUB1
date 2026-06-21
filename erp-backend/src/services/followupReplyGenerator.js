const prisma = require('../prismaClient');
const { getActiveProvider, callProvider } = require('./mailAnalyzer');
const { getPrompt } = require('./promptTemplates');
const { searchKnowledge } = require('./knowledgeSearch');

// Sous ce seuil de similarité, un extrait de connaissance est considéré comme non pertinent et
// n'est pas transmis au prompt — on ne laisse pas le modèle seul juge de la pertinence (risque de
// présenter une réponse comme certaine alors qu'elle s'appuie sur du contenu hors sujet).
const KNOWLEDGE_SIMILARITY_THRESHOLD = 0.75;

function formatHistory(messages) {
  if (!messages.length) return 'Aucun historique disponible.';
  return messages
    .map((m) => `[${m.direction === 'INBOUND' ? 'Utilisateur' : 'Support'}] ${(m.body || '').substring(0, 500)}`)
    .join('\n---\n');
}

function formatKnowledgeResults(results) {
  if (!results.length) return 'Aucun extrait pertinent trouvé.';
  return results
    .map((r) => `[id:${r.id}] (similarité ${Math.round(r.similarity * 100)}%) ${r.content.substring(0, 500)}`)
    .join('\n---\n');
}

// Génère une réponse de suivi pour un email reçu sur un ticket déjà ouvert, en s'appuyant sur
// l'historique complet de la conversation et une recherche dans la base de connaissances.
// Ne lève jamais d'exception : toute défaillance (pas de provider, erreur réseau, JSON invalide)
// dégrade vers { canAnswer: false }, qui déclenche l'escalade côté appelant.
async function generateFollowupReply({ ticketId, lastMessageBody, fromEmail, fromName }) {
  const provider = await getActiveProvider();
  if (!provider) return { canAnswer: false, replyHtml: '', usedKnowledgeChunkIds: [], confidence: 0 };

  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  const messages = await prisma.ticketMessage.findMany({
    where: { ticketId },
    orderBy: { timestamp: 'asc' },
    select: { direction: true, body: true },
  });

  const knowledgeQuery = `${ticket?.aiSummary || ticket?.title || ''}\n${lastMessageBody || ''}`.trim();
  let knowledgeResults = [];
  try {
    const rawResults = await searchKnowledge(knowledgeQuery);
    knowledgeResults = rawResults.filter((r) => r.similarity >= KNOWLEDGE_SIMILARITY_THRESHOLD);
  } catch (err) {
    console.error('[followupReplyGenerator] Échec recherche base de connaissances:', err.message);
  }

  const prompt = await getPrompt('generateFollowupReply', {
    ticketTitle: ticket?.title || '',
    ticketSummary: ticket?.aiSummary || 'Non disponible',
    historyText: formatHistory(messages),
    knowledgeResults: formatKnowledgeResults(knowledgeResults),
    lastMessage: lastMessageBody?.substring(0, 1000) || '',
  });

  let raw;
  try {
    raw = (await callProvider(provider, prompt)).trim();
  } catch (err) {
    console.error('[followupReplyGenerator] Échec appel provider IA:', err.message);
    return { canAnswer: false, replyHtml: '', usedKnowledgeChunkIds: [], confidence: 0 };
  }

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    if (parsed.canAnswer !== true) {
      return { canAnswer: false, replyHtml: '', usedKnowledgeChunkIds: [], confidence: 0 };
    }
    const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0;
    return {
      canAnswer: true,
      replyHtml: parsed.replyHtml || '',
      usedKnowledgeChunkIds: Array.isArray(parsed.usedKnowledgeChunkIds) ? parsed.usedKnowledgeChunkIds : [],
      confidence,
    };
  } catch (err) {
    console.error('[followupReplyGenerator] Réponse IA non parsable en JSON:', err.message);
    return { canAnswer: false, replyHtml: '', usedKnowledgeChunkIds: [], confidence: 0 };
  }
}

module.exports = { generateFollowupReply, KNOWLEDGE_SIMILARITY_THRESHOLD };
