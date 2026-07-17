const prisma = require('../prismaClient');

// Rattache un email entrant à un ticket existant selon 3 niveaux de priorité.
// Retourne { ticketId, method } ou null si aucun ticket trouvé.
//
// Les réglages closedTicketBehavior et reopenThresholdDays (SystemSettings) déterminent
// le comportement sur les tickets fermés : création d'un nouveau ticket ou réouverture.
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

  // Priorité 3 : ticket clôturé avec même conversationId → réouverture ou nouveau ticket
  // selon les réglages closedTicketBehavior et reopenThresholdDays.
  if (conversationId) {
    const closed = await prisma.ticket.findFirst({
      where: { outlookConversationId: conversationId, status: 'CLOSED' },
      orderBy: { closedAt: 'desc' },
    });

    if (closed) {
      // Charger les réglages pour savoir si on rouvre ou non
      const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });

      // Comportement "create_new" : ne pas rouvrir, le pipeline créera un nouveau ticket
      if (settings?.closedTicketBehavior === 'create_new') return null;

      // Vérifier le seuil de réouverture : si fermé depuis trop longtemps, créer un nouveau ticket
      if (closed.closedAt && settings?.reopenThresholdDays) {
        const daysSinceClosed = Math.floor((Date.now() - new Date(closed.closedAt).getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceClosed > settings.reopenThresholdDays) return null;
      }

      // Mode "reopen" et pas de dépassement du seuil
      return { ticketId: closed.id, method: 'REOPEN' };
    }
  }

  return null;
}

module.exports = { findExistingTicket };
