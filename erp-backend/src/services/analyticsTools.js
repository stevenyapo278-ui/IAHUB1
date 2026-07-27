const prisma = require('../prismaClient');

/**
 * Normalise une période en date de début
 */
function parsePeriod(period) {
  const now = new Date();
  if (period === '7d' || period === '7_days') {
    return new Date(now.setDate(now.getDate() - 7));
  }
  if (period === '30d' || period === '30_days' || period === 'this_month') {
    return new Date(now.setDate(now.getDate() - 30));
  }
  if (period === '90d' || period === '90_days') {
    return new Date(now.setDate(now.getDate() - 90));
  }
  if (period === 'year' || period === '365d') {
    return new Date(now.setDate(now.getDate() - 365));
  }
  return null; // tout l'historique
}

/**
 * 1. Classement & Agrégation des Tickets par Magasin / Lieu GLPI
 */
async function getTopLocationsStats({ filterKeyword, period, limit = 5 }) {
  const startDate = parsePeriod(period);
  
  const where = {};
  if (startDate) {
    where.createdAt = { gte: startDate };
  }

  // Si un mot clé est fourni (ex: "asten", "caisse", "imprimante")
  if (filterKeyword && filterKeyword.trim()) {
    const kw = filterKeyword.trim();
    where.OR = [
      { title: { contains: kw, mode: 'insensitive' } },
      { content: { contains: kw, mode: 'insensitive' } },
      { location: { name: { contains: kw, mode: 'insensitive' } } },
      { location: { completename: { contains: kw, mode: 'insensitive' } } },
    ];
  }

  // Récupère les tickets avec leur location
  const tickets = await prisma.ticket.findMany({
    where,
    select: {
      id: true,
      priority: true,
      status: true,
      createdAt: true,
      glpiLocationId: true,
      location: {
        select: {
          id: true,
          name: true,
          completename: true,
        },
      },
    },
  });

  // Groupement par Lieu
  const locationMap = new Map();

  for (const t of tickets) {
    const locName = t.location?.completename || t.location?.name || 'Non spécifié / Magasin Inconnu';
    const locId = t.glpiLocationId || 'unknown';

    if (!locationMap.has(locName)) {
      locationMap.set(locName, {
        locationId: locId,
        locationName: locName,
        total: 0,
        urgentCount: 0,
        resolvedCount: 0,
      });
    }

    const item = locationMap.get(locName);
    item.total += 1;
    if (t.priority === 'P1' || t.priority === 'URGENT') item.urgentCount += 1;
    if (t.status === 'RESOLVED' || t.status === 'CLOSED') item.resolvedCount += 1;
  }

  // Tri par total décroissant
  const sorted = Array.from(locationMap.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, Number(limit) || 5);

  const grandTotal = tickets.length;

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
  const where = {};
  if (startDate) where.createdAt = { gte: startDate };
  if (locationId) where.glpiLocationId = Number(locationId);

  if (filterKeyword) {
    const kw = filterKeyword.trim();
    where.OR = [
      { title: { contains: kw, mode: 'insensitive' } },
      { content: { contains: kw, mode: 'insensitive' } },
    ];
  }

  const tickets = await prisma.ticket.findMany({
    where,
    select: {
      category: true,
      priority: true,
    },
  });

  const catMap = new Map();
  for (const t of tickets) {
    const cat = t.category || 'Non catégorisé';
    catMap.set(cat, (catMap.get(cat) || 0) + 1);
  }

  const sorted = Array.from(catMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, Number(limit) || 6);

  return {
    totalTickets: tickets.length,
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

  const tickets = await prisma.ticket.findMany({
    where,
    select: {
      id: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
      team: { select: { name: true } },
    },
  });

  const total = tickets.length;
  const resolved = tickets.filter((t) => t.status === 'RESOLVED' || t.status === 'CLOSED');

  let totalResolutionHours = 0;
  let resolvedWithTime = 0;

  for (const t of resolved) {
    if (t.resolvedAt && t.createdAt) {
      const diffMs = new Date(t.resolvedAt) - new Date(t.createdAt);
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
  
  if (locationName) {
    where.OR = [
      { location: { name: { contains: locationName, mode: 'insensitive' } } },
      { location: { completename: { contains: locationName, mode: 'insensitive' } } },
    ];
  }

  if (filterKeyword) {
    const kw = filterKeyword.trim();
    const kwCond = [
      { title: { contains: kw, mode: 'insensitive' } },
      { content: { contains: kw, mode: 'insensitive' } },
    ];
    if (where.OR) {
      where.AND = [{ OR: where.OR }, { OR: kwCond }];
      delete where.OR;
    } else {
      where.OR = kwCond;
    }
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
      location: { select: { completename: true } },
    },
  });

  return {
    sampleCount: tickets.length,
    locationTarget: locationName || 'Global',
    ticketsSample: tickets.map((t) => ({
      id: t.id,
      title: t.title,
      category: t.category,
      summarySnippet: (t.content || '').slice(0, 150),
    })),
  };
}

module.exports = {
  getTopLocationsStats,
  getCategoryDistribution,
  getPerformanceMetrics,
  analyzeRootCause,
};
