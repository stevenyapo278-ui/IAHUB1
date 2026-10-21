const prisma = require('../prismaClient');
const { getActiveProviders, callProviderWithFallback, callAiWithRetry } = require('./mailAnalyzer');
const { getPrompt } = require('./promptTemplates');
const { loadConversationItems, formatHistoryItems, stripHtml } = require('./conversationContext');

// Résume les échanges (emails) et les commentaires d'un ticket en un texte
// rédigé comme un suivi, destiné à être inscrit dans l'éditeur de suivi côté
// front (l'utilisateur relit, corrige, puis valide).
async function summarizeTicketThread({ ticketId, take = 20 }) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true, title: true, content: true, status: true, priority: true,
      category: true, aiSummary: true,
    },
  });
  if (!ticket) throw new Error('Ticket introuvable');

  // On charge un historique plus large que pour une relance (20 éléments) : le
  // résumé doit couvrir tout le fil, pas seulement les derniers échanges.
  const items = await loadConversationItems(ticketId, { messages: take, followups: take });

  const providers = await getActiveProviders();
  if (providers.length === 0) {
    throw new Error('Aucun provider IA configuré (Paramètres → Intelligence Artificielle)');
  }

  const prompt = await getPrompt('summarizeTicketThread', {
    ticketId: ticket.id,
    title: ticket.title || 'Sans titre',
    category: ticket.category || 'Non définie',
    priority: ticket.priority || 'Non définie',
    status: ticket.status || 'Non défini',
    content: stripHtml(ticket.content).substring(0, 1500) || 'Non renseigné',
    aiSummary: ticket.aiSummary || 'Aucun',
    history: formatHistoryItems(items, 700),
  });

  const raw = await callAiWithRetry(
    () => callProviderWithFallback(providers, prompt, 'background', { source: 'threadSummary' }),
    { maxRetries: 2, baseDelay: 1000 }
  );

  // Nettoyage défensif : on retire d'éventuelles balises ou fences que le modèle
  // aurait pu ajouter malgré la consigne, pour ne pas polluer l'éditeur de suivi.
  const summary = String(raw || '')
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/^[\s>*#-]+/gm, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!summary) throw new Error('Le provider IA n’a retourné aucun résumé exploitable');

  return {
    summary,
    itemCount: items.length,
    sources: {
      messages: items.filter((i) => i.source === 'message').length,
      followups: items.filter((i) => i.source === 'followup').length,
    },
  };
}

module.exports = { summarizeTicketThread };
