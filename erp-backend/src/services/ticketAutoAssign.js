const prisma = require('../prismaClient');
const { scoreCandidates } = require('./ticketSuggestionService');

// Statuts considérés comme "charge active" d'un technicien pour le calcul du moins chargé —
// un ticket déjà résolu/clos ne doit plus compter dans son équilibrage de charge.
const ACTIVE_STATUSES = ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER'];
// Même périmètre que /dashboard/stats : la corbeille et les tickets en attente
// d'approbation (ou rejetés) n'entrent jamais dans le calcul de charge.
const CHARGE_BASE = { deletedAt: null, approvalStatus: { notIn: ['PENDING', 'REJECTED'] } };

// Trouve le meilleur technicien pour un domaine donné : tous les candidats
// (compétence exacte → partielle → équipe) sont scorés avec la compétence
// (UserSkill), l'historique (tickets de même catégorie résolus, auto-assignations
// corrigées) et la charge active — voir ticketSuggestionService.scoreCandidates.
async function findBestTechnician(category, aiCategory) {
  const skillName = aiCategory || category;
  if (!skillName) return { team: null, technician: null };

  const { ranked, method } = await scoreCandidates(skillName, category, category);
  if (ranked.length === 0) return { team: null, technician: null };

  const best = ranked[0];
  // Résoudre l'équipe du technicien sélectionné (ou par nom si méthode équipe)
  let team = null;
  if (best.teamId) {
    team = await prisma.team.findUnique({ where: { id: best.teamId }, select: { id: true, name: true } });
  }
  if (!team) {
    team = await prisma.team.findFirst({
      where: { name: { equals: category, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
  }
  return {
    team,
    technician: { id: best.id, fullName: best.fullName },
    skillLevel: best.skillLevel,
    score: best.score,
    method: best.method || method,
  };
}

const { sendAssignmentNotificationEmail } = require('./emailSender');

async function notifyAssignedTechnician(ticketId, technicianId) {
  try {
    const fullTech = await prisma.user.findUnique({ where: { id: technicianId }, select: { email: true, fullName: true } });
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { id: true, title: true, priority: true, category: true } });
    if (fullTech?.email && ticket) {
      await sendAssignmentNotificationEmail({
        ticketId: ticket.id,
        ticketTitle: ticket.title,
        priority: ticket.priority,
        technicianEmail: fullTech.email,
        technicianName: fullTech.fullName,
        category: ticket.category,
      });
    }
  } catch (err) {
    console.error(`[ticketAutoAssign] Échec notification email technicien (${technicianId}):`, err.message);
  }
}

// Choisit automatiquement un technicien (par compétence d'abord, puis par équipe)
// et l'assigne au ticket — le meilleur score compétence + historique + charge.
// Retourne le technicien assigné ou null.
async function autoAssignTechnician(ticketId, category) {
  const { team, technician } = await findBestTechnician(category, null);
  if (!technician) return null;

  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true } });
  await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      assignedToId: technician.id,
      assignees: { set: [{ id: technician.id }] },
      teamId: team?.id || null,
      ...(ticket?.status === 'NEW' ? { status: 'OPEN' } : {}),
    },
  });

  notifyAssignedTechnician(ticketId, technician.id).catch(() => {});

  return technician;
}

// Version enrichie qui utilise aussi la catégorie IA (pour le pipeline email)
async function autoAssignTechnicianWithAI(ticketId, category, aiCategory) {
  const { team, technician, method } = await findBestTechnician(category, aiCategory);
  if (!technician) return null;

  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true } });
  await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      assignedToId: technician.id,
      assignees: { set: [{ id: technician.id }] },
      teamId: team?.id || null,
      ...(ticket?.status === 'NEW' ? { status: 'OPEN' } : {}),
    },
  });

  notifyAssignedTechnician(ticketId, technician.id).catch(() => {});

  // Journaliser l'assignation automatique pour le suivi de précision
  try {
    await prisma.reassignmentLog.create({
      data: {
        ticketId,
        newTechnicianId: technician.id,
        wasAutoAssigned: true,
        reason: method === 'skill' ? 'assignation_ia_competence'
          : method === 'skill_partial' ? 'assignation_ia_competence_partielle'
          : 'assignation_ia_equipe',
      },
    });
  } catch (err) {
    console.error('[ticketAutoAssign] Échec journalisation assignation:', err.message);
  }

  return technician;
}

module.exports = { autoAssignTechnician, autoAssignTechnicianWithAI, findBestTechnician };
