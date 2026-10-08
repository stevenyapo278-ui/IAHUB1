const prisma = require('../prismaClient');

// Historique de conversation pour les prompts IA : les messages email SEULS ne suffisent
// pas — les suivis saisis dans l'ERP (commentaires d'équipe, notes privées, validations)
// font partie du contexte et leur absence donne à l'IA l'impression de répondre à côté.

// Supprime le HTML des suivis (éditeur riche) : les balises polluent le prompt.
function stripHtml(text) {
  return String(text || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Libellé d'un élément d'historique dans le prompt.
function historyLabel(item) {
  if (item.source === 'followup') {
    const kind = item.isPrivate ? 'Note interne' : 'Suivi interne';
    return item.author ? `${kind} — ${item.author}` : kind;
  }
  return item.direction === 'INBOUND' ? 'Demandeur' : 'Support';
}

// Fusionne les N derniers messages email et les N derniers suivis du ticket,
// triés chronologiquement (ordre ascendant, comme un fil de discussion).
async function loadConversationItems(ticketId, { messages = 6, followups = 6 } = {}) {
  const [msgs, fus] = await Promise.all([
    prisma.ticketMessage.findMany({
      where: { ticketId },
      orderBy: { timestamp: 'desc' },
      take: messages,
      select: { direction: true, body: true, sender: true, timestamp: true },
    }),
    prisma.followup.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'desc' },
      take: followups,
      select: {
        content: true,
        isPrivate: true,
        createdAt: true,
        author: { select: { fullName: true } },
      },
    }),
  ]);

  return [
    ...(msgs || []).map((m) => ({
      source: 'message',
      direction: m.direction,
      sender: m.sender || null,
      timestamp: m.timestamp,
      body: m.body || '',
    })),
    ...(fus || []).map((f) => ({
      source: 'followup',
      isPrivate: !!f.isPrivate,
      author: f.author?.fullName || null,
      timestamp: f.createdAt,
      body: f.content || '',
    })),
  ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

// Formate les éléments en bloc `<history>` lisible par le modèle.
function formatHistoryItems(items, maxBody = 500) {
  if (!items || items.length === 0) return 'Aucun historique disponible.';
  return items
    .map((item) => `[${historyLabel(item)}] ${stripHtml(item.body).substring(0, maxBody)}`)
    .join('\n---\n');
}

module.exports = { loadConversationItems, formatHistoryItems, historyLabel, stripHtml };
