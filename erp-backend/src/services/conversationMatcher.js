const prisma = require('../prismaClient');

// Un ticket CLOSED ne doit plus absorber les emails de son fil de conversation :
// tout nouveau message reçu dans ce fil devient une NOUVELLE DEMANDE (nouveau ticket).
// On renvoie les métadonnées du ticket clos (closedTicketId/…) pour que le pipeline
// puisse lier les deux tickets et afficher un indicateur visuel côté interface.
const CLOSED_STATUS = 'CLOSED';

const TICKET_SELECT = { id: true, title: true, status: true };

function newRequestFromClosedThread(ticket, method) {
  return {
    ticketId: null,
    method,
    closedTicketId: ticket.id,
    closedTicketTitle: ticket.title || null,
    closedTicketStatus: ticket.status || CLOSED_STATUS,
  };
}

// Rattache un email entrant à un ticket existant selon 3 niveaux de priorité.
// Retourne { ticketId, method } pour un ticket encore actif, ou
// { ticketId: null, method: 'NEW_TICKET_FROM_CLOSED', closedTicketId } quand le fil
// appartient à un ticket fermé — le pipeline créera alors une nouvelle demande.
async function findExistingTicket({ conversationId, inReplyTo }) {
  let closedThreadTicket = null;

  // Priorité 1 : conversationId Outlook — ticket encore actif
  if (conversationId) {
    const ticket = await prisma.ticket.findFirst({
      where: { outlookConversationId: conversationId, status: { not: CLOSED_STATUS } },
      orderBy: { updatedAt: 'desc' },
      select: TICKET_SELECT,
    });
    if (ticket) return { ticketId: ticket.id, method: 'CONVERSATION_ID' };

    // Tickets historiques : l'identifiant de conversation n'est porté que par les
    // messages. On cherche d'abord un message rattaché à un ticket encore actif.
    const activeMsg = await prisma.ticketMessage.findFirst({
      where: { conversationId, ticket: { status: { not: CLOSED_STATUS } } },
      include: { ticket: { select: TICKET_SELECT } },
      orderBy: { timestamp: 'desc' },
    });
    if (activeMsg?.ticket) return { ticketId: activeMsg.ticketId, method: 'CONVERSATION_ID_MSG' };

    // Aucun ticket actif : mémoriser le ticket clos du fil s'il existe.
    const closedMsg = await prisma.ticketMessage.findFirst({
      where: { conversationId },
      include: { ticket: { select: TICKET_SELECT } },
      orderBy: { timestamp: 'desc' },
    });
    if (closedMsg?.ticket?.status === CLOSED_STATUS) closedThreadTicket = closedMsg.ticket;
  }

  // Priorité 2 : In-Reply-To / References — même règle : jamais un ticket clos.
  if (inReplyTo) {
    const msg = await prisma.ticketMessage.findFirst({
      where: { OR: [{ outlookMessageId: inReplyTo }, { internetMessageId: inReplyTo }] },
      include: { ticket: { select: TICKET_SELECT } },
    });
    if (msg?.ticket) {
      if (msg.ticket.status !== CLOSED_STATUS) return { ticketId: msg.ticketId, method: 'IN_REPLY_TO' };
      if (!closedThreadTicket) closedThreadTicket = msg.ticket;
    }
  }

  // Priorité 3 : ticket clos portant directement le conversationId.
  if (conversationId && !closedThreadTicket) {
    closedThreadTicket = await prisma.ticket.findFirst({
      where: { outlookConversationId: conversationId, status: CLOSED_STATUS },
      orderBy: { closedAt: 'desc' },
      select: TICKET_SELECT,
    });
  }

  if (closedThreadTicket) return newRequestFromClosedThread(closedThreadTicket, 'NEW_TICKET_FROM_CLOSED');
  return null;
}

module.exports = { findExistingTicket };
