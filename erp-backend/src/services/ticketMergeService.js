const prisma = require('../prismaClient');

// Fusionne des tickets sources dans un ticket cible, en transaction :
// déplacement des followups/messages/pièces jointes, journal d'événements,
// transfert des observateurs, puis suppression des sources.
// Retourne les compteurs d'éléments déplacés.
async function mergeTickets(targetId, sourceIds, actorEmail = 'SYSTEM', tx = null) {
  const db = tx || prisma;
  const mergedFollowups = [];
  const mergedMessages = [];
  const mergedAttachments = [];

  for (const sourceId of sourceIds) {
    const source = await db.ticket.findUnique({ where: { id: sourceId }, select: { id: true, title: true } });

    const [fups, msgs, atts] = await Promise.all([
      db.followup.updateMany({ where: { ticketId: sourceId }, data: { ticketId: targetId } }),
      db.ticketMessage.updateMany({ where: { ticketId: sourceId }, data: { ticketId: targetId } }),
      db.ticketAttachment.updateMany({ where: { ticketId: sourceId }, data: { ticketId: targetId } }),
    ]);
    mergedFollowups.push(fups.count);
    mergedMessages.push(msgs.count);
    mergedAttachments.push(atts.count);

    // Journal : fusion dans la cible ET dans la source
    await db.ticketEvent.create({
      data: {
        ticketId: targetId,
        type: 'MERGED_FROM',
        actor: actorEmail,
        payload: { sourceTicketId: sourceId, sourceTitle: source?.title || null },
      },
    });
    await db.ticketEvent.create({
      data: {
        ticketId: sourceId,
        type: 'MERGED_INTO',
        actor: actorEmail,
        payload: { targetTicketId: targetId },
      },
    });

    // Les observateurs de la source suivent désormais la cible
    const sourceTicket = await db.ticket.findUnique({
      where: { id: sourceId },
      select: { observers: { select: { id: true } } },
    });
    if (sourceTicket?.observers?.length > 0) {
      const existing = await db.ticket.findUnique({ where: { id: targetId }, select: { observers: { select: { id: true } } } });
      const existingIds = new Set((existing?.observers || []).map((o) => o.id));
      const toConnect = sourceTicket.observers.filter((o) => !existingIds.has(o.id));
      if (toConnect.length > 0) {
        await db.ticket.update({
          where: { id: targetId },
          data: { observers: { connect: toConnect.map((o) => ({ id: o.id })) } },
        });
      }
    }

    await db.ticket.delete({ where: { id: sourceId } });
  }

  const total = mergedFollowups.reduce((a, b) => a + b, 0)
    + mergedMessages.reduce((a, b) => a + b, 0)
    + mergedAttachments.reduce((a, b) => a + b, 0);

  return {
    merged: sourceIds.length,
    movedItems: total,
    followups: mergedFollowups,
    messages: mergedMessages,
    attachments: mergedAttachments,
  };
}

module.exports = { mergeTickets };