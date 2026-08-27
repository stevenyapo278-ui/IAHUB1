const prisma = require('../prismaClient');
const { autoAssignTechnicianWithAI } = require('./ticketAutoAssign');
const { sendAssignmentNotificationEmail } = require('./emailSender');
const { getSystemSettings } = require('./systemSettings');
const { applySla } = require('./slaService');
const { scheduleEscalation } = require('./escalationService');

// Crée un ticket ERP à partir d'un email entrant analysé par l'IA.
// Retourne { erpTicketId } — glpiTicketId a été retiré (plus d'intégration GLPI).
async function createTicketFromEmail({ subject, body, from, fromName, analysis, emailAccountId, locationId, lowTrustSender = false, tx = prisma, escalateMinutes = null, triageRuleId = null }) {
  const title = analysis.suggestedTitle || subject;

  const erpTicket = await tx.ticket.create({
    data: {
      title,
      content: body || '',
      status: 'NEW',
      approvalStatus: 'PENDING',
      priority: analysis.priority || 'P3',
      category: analysis.category || null,
      source: 'Email',
      sourceEmail: from || null,
      sourceName: fromName || null,
      sourceSubject: subject || null,
      aiProcessed: true,
      aiSummary: analysis.summary || null,
      lowTrustSender,
    },
  });

  // Échéances SLA calculées dès la création (priorité analysée par l'IA)
  try {
    await applySla(erpTicket);
  } catch (err) {
    console.error('[ticketCreator] Calcul SLA échoué:', err.message);
  }

  // Escalade automatique planifiée par la règle de triage (autoEscalateMinutes)
  if (escalateMinutes && escalateMinutes > 0) {
    try {
      await scheduleEscalation(erpTicket.id, escalateMinutes, triageRuleId);
    } catch (err) {
      console.error('[ticketCreator] Planification escalade échouée:', err.message);
    }
  }

  // Assigne automatiquement le meilleur technicien
  try {
    const skillHint = analysis.suggestedSkill || analysis.category;
    const assigned = await autoAssignTechnicianWithAI(erpTicket.id, analysis.category, skillHint);

    if (assigned) {
      const fullUser = await tx.user.findUnique({ where: { id: assigned.id } });
      if (fullUser?.email) {
        const settings = await getSystemSettings();
        if (settings.notifyTechnicianOnAssignment) {
          await sendAssignmentNotificationEmail({
            ticketId: erpTicket.id,
            ticketTitle: erpTicket.title,
            priority: erpTicket.priority,
            technicianEmail: fullUser.email,
            technicianName: fullUser.fullName,
            category: analysis.category,
          }).catch((err) => console.error('[ticketCreator] Échec envoi notification assignation:', err.message));
        }
      }
    }
  } catch (err) {
    console.error('[ticketCreator] Auto-assignation échouée:', err.message);
  }

  // Attacher automatiquement les observateurs par défaut de l'équipe associée
  try {
    const updatedTicket = await tx.ticket.findUnique({ where: { id: erpTicket.id }, select: { teamId: true } });
    if (updatedTicket?.teamId) {
      const teamObj = await tx.team.findUnique({
        where: { id: updatedTicket.teamId },
        include: { defaultObservers: { select: { id: true } } },
      });
      if (teamObj?.defaultObservers?.length > 0) {
        await tx.ticket.update({
          where: { id: erpTicket.id },
          data: {
            observers: {
              connect: teamObj.defaultObservers.map((o) => ({ id: o.id })),
            },
          },
        });
      }
    }
  } catch (err) {
    console.error('[ticketCreator] Échec rattachement observateurs équipe:', err.message);
  }

  return { erpTicketId: erpTicket.id };
}

module.exports = { createTicketFromEmail };
