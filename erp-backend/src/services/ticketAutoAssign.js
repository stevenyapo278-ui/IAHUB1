const prisma = require('../prismaClient');

// Statuts considérés comme "charge active" d'un technicien pour le calcul du moins chargé —
// un ticket déjà résolu/clos ne doit plus compter dans son équilibrage de charge.
const ACTIVE_STATUSES = ['NEW', 'OPEN', 'PENDING', 'WAITING_FOR_USER'];

// Choisit automatiquement un technicien de l'équipe correspondant à `category` (le nom de
// catégorie d'un ticket correspond directement au nom de Team, cf. seed.js et GLPI_TECHNICIANS) et
// l'assigne au ticket — le moins chargé en tickets actifs parmi les membres TECHNICIAN de l'équipe.
// Ne fait rien si la catégorie ne correspond à aucune équipe connue, ou si l'équipe n'a aucun
// technicien (le ticket reste alors non assigné, comme avant — pas d'erreur ni de blocage).
async function autoAssignTechnician(ticketId, category) {
  if (!category) return null;

  const team = await prisma.team.findUnique({
    where: { name: category },
    include: { members: { where: { role: 'TECHNICIAN', isActive: true }, select: { id: true, glpiId: true, fullName: true } } },
  });
  if (!team || team.members.length === 0) return null;

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

  await prisma.ticket.update({ where: { id: ticketId }, data: { assignedToId: leastLoaded.id, teamId: team.id } });
  return leastLoaded;
}

module.exports = { autoAssignTechnician };
