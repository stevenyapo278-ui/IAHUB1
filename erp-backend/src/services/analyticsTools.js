const prisma = require('../prismaClient');

/**
 * Normalise une période en date de début
 */
function parsePeriod(period) {
  if (!period) return null;
  const now = new Date();

  // Aujourd'hui minuit (alias 'today' utilisé par le chatbot et l'assistant vocal)
  if (period === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  // Périodes nommées
  if (period === '1d' || period === 'yesterday') {
    const d = period === 'yesterday' ? new Date(now.getTime() - 86400000) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return d;
  }
  if (period === 'this_week') {
    const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
  }
  if (period === 'last_week') {
    const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek - 7);
  }
  if (period === 'this_month') {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  if (period === 'last_month') {
    return new Date(now.getFullYear(), now.getMonth() - 1, 1);
  }
  if (period === 'year' || period === '365d') {
    return new Date(now.getFullYear(), 0, 1);
  }
  if (period === 'last_year') {
    return new Date(now.getFullYear() - 1, 0, 1);
  }

  // Périodes en jours
  if (period === '7d' || period === '7_days') {
    return new Date(now.getTime() - 7 * 86400000);
  }
  if (period === '30d' || period === '30_days') {
    return new Date(now.getTime() - 30 * 86400000);
  }
  if (period === '90d' || period === '90_days') {
    return new Date(now.getTime() - 90 * 86400000);
  }

  // "Xj" dynamique
  const dayMatch = period.match(/^(\d+)d$/);
  if (dayMatch) {
    return new Date(now.getTime() - parseInt(dayMatch[1]) * 86400000);
  }

  return null; // tout l'historique
}

/**
 * 1. Classement & Agrégation des Tickets par Magasin / Lieu GLPI
 */
async function getTopLocationsStats({ filterKeyword, period, limit = 5, sortByUrgent = false }) {
  const startDate = parsePeriod(period);
  const where = { deletedAt: null, approvalStatus: { notIn: ['PENDING', 'REJECTED'] } };
  if (startDate) where.createdAt = { gte: startDate };

  if (filterKeyword && filterKeyword.trim()) {
    const kw = filterKeyword.trim();
    where.OR = [
      { title: { contains: kw, mode: 'insensitive' } },
      { content: { contains: kw, mode: 'insensitive' } },
      { locationName: { contains: kw, mode: 'insensitive' } },
    ];
  }

  // groupBy DB — évite de charger tous les tickets en mémoire
  const groups = await prisma.ticket.groupBy({
    by: ['locationName'],
    where,
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: (Number(limit) || 5) * 3,
  });

  const locNames = groups.map((g) => g.locationName).filter(Boolean);
  const [urgentGroups, resolvedGroups] = await Promise.all([
    locNames.length
      ? prisma.ticket.groupBy({ by: ['locationName'], where: { ...where, locationName: { in: locNames }, priority: { in: ['P1', 'P2'] } }, _count: { id: true } })
      : [],
    locNames.length
      ? prisma.ticket.groupBy({ by: ['locationName'], where: { ...where, locationName: { in: locNames }, status: { in: ['SOLVED', 'CLOSED'] } }, _count: { id: true } })
      : [],
  ]);
  const urgentMap = new Map(urgentGroups.map((g) => [g.locationName, g._count.id]));
  const resolvedMap = new Map(resolvedGroups.map((g) => [g.locationName, g._count.id]));

  // Tickets sans lieu (null)
  const nullGroup = groups.find((g) => g.locationName === null);
  let nullCounts = { urgent: 0, resolved: 0 };
  let grandTotal = await prisma.ticket.count({ where });
  if (nullGroup) {
    const [nu, nr] = await Promise.all([
      prisma.ticket.count({ where: { ...where, locationName: null, priority: { in: ['P1', 'P2'] } } }),
      prisma.ticket.count({ where: { ...where, locationName: null, status: { in: ['SOLVED', 'CLOSED'] } } }),
    ]);
    nullCounts = { urgent: nu, resolved: nr };
  }

  const mapped = groups.map((g) => {
    const name = g.locationName || 'Non spécifié / Magasin Inconnu';
    return {
      locationId: 'unknown',
      locationName: name,
      total: g._count.id,
      urgentCount: g.locationName === null ? nullCounts.urgent : (urgentMap.get(g.locationName) || 0),
      resolvedCount: g.locationName === null ? nullCounts.resolved : (resolvedMap.get(g.locationName) || 0),
    };
  });

  // Tri : par tickets critiques (P1) décroissants si demandé, sinon par total décroissant
  const sorted = [...mapped]
    .sort((a, b) =>
      sortByUrgent
        ? (b.urgentCount - a.urgentCount) || (b.total - a.total)
        : b.total - a.total
    )
    .slice(0, Number(limit) || 5);

  return {
    totalTicketsAnalyzed: grandTotal,
    filterKeyword: filterKeyword || null,
    period: period || 'all',
    rankings: sorted.map((loc, idx) => ({
      rank: idx + 1,
      locationName: loc.locationName,
      totalTickets: loc.total,
      percentage: grandTotal > 0 ? Math.round((loc.total / grandTotal) * 100) : 0,
      urgentTickets: loc.urgentCount,
      resolvedTickets: loc.resolvedCount,
    })),
    // Data formatée directement pour Recharts
    chartData: sorted.map((loc) => ({
      name: loc.locationName.split('>').pop().trim(), // nom court pour le graphique
      fullName: loc.locationName,
      Tickets: loc.total,
      Urgents: loc.urgentCount,
    })),
  };
}

/**
 * 2. Répartition par Catégorie d'Incidents
 */
async function getCategoryDistribution({ locationId, period, filterKeyword, limit = 6 }) {
  const startDate = parsePeriod(period);
  const where = { deletedAt: null, approvalStatus: { notIn: ['PENDING', 'REJECTED'] } };
  if (startDate) where.createdAt = { gte: startDate };
  if (locationId) where.locationId = Number(locationId);

  if (filterKeyword) {
    const kw = filterKeyword.trim();
    where.OR = [
      { title: { contains: kw, mode: 'insensitive' } },
      { content: { contains: kw, mode: 'insensitive' } },
    ];
  }

  const groups = await prisma.ticket.groupBy({
    by: ['category'],
    where,
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: Number(limit) || 6,
  });

  const sorted = groups.map((g) => ({ name: g.category || 'Non catégorisé', count: g._count.id }));
  const grandTotal = await prisma.ticket.count({ where });

  return {
    totalTickets: grandTotal,
    categories: sorted,
    chartData: sorted.map((item) => ({
      name: item.name,
      valeur: item.count,
    })),
  };
}

/**
 * 3. Statistiques de Performance & SLA par Équipe
 */
async function getPerformanceMetrics({ teamId, period }) {
  const startDate = parsePeriod(period);
  const where = {};
  if (startDate) where.createdAt = { gte: startDate };
  if (teamId) where.teamId = Number(teamId);

  // ⚠️ Le champ Prisma est `solvedAt` — `resolvedAt` n'existe pas sur Ticket et lève
  // PrismaClientValidationError (crash de la route appelante).
  const tickets = await prisma.ticket.findMany({
    where,
    select: {
      id: true,
      status: true,
      createdAt: true,
      solvedAt: true,
      closedAt: true,
      team: { select: { name: true } },
    },
  });

  const total = tickets.length;
  const resolved = tickets.filter((t) => t.status === 'SOLVED' || t.status === 'CLOSED');

  let totalResolutionHours = 0;
  let resolvedWithTime = 0;

  for (const t of resolved) {
    const resolvedDate = t.solvedAt || t.closedAt;
    if (resolvedDate && t.createdAt) {
      const diffMs = new Date(resolvedDate) - new Date(t.createdAt);
      const hours = diffMs / (1000 * 60 * 60);
      if (hours > 0 && hours < 1000) {
        totalResolutionHours += hours;
        resolvedWithTime += 1;
      }
    }
  }

  const avgResolutionHours = resolvedWithTime > 0 ? (totalResolutionHours / resolvedWithTime).toFixed(1) : null;
  const resolutionRate = total > 0 ? Math.round((resolved.length / total) * 100) : 0;

  return {
    totalTickets: total,
    resolvedCount: resolved.length,
    resolutionRatePercent: resolutionRate,
    avgResolutionTimeHours: avgResolutionHours ? `${avgResolutionHours}h` : 'N/A',
  };
}

/**
 * 4. Analyse de Cause Racine ("Pourquoi ?")
 */
async function analyzeRootCause({ locationName, filterKeyword, limit = 15 }) {
  const where = {};

  // Ticket n'a pas de relation `location` — filtrer sur le nom résolu locationName
  if (locationName) {
    where.locationName = { contains: locationName, mode: 'insensitive' };
  }

  if (filterKeyword) {
    // Les conditions de premier niveau sont combinées en AND par Prisma
    const kw = filterKeyword.trim();
    where.OR = [
      { title: { contains: kw, mode: 'insensitive' } },
      { content: { contains: kw, mode: 'insensitive' } },
    ];
  }

  const tickets = await prisma.ticket.findMany({
    where,
    take: Number(limit) || 15,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      content: true,
      category: true,
      status: true,
      createdAt: true,
      locationName: true,
    },
  });

  return {
    sampleCount: tickets.length,
    locationTarget: locationName || 'Global',
    ticketsSample: tickets.map((t) => ({
      id: t.id,
      subject: t.title, // les consommateurs attendent `subject`
      category: t.category,
      summarySnippet: (t.content || '').slice(0, 150),
    })),
  };
}

