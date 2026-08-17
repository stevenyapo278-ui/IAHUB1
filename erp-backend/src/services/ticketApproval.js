const prisma = require('../prismaClient');
const { createGlpiTicket } = require('./glpiTicketCreator');
const { logEvent } = require('./ticketEvent');
const { auditLog } = require('./auditLogService');
const { uploadPendingAttachments } = require('./emailAttachmentProcessor');
const { emitTicketUpdated } = require('../utils/socket');
const { recordDecision } = require('./senderReputation');

// Approuve un ticket : crée le ticket GLPI correspondant si la création GLPI est activée et
// configurée, passe le ticket en APPROVED, journalise (événement + audit), notifie en temps réel
// et renvoie le ticket mis à jour avec les éventuels avertissements (GLPI non configuré, erreur).
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

  let glpiTicketId = existing.glpiTicketId;

  // Réinitialiser les IDs négatifs (dry-run fake) pour permettre un retry
  if (glpiTicketId && glpiTicketId < 0) {
    glpiTicketId = null;
  }

  let glpiCreationError = null;
  let glpiSkippedReason = null;

  // Vérifier en amont si la création GLPI est désactivée pour prévenir l'utilisateur
  if (!glpiTicketId) {
    const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
    if (settings?.enableGlpiTicketCreation === false) {
      glpiSkippedReason = 'Création GLPI automatique désactivée dans les paramètres';
    } else {
      try {
        glpiTicketId = await createGlpiTicket({
          title: existing.title,
          content: existing.content,
          priority: existing.priority,
          category: existing.category,
          type: existing.type,
          urgency: existing.urgency,
          impact: existing.impact,
          source: existing.source,
          locationId: existing.glpiLocationId,
        });
        // Si createGlpiTicket retourne null sans exception (ex: GLPI non configuré)
        if (!glpiTicketId) {
          glpiSkippedReason = 'GLPI non configuré — aucune synchronisation effectuée';
        }
      } catch (err) {
        console.error('[ticketApproval] Création GLPI lors de l\'approbation échouée:', err.message);
        glpiCreationError = err.message;
      }
    }
  }

  const ticket = await prisma.ticket.update({
    where: { id },
    data: {
      approvalStatus: 'APPROVED',
      approvedById,
      approvedAt: new Date(),
      approvalNote: approvalNote || null,
      ...(glpiTicketId ? { glpiTicketId, lastGlpiSyncAt: new Date() } : {}),
    },
  });

  if (glpiCreationError) {
    await logEvent(id, 'GLPI_SYNC_FAILED', 'SYSTEM', { action: 'approve-create', error: glpiCreationError });
  } else {
    await logEvent(id, 'APPROVED', approvedByEmail, { glpiTicketId, glpiSkippedReason });
    await auditLog('TICKET_APPROVED', {
      actor: { sub: approvedById, email: approvedByEmail },
      targetType: 'Ticket',
      targetId: id,
      targetLabel: ticket.title,
      metadata: { glpiTicketId, glpiSkippedReason },
    });
    // Uploader les pièces jointes en attente (stockées localement en attendant GLPI)
    if (glpiTicketId) {
      uploadPendingAttachments(id, glpiTicketId).then((uploaded) => {
        if (uploaded.length > 0) {
          console.log(`[ticketApproval] ${uploaded.length} pièce(s) jointe(s) uploadée(s) vers GLPI pour le ticket #${id}`);
        }
      }).catch((err) => {
        console.error(`[ticketApproval] Échec upload pièces jointes différées pour le ticket #${id}:`, err.message);
      });
    }
  }

  emitTicketUpdated(ticket, { approvalStatus: 'APPROVED', glpiTicketId });

  // Boucle de rétroaction : l'approbation renforce la réputation de l'expéditeur
  if (ticket.sourceEmail) {
    recordDecision({ email: ticket.sourceEmail, decision: 'APPROVED' })
      .catch((err) => console.error('[senderReputation] Échec enregistrement approbation:', err.message));
  }

  // Associer l'expéditeur au lieu (RequesterLocation) pour les prochains emails
  if (ticket.sourceEmail && ticket.glpiLocationId) {
    try {
      const glpiLoc = await prisma.glpiLocation.findFirst({
        where: { glpiLocationId: ticket.glpiLocationId },
        select: { id: true },
      });
      if (glpiLoc) {
        await prisma.requesterLocation.upsert({
          where: { email_glpiLocationId: { email: ticket.sourceEmail.toLowerCase().trim(), glpiLocationId: glpiLoc.id } },
          update: { assignmentCount: { increment: 1 }, lastUsedAt: new Date(), assignedById: approvedById },
          create: { email: ticket.sourceEmail.toLowerCase().trim(), glpiLocationId: glpiLoc.id, assignedById: approvedById },
        });
      }
    } catch (err) {
      console.error('[ticketApproval] Échec auto-association RequesterLocation:', err.message);
    }
  }

  return {
    ...ticket,
    ...(glpiSkippedReason ? { warning: glpiSkippedReason } : {}),
    ...(glpiCreationError ? { glpiCreationError } : {}),
  };
}

module.exports = { approveTicket };
