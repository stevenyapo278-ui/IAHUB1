const prisma = require('../prismaClient');
const { autoAssignTechnicianWithAI } = require('./ticketAutoAssign');
const { notifyNewPendingTicket } = require('./approvalReminderScheduler');
const { applySla } = require('./slaService');
const { scheduleEscalation } = require('./escalationService');
const { formatTicketTitle } = require('../utils/ticketTitle');

// Crée un ticket ERP à partir d'un email entrant analysé par l'IA.
// Retourne { erpTicketId }.
async function createTicketFromEmail({ subject, body, from, fromName, analysis, emailAccountId, locationId, locationName, lowTrustSender = false, tx = prisma, escalateMinutes = null, triageRuleId = null }) {
  // Titre EN MAJUSCULES, partie LIEU = lieu strictement résolu en base (INDÉTERMINÉ sinon)
  const title = formatTicketTitle(analysis.suggestedTitle || subject, locationName || null);

  const erpTicket = await tx.ticket.create({
    data: {
      title,
      content: body || '',
      status: 'NEW',
      approvalStatus: 'PENDING',
      priority: analysis.priority || 'P3',
      category: analysis.category || null,
      source: 'Email',
      origin: 'EMAIL',
      sourceEmail: from || null,
      sourceName: fromName || null,
      sourceSubject: subject || null,
      aiProcessed: true,
      aiSummary: analysis.summary || null,
      lowTrustSender,
      locationId: locationId || null,
      locationName: locationName || null,
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
  // (notifyAssignedTechnician dans autoAssignTechnicianWithAI envoie déjà l'email)
  try {
    const skillHint = analysis.suggestedSkill || analysis.category;
    await autoAssignTechnicianWithAI(erpTicket.id, analysis.category, skillHint);
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

  // Notification IMMÉDIATE à la Hotline quand le ticket est créé en attente d'approbation (PENDING).
  // Uniquement hors transaction (tx === prisma) : dans le pipeline email, la notification est
  // déclenchée par emailPipeline.js APRÈS le commit de la transaction — on évite ainsi le doublon.
  if (tx === prisma && erpTicket.approvalStatus === 'PENDING') {
    notifyNewPendingTicket(erpTicket.id).catch((err) =>
      console.error(`[ticketCreator] Échec notification hotline ticket ${erpTicket.id}:`, err.message)
    );
  }

  return { erpTicketId: erpTicket.id };
}

module.exports = { createTicketFromEmail };