/**
 * 5. Répartition des tickets ouverts par équipe (pour réunions hebdo)
 */
async function getTeamDistribution({ period } = {}) {
  const startDate = parsePeriod(period);
  const where = { deletedAt: null, status: { notIn: ['CLOSED', 'SOLVED'] }, approvalStatus: { notIn: ['PENDING', 'REJECTED'] } };
  if (startDate) where.createdAt = { gte: startDate };

  const groups = await prisma.ticket.groupBy({
    by: ['teamId'],
    where,
    _count: { id: true },
  });

  // Résoudre les noms d'équipes
  const teamIds = groups.map((g) => g.teamId).filter(Boolean);
  const teams = teamIds.length ? await prisma.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true } }) : [];
  const teamNameById = new Map(teams.map((t) => [t.id, t.name]));

  // Urgents et répartition par statut en parallèle
  const [urgentGroups, statusGroups] = await Promise.all([
    prisma.ticket.groupBy({ by: ['teamId'], where: { ...where, priority: 'P1' }, _count: { id: true } }),
    prisma.ticket.groupBy({ by: ['teamId', 'status'], where, _count: { id: true } }),
  ]);
  const urgentMap = new Map(urgentGroups.map((g) => [g.teamId, g._count.id]));
  const statusMap = new Map(statusGroups.map((g) => [`${g.teamId ?? 'null'}:${g.status}`, g._count.id]));

  let unassignedCount = 0;
  const teamMap = new Map();
  for (const g of groups) {
    const teamName = g.teamId ? (teamNameById.get(g.teamId) || 'Non assigné') : 'Non assigné';
    if (!g.teamId) unassignedCount = g._count.id;
    teamMap.set(teamName, {
      teamName,
      total: g._count.id,
      urgent: urgentMap.get(g.teamId) || 0,
      byStatus: {
        NEW: statusMap.get(`${g.teamId ?? 'null'}:NEW`) || 0,
        OPEN: statusMap.get(`${g.teamId ?? 'null'}:OPEN`) || 0,
        PENDING: statusMap.get(`${g.teamId ?? 'null'}:PENDING`) || 0,
        SOLVED: statusMap.get(`${g.teamId ?? 'null'}:SOLVED`) || 0,
      },
    });
  }

  const sorted = Array.from(teamMap.values()).sort((a, b) => b.total - a.total);
  const totalOpen = groups.reduce((s, g) => s + g._count.id, 0);

  return {
    totalOpen,
    unassignedCount,
    teams: sorted,
    chartData: sorted.map((t) => ({
      name: t.teamName,
      Total: t.total,
      Tickets: t.total,
      Urgents: t.urgent,
      Non_assignés: t.teamName === 'Non assigné' ? t.total : 0,
    })),
  };
}

/**
 * 6. Détail des tickets ouverts par équipe (liste)
 */
async function getOpenTicketsByTeam({ teamName, limit = 20 } = {}) {
  const where = { deletedAt: null, status: { notIn: ['CLOSED', 'SOLVED'] }, approvalStatus: { notIn: ['PENDING', 'REJECTED'] } };

  if (teamName) {
    where.team = { name: { contains: teamName, mode: 'insensitive' } };
  }

  const tickets = await prisma.ticket.findMany({
    where,
    take: limit,
    orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    include: {
      requester: { select: { fullName: true } },
      assignedTo: { select: { fullName: true } },
      team: { select: { name: true } },
    },
  });

  return tickets.map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    status: t.status,
    team: t.team?.name || 'Non assigné',
    requester: t.requester?.fullName || 'Inconnu',
    assignedTo: t.assignedTo?.fullName || 'Non assigné',
    createdAt: t.createdAt,
  }));
}

module.exports = {
  getTopLocationsStats,
  getCategoryDistribution,
  getPerformanceMetrics,
  analyzeRootCause,
  getTeamDistribution,
  getOpenTicketsByTeam,
  parsePeriod,
};
