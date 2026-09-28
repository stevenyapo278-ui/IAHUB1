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

  // Résoudre l'équipe suggérée par l'IA en teamId (si pas déjà résolu par le validateur)
  let resolvedTeamId = analysis._teamId || null;
  if (!resolvedTeamId && analysis.team) {
    try {
      const matchedTeam = await tx.team.findFirst({
        where: { name: { equals: analysis.team, mode: 'insensitive' } },
        select: { id: true },
      });
      resolvedTeamId = matchedTeam?.id || null;
    } catch (err) {
      console.error('[ticketCreator] Résolution équipe IA échouée:', err.message);
    }
  }
  // Fallback : résoudre par catégorie si l'équipe n'a pas été trouvée
  if (!resolvedTeamId && analysis.category) {
    try {
      const catTeam = await tx.team.findFirst({
        where: { name: { equals: analysis.category, mode: 'insensitive' } },
        select: { id: true },
      });
      resolvedTeamId = catTeam?.id || null;
    } catch (err) {
      console.error('[ticketCreator] Résolution équipe par catégorie échouée:', err.message);
    }
  }

  if (!resolvedTeamId) {
    console.warn(`[ticketCreator] Aucune équipe résolue pour ticket (team="${analysis.team}", category="${analysis.category}")`);
  }

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
      teamId: resolvedTeamId,
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

  // Attacher les observateurs de l'équipe : defaultObservers déjà renseignés
  // dans la vue Équipe (hors technicien assigné) —
  // voir ticketSuggestionService.suggestObservers.
  try {
    const current = await tx.ticket.findUnique({
      where: { id: erpTicket.id },
      select: { teamId: true, assignedToId: true, category: true },
    });
    const { suggestObservers } = require('./ticketSuggestionService');
    const suggested = await suggestObservers({
      teamId: current?.teamId || null,
      excludeIds: current?.assignedToId ? [current.assignedToId] : [],
      db: tx,
    });
    if (suggested.length > 0) {
      await tx.ticket.update({
        where: { id: erpTicket.id },
        data: { observers: { connect: suggested.map((o) => ({ id: o.id })) } },
      });
    }
  } catch (err) {
    console.error('[ticketCreator] Échec rattachement observateurs suggérés:', err.message);
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
