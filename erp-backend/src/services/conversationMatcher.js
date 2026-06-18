const prisma = require('../prismaClient');

// Rattache un email entrant à un ticket existant selon 3 niveaux de priorité.
// Retourne { ticketId, method } ou null si aucun ticket trouvé.
async function findExistingTicket({ conversationId, inReplyTo, internetMessageId, subject, fromEmail }) {
  // Priorité 1 : conversationId Outlook
  if (conversationId) {
    const ticket = await prisma.ticket.findFirst({
      where: { outlookConversationId: conversationId, status: { not: 'CLOSED' } },
      orderBy: { updatedAt: 'desc' },
    });
    if (ticket) return { ticketId: ticket.id, method: 'CONVERSATION_ID' };

    // Vérifier aussi dans les TicketMessages existants
    const msg = await prisma.ticketMessage.findFirst({
      where: { conversationId },
      include: { ticket: true },
    });
    if (msg && msg.ticket.status !== 'CLOSED') return { ticketId: msg.ticketId, method: 'CONVERSATION_ID_MSG' };
  }

  // Priorité 2 : In-Reply-To / References
  if (inReplyTo) {
    const msg = await prisma.ticketMessage.findFirst({
      where: { OR: [{ outlookMessageId: inReplyTo }, { internetMessageId: inReplyTo }] },
      include: { ticket: true },
    });
    if (msg) return { ticketId: msg.ticketId, method: 'IN_REPLY_TO' };
  }

  // Priorité 3 : ticket clôturé avec même conversationId → réouverture
  if (conversationId) {
    const closed = await prisma.ticket.findFirst({
      where: { outlookConversationId: conversationId, status: 'CLOSED' },
      orderBy: { closedAt: 'desc' },
    });
    if (closed) return { ticketId: closed.id, method: 'REOPEN' };
  }

  return null;
}

module.exports = { findExistingTicket };
