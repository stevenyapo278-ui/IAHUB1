const prisma = require('../prismaClient');

// Statuts considérés comme "charge active" d'un technicien pour le calcul du moins chargé —
// un ticket déjà résolu/clos ne doit plus compter dans son équilibrage de charge.
const ACTIVE_STATUSES = ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER'];

// Trouve les techniciens compétents pour un domaine donné, triés par niveau de compétence
// puis par charge de travail. Retourne le meilleur candidat.
async function findBestTechnician(category, aiCategory) {
  const skillName = aiCategory || category;
  if (!skillName) return { team: null, technician: null };

  // Étape 1 : chercher par compétence exacte (assignation intelligente)
  const skilledUsers = await prisma.userSkill.findMany({
    where: {
      skill: { name: { equals: skillName, mode: 'insensitive' } },
      user: { isActive: true, role: { in: ['TECHNICIAN', 'ADMIN', 'SUPERADMIN'] } },
    },
    include: { user: { select: { id: true, fullName: true } } },
    orderBy: { level: 'desc' },
  });

  if (skilledUsers.length > 0) {
    const techIds = skilledUsers.map((s) => s.user.id);
    const loadCounts = await prisma.ticket.groupBy({
      by: ['assignedToId'],
      where: { assignedToId: { in: techIds }, status: { in: ACTIVE_STATUSES } },
      _count: { id: true },
    });
    const loadByUserId = Object.fromEntries(loadCounts.map((c) => [c.assignedToId, c._count.id]));

    // Trier par niveau de compétence (desc) puis charge (asc)
    const sorted = skilledUsers.sort((a, b) => {
      if (b.level !== a.level) return b.level - a.level;
      return (loadByUserId[a.user.id] || 0) - (loadByUserId[b.user.id] || 0);
    });

    const bestTech = sorted[0].user;
    // Résoudre l'équipe du technicien sélectionné
    const techWithTeam = await prisma.user.findUnique({
      where: { id: bestTech.id },
      select: { id: true, fullName: true, teamId: true, team: { select: { id: true, name: true } } },
    });
    const resolvedTeam = techWithTeam?.team || null;
    return { team: resolvedTeam, technician: { id: bestTech.id, fullName: bestTech.fullName }, skillLevel: sorted[0].level, method: 'skill' };
  }

  // Étape 1b : chercher par compétence partielle (ex: "PORT USB" contient "USB")
  if (skillName.length >= 3) {
    const words = skillName.split(/\s+/).filter((w) => w.length >= 3);
    for (const word of words) {
      const partialUsers = await prisma.userSkill.findMany({
        where: {
          skill: { name: { contains: word, mode: 'insensitive' } },
          user: { isActive: true, role: { in: ['TECHNICIAN', 'ADMIN', 'SUPERADMIN'] } },
        },
        include: { user: { select: { id: true, fullName: true } } },
        orderBy: { level: 'desc' },
      });

      if (partialUsers.length > 0) {
        const techIds = partialUsers.map((s) => s.user.id);
        const loadCounts = await prisma.ticket.groupBy({
          by: ['assignedToId'],
          where: { assignedToId: { in: techIds }, status: { in: ACTIVE_STATUSES } },
          _count: { id: true },
        });
        const loadByUserId = Object.fromEntries(loadCounts.map((c) => [c.assignedToId, c._count.id]));
        const sorted = partialUsers.sort((a, b) => {
          if (b.level !== a.level) return b.level - a.level;
          return (loadByUserId[a.user.id] || 0) - (loadByUserId[b.user.id] || 0);
        });
        const bestTech = sorted[0].user;
        // Résoudre l'équipe du technicien sélectionné
        const techWithTeam = await prisma.user.findUnique({
          where: { id: bestTech.id },
          select: { id: true, fullName: true, teamId: true, team: { select: { id: true, name: true } } },
        });
        const resolvedTeam = techWithTeam?.team || null;
        return { team: resolvedTeam, technician: { id: bestTech.id, fullName: bestTech.fullName }, skillLevel: sorted[0].level, method: 'skill_partial' };
      }
    }
  }

  // Étape 2 : fallback sur l'assignation par équipe (comportement existant)
  const team = await prisma.team.findFirst({
    where: { name: { equals: category, mode: 'insensitive' } },
    include: { members: { where: { role: { in: ['TECHNICIAN', 'ADMIN', 'SUPERADMIN'] }, isActive: true }, select: { id: true, fullName: true } } },
  });
  if (!team || team.members.length === 0) return { team: null, technician: null };

  const loadCounts = await prisma.ticket.groupBy({
    by: ['assignedToId'],
    where: { assignedToId: { in: team.members.map((m) => m.id) }, status: { in: ACTIVE_STATUSES } },
    _count: { id: true },
  });
  const loadByUserId = Object.fromEntries(loadCounts.map((c) => [c.assignedToId, c._count.id]));

  const leastLoaded = team.members.reduce((best, current) => {
    const currentLoad = loadByUserId[current.id] || 0;
    const bestLoad = loadByUserId[best.id] || 0;
    return currentLoad < bestLoad ? current : best;
  });

  return { team, technician: leastLoaded, method: 'team' };
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
// et l'assigne au ticket — le moins chargé parmi les candidats.
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
        reason: method === 'skill' ? 'assignation_ia_competence' : 'assignation_ia_equipe',
      },
    });
  } catch (err) {
    console.error('[ticketAutoAssign] Échec journalisation assignation:', err.message);
  }

  return technician;
}

module.exports = { autoAssignTechnician, autoAssignTechnicianWithAI, findBestTechnician };
