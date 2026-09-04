const prisma = require('../prismaClient');
const { logEvent } = require('./ticketEvent');
const { auditLog } = require('./auditLogService');
const { emitTicketUpdated } = require('../utils/socket');
const { recordDecision } = require('./senderReputation');
const { sendApprovalNotificationEmail } = require('./emailSender');

// Approuve un ticket : passe le ticket en APPROVED, journalise (événement + audit),
// notifie en temps real et renvoie le ticket mis à jour.
// Logique partagée entre :
//  - POST /tickets/:id/approve (validation humaine dans le Centre de Validation)
//  - l'auto-approbation des tickets créés manuellement (réglage SystemSettings.autoApproveManualTickets)
async function approveTicket(id, { approvedById, approvedByEmail = 'HOTLINE', approvalNote = null } = {}) {
  id = Number(id);
  const existing = await prisma.ticket.findUnique({ where: { id } });
  if (!existing) {
    const err = new Error('Ticket introuvable');
    err.status = 404;
    throw err;
  }

  const ticket = await prisma.ticket.update({
    where: { id },
    data: {
      approvalStatus: 'APPROVED',
      approvedById,
      approvedAt: new Date(),
      approvalNote: approvalNote || null,
    },
  });

  await logEvent(id, 'APPROVED', approvedByEmail, {});
  await auditLog('TICKET_APPROVED', {
    actor: { sub: approvedById, email: approvedByEmail },
    targetType: 'Ticket',
    targetId: id,
    targetLabel: ticket.title,
  });

  emitTicketUpdated(ticket, { approvalStatus: 'APPROVED' });

  // Email au demandeur : son ticket a été approuvé
  try {
    const fullTicket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        requester: { select: { email: true, fullName: true } },
        assignedTo: { select: { fullName: true } },
      },
    });
    if (fullTicket?.requester?.email) {
      sendApprovalNotificationEmail({
        ticketId: fullTicket.id,
        ticketTitle: fullTicket.title,
        status: fullTicket.status,
        priority: fullTicket.priority,
        category: fullTicket.category,
        assignedToName: fullTicket.assignedTo?.fullName || null,
        requesterEmail: fullTicket.requester.email,
        requesterName: fullTicket.requester.fullName,
        content: fullTicket.content || null,
      }).catch((err) => console.error(`[ticketApproval] Échec email approbation (ticket ${id}):`, err.message));
    }
  } catch (err) {
    console.error(`[ticketApproval] Échec email approbation (ticket ${id}):`, err.message);
  }

  // Boucle de rétroaction : l'approbation renforce la réputation de l'expéditeur
  if (ticket.sourceEmail) {
    recordDecision({ email: ticket.sourceEmail, decision: 'APPROVED' })
      .catch((err) => console.error('[senderReputation] Échec enregistrement approbation:', err.message));
  }

  return ticket;
}

module.exports = { approveTicket };
