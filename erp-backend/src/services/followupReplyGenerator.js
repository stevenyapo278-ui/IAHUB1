const prisma = require('../prismaClient');
const { getActiveProviders, callProviderWithFallback } = require('./mailAnalyzer');
const { getPrompt } = require('./promptTemplates');
const { searchKnowledge } = require('./knowledgeSearch');
const { loadConversationItems, formatHistoryItems, stripHtml } = require('./conversationContext');
const { senderPromptVars } = require('./senderIdentity');

// Sous ce seuil de similarité, un extrait de connaissance est considéré comme non pertinent et
// n'est pas transmis au prompt — on ne laisse pas le modèle seul juge de la pertinence (risque de
// présenter une réponse comme certaine alors qu'elle s'appuie sur du contenu hors sujet).
const KNOWLEDGE_SIMILARITY_THRESHOLD = 0.75;

function formatKnowledgeResults(results) {
  if (!results.length) return 'Aucun extrait pertinent trouvé.';
  return results
    .map((r) => `[id:${r.id}] (similarité ${Math.round(r.similarity * 100)}%) ${r.content.substring(0, 500)}`)
    .join('\n---\n');
}

// Génère une réponse de suivi pour un email reçu sur un ticket déjà ouvert, en s'appuyant sur
// l'historique complet de la conversation (messages email + suivis internes) et une recherche
// dans la base de connaissances.
// Ne lève jamais d'exception : toute défaillance (pas de provider, erreur réseau, JSON invalide)
// dégrade vers { canAnswer: false }, qui déclenche l'escalade côté appelant.
async function generateFollowupReply({ ticketId, lastMessageBody, fromEmail, fromName, sender = null }) {
  const providers = await getActiveProviders();
  if (providers.length === 0) return { canAnswer: false, replyHtml: '', usedKnowledgeChunkIds: [], confidence: 0 };

  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  // Historique = messages email ∪ suivis ERP (commentaires et notes internes de l'équipe) :
  // sans les suivis, l'IA reprend des infos déjà traitées en interne ou ignore l'état réel.
  const historyItems = await loadConversationItems(ticketId, { messages: 40, followups: 30 });

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
    ticketContent: stripHtml(ticket?.content).substring(0, 1200) || 'Non disponible',
    historyText: formatHistoryItems(historyItems, 500),
    knowledgeResults: formatKnowledgeResults(knowledgeResults),
    lastMessage: lastMessageBody?.substring(0, 1000) || '',
    ...senderPromptVars(sender),
  });

  let raw;
  try {
    raw = (await callProviderWithFallback(providers, prompt, 'email')).trim();
  } catch (err) {
    console.error('[followupReplyGenerator] Échec appel provider IA:', err.message);
    return { canAnswer: false, replyHtml: '', usedKnowledgeChunkIds: [], confidence: 0 };
  }

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    if (parsed.canAnswer !== true) {
      // skipReason (ALREADY_ANSWERED / NOT_ENOUGH_INFO) est reporté à l'appelant pour journaliser
      // une escalade honnête au lieu d'un « GENERATION_FAILED » générique.
      const skipReason = typeof parsed.skipReason === 'string' && parsed.skipReason.trim()
        ? parsed.skipReason.trim().substring(0, 40)
        : null;
      return { canAnswer: false, replyHtml: '', usedKnowledgeChunkIds: [], confidence: 0, skipReason };
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
