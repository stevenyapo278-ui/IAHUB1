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

  // 1. Envoyer et valider automatiquement tout brouillon en attente associé à ce ticket dans /email-drafts?tab=drafts
  const { sendEmail } = require('./emailSender');
  try {
    const pendingDrafts = await prisma.aiEmailDraft.findMany({ where: { ticketId: id, status: 'PENDING' } });
    for (const draft of pendingDrafts) {
      // Un brouillon sans destinataire ne peut jamais partir : on le signale et on passe au suivant
      if (!draft.recipientEmail) {
        console.error(`[ticketApproval] Brouillon #${draft.id} sans destinataire — envoi impossible (ticket ${id})`);
        continue;
      }
      const displayId = draft.ticketId || id;
      const resolvedContent = (draft.proposedContent || '').replaceAll('#EN_ATTENTE', `#${displayId}`);
      const resolvedSubject = (draft.subject || '').replaceAll('#EN_ATTENTE', `#${displayId}`);

      let sentOk = false;
      try {
        await sendEmail({
          ticketId: draft.ticketId,
          to: draft.recipientEmail,
          cc: draft.ccRecipients,
          subject: resolvedSubject,
          bodyHtml: resolvedContent,
          saveAsMessage: true,
          inReplyToGraphMessageId: draft.inReplyToGraphMessageId,
          conversationId: draft.outlookConversationId,
        });
        sentOk = true;
      } catch (err) {
        console.error(`[ticketApproval] Échec envoi brouillon #${draft.id}:`, err.message);
      }

      // Ne marquer APPROVED+sentAt QUE si l'envoi a réussi — sinon le brouillon reste
      // PENDING (relançable / ré-approuvable) et l'échec est traçable.
      if (sentOk) {
        await prisma.aiEmailDraft.update({
          where: { id: draft.id },
          data: {
            status: 'APPROVED',
            proposedContent: resolvedContent,
            subject: resolvedSubject,
            reviewedById: approvedById || null,
            reviewedAt: new Date(),
            sentAt: new Date(),
          },
        }).catch(() => {});
      } else {
        await logEvent(id, 'NEEDS_HUMAN_REVIEW', 'SYSTEM', {
          reason: `Échec d'envoi du brouillon IA #${draft.id} lors de l'approbation — à renvoyer depuis le Centre de Validation`,
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.error(`[ticketApproval] Traitement des brouillons du ticket ${id} échoué:`, err.message);
  }

  // 2. Email informatif au demandeur : son ticket a été approuvé avec toutes les infos du ticket.
  // Si le ticket provient d'un email, on répond DANS le fil d'origine (createReply) et on met
  // en copie toutes les personnes qui étaient en CC sur la demande initiale.
  try {
    const fullTicket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        requester: { select: { email: true, fullName: true } },
        assignedTo: { select: { fullName: true } },
      },
    });
    const recipientEmail = fullTicket?.requester?.email || existing.sourceEmail;
    const recipientName = fullTicket?.requester?.fullName || existing.sourceName || '';
    if (recipientEmail) {
      // Dernier message ENTRANT du fil = la demande d'origine (ou la dernière relance du demandeur)
      const lastInbound = await prisma.ticketMessage.findFirst({
        where: { ticketId: id, direction: 'INBOUND', outlookMessageId: { not: null } },
        orderBy: { timestamp: 'desc' },
        select: { outlookMessageId: true, ccRecipients: true, conversationId: true, internetMessageId: true },
      });
      // Ne jamais mettre en CC : le demandeur lui-même (déjà destinataire principal)
      const requesterEmailNorm = recipientEmail.toLowerCase().trim();
      const ccRecipients = (lastInbound?.ccRecipients || []).filter(
        (addr) => addr && addr.toLowerCase().trim() !== requesterEmailNorm
      );
      sendApprovalNotificationEmail({
        ticketId: fullTicket.id,
        ticketTitle: fullTicket.title,
        status: fullTicket.status,
        priority: fullTicket.priority,
        category: fullTicket.category,
        assignedToName: fullTicket.assignedTo?.fullName || null,
        requesterEmail: recipientEmail,
        requesterName: recipientName,
        content: fullTicket.content || null,
        cc: ccRecipients,
        inReplyToGraphMessageId: lastInbound?.outlookMessageId || null,
        conversationId: lastInbound?.conversationId || null,
        // inReplyTo = internetMessageId du message auquel on répond (norme RFC),
        // pas le header In-Reply-To du message source
        inReplyTo: lastInbound?.internetMessageId || null,
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
