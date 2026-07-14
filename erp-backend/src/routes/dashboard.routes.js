const express = require('express');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

router.get('/stats', async (req, res) => {
  const { startDate, endDate } = req.query;
  const where = {};
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      if (endDate.length <= 10) end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }

  const [byStatus, byPriority, byTeam, total, openCount] = await Promise.all([
    prisma.ticket.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ['priority'], where, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ['teamId'], where, _count: { _all: true } }),
    prisma.ticket.count({ where }),
    prisma.ticket.count({ where: { ...where, status: { in: ['NEW', 'OPEN', 'PENDING'] } } }),
  ]);

  const teamIds = byTeam.map((t) => t.teamId).filter((id) => id !== null);
  const teams = await prisma.team.findMany({
    where: { id: { in: teamIds } },
    select: { id: true, name: true },
  });
  const teamNameById = Object.fromEntries(teams.map((t) => [t.id, t.name]));

  return res.json({
    total,
    open: openCount,
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
    byPriority: byPriority.map((p) => ({ priority: p.priority, count: p._count._all })),
    byTeam: byTeam.map((t) => ({
      teamId: t.teamId,
      teamName: t.teamId ? teamNameById[t.teamId] || 'Inconnue' : 'Non assignée',
      count: t._count._all,
    })),
  });
});

// Tickets en attente d'approbation
router.get('/pending-approvals', async (req, res) => {
  const tickets = await prisma.ticket.findMany({
    where: { approvalStatus: 'PENDING' },
    include: {
      requester: { select: { id: true, fullName: true, email: true } },
      team: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 10,
  });
  return res.json(tickets);
});

// Activité récente / derniers tickets
router.get('/recent-activity', async (req, res) => {
  const tickets = await prisma.ticket.findMany({
    include: {
      requester: { select: { id: true, fullName: true, email: true } },
      assignedTo: { select: { id: true, fullName: true, email: true } },
      team: { select: { id: true, name: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 8,
  });
  return res.json(tickets);
});

// Tickets que l'IA n'a pas pu trancher avec assez de confiance (fermeture/réouverture refusée,
// limite de scission atteinte) et qui nécessitent une revue humaine.
router.get('/needs-human-review', async (req, res) => {
  const recentEvents = await prisma.ticketEvent.findMany({
    where: { type: 'NEEDS_HUMAN_REVIEW' },
    orderBy: { createdAt: 'desc' },
    take: 20,
    distinct: ['ticketId'],
    include: {
      ticket: { select: { id: true, title: true, status: true, glpiTicketId: true } },
    },
  });

  const stillWaiting = recentEvents.filter((e) => e.ticket?.status === 'WAITING_FOR_USER');
  return res.json(stillWaiting);
});

// Réponses IA en attente de validation
router.get('/pending-ai-drafts', async (req, res) => {
  const drafts = await prisma.aiEmailDraft.findMany({
    where: { status: 'PENDING' },
    include: {
      ticket: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 10,
  });
  return res.json(drafts);
});

// Statut des intégrations (GLPI, n8n, IA)
router.get('/integrations', async (req, res) => {
  const [apiConfigs, n8nWorkflows, aiProviders] = await Promise.all([
    prisma.apiConfig.findMany({ select: { id: true, serviceName: true, baseUrl: true, isActive: true } }),
    prisma.n8nWorkflow.findMany({ select: { id: true, name: true, isActive: true, lastRunAt: true, lastStatus: true } }),
    prisma.aiProvider.findMany({
      select: {
        id: true,
        name: true,
        label: true,
        isActive: true,
        keys: { select: { id: true, isActive: true, isDefault: true } },
        models: { select: { id: true, name: true, isActive: true, isDefault: true } },
      },
    }),
  ]);

  return res.json({
    apiConfigs: apiConfigs.map((c) => ({
      id: c.id,
      name: c.serviceName,
      connected: c.isActive && !!c.baseUrl,
      isActive: c.isActive,
    })),
    n8nWorkflows: n8nWorkflows.map((w) => ({
      id: w.id,
      name: w.name,
      isActive: w.isActive,
      lastRunAt: w.lastRunAt,
      lastStatus: w.lastStatus,
    })),
    aiProviders: aiProviders.map((p) => ({
      id: p.id,
      name: p.name,
      label: p.label,
      isActive: p.isActive,
      activeKeys: p.keys.filter((k) => k.isActive).length,
      activeModels: p.models.filter((m) => m.isActive).length,
      connected: p.isActive && p.keys.some((k) => k.isActive),
    })),
  });
});

// Performance par technicien
router.get('/technician-performance', async (req, res) => {
  const { startDate, endDate } = req.query;
  const dateFilter = {};
  if (startDate) dateFilter.gte = new Date(startDate);
  if (endDate) {
    const end = new Date(endDate);
    if (endDate.length <= 10) end.setHours(23, 59, 59, 999);
    dateFilter.lte = end;
  }
  const ticketDateWhere = (startDate || endDate) ? { createdAt: dateFilter } : {};

  const technicians = await prisma.user.findMany({
    where: { role: { in: ['TECHNICIAN', 'ADMIN'] }, isActive: true },
    select: { id: true, fullName: true, email: true },
  });

  const results = await Promise.all(
    technicians.map(async (tech) => {
      const [assigned, open, solved] = await Promise.all([
        prisma.ticket.count({ where: { assignedToId: tech.id, ...ticketDateWhere } }),
        prisma.ticket.count({ where: { assignedToId: tech.id, status: { in: ['NEW', 'OPEN', 'PENDING'] }, ...ticketDateWhere } }),
        prisma.ticket.count({ where: { assignedToId: tech.id, status: { in: ['SOLVED', 'CLOSED'] }, ...ticketDateWhere } }),
      ]);
      return { id: tech.id, fullName: tech.fullName, email: tech.email, assigned, open, solved };
    })
  );

  return res.json(results.filter((r) => r.assigned > 0).sort((a, b) => b.assigned - a.assigned));
});

// Tendance d'activité des tickets sur N jours (données réelles)
router.get('/activity-trend', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let since, until, days;

    if (startDate && endDate) {
      since = new Date(startDate);
      since.setHours(0, 0, 0, 0);
      until = new Date(endDate);
      until.setHours(23, 59, 59, 999);
      // Différence en jours
      const diffTime = Math.abs(until - since);
      days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (days > 365) days = 365; // Sécurité
    } else {
      days = Math.min(parseInt(req.query.days) || 30, 365);
      since = new Date();
      since.setDate(since.getDate() - days);
      since.setHours(0, 0, 0, 0);
      until = new Date();
    }

    // Récupère tous les tickets créés dans la période
    const tickets = await prisma.ticket.findMany({
      where: { createdAt: { gte: since, lte: until } },
      select: { createdAt: true, status: true, priority: true },
    });

    // Groupe par jour
    const byDay = {};
    for (let i = 0; i <= days; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      byDay[key] = { date: key, tickets: 0, resolved: 0 };
    }

    for (const t of tickets) {
      const key = t.createdAt.toISOString().slice(0, 10);
      if (byDay[key]) {
        byDay[key].tickets += 1;
        if (t.status === 'SOLVED' || t.status === 'CLOSED') byDay[key].resolved += 1;
      }
    }

    return res.json(Object.values(byDay));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Export rapport CSV
router.get('/report', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let since, until, periodStr;

    if (startDate && endDate) {
      since = new Date(startDate);
      since.setHours(0, 0, 0, 0);
      until = new Date(endDate);
      until.setHours(23, 59, 59, 999);
      periodStr = `du ${new Date(startDate).toLocaleDateString('fr-FR')} au ${new Date(endDate).toLocaleDateString('fr-FR')}`;
    } else {
      const days = Math.min(parseInt(req.query.days) || 30, 365);
      since = new Date();
      since.setDate(since.getDate() - days);
      since.setHours(0, 0, 0, 0);
      until = new Date();
      periodStr = `${days} derniers jours`;
    }

    const [tickets, techPerf, aiDrafts] = await Promise.all([
      prisma.ticket.findMany({
        where: { createdAt: { gte: since, lte: until } },
        include: {
          requester: { select: { fullName: true, email: true } },
          assignedTo: { select: { fullName: true } },
          team: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.findMany({
        where: { role: { in: ['TECHNICIAN', 'ADMIN'] }, isActive: true },
        select: { fullName: true, email: true },
      }),
      prisma.aiEmailDraft.count({ where: { status: 'APPROVED', createdAt: { gte: since, lte: until } } }),
    ]);

    const totalTickets = tickets.length;
    const resolved = tickets.filter((t) => ['SOLVED', 'CLOSED'].includes(t.status)).length;
    const p1 = tickets.filter((t) => t.priority === 'P1').length;
    const avgResolution = resolved > 0
      ? Math.round(
          tickets
            .filter((t) => ['SOLVED', 'CLOSED'].includes(t.status))
            .reduce((sum, t) => sum + (new Date(t.updatedAt) - new Date(t.createdAt)), 0) /
            resolved /
            (1000 * 60 * 60)
        )
      : 0;

    // Génération CSV
    const lines = [];
    lines.push(`Rapport ERP ITSM — ${new Date().toLocaleDateString('fr-FR')}`);
    lines.push(`Période: ${periodStr}`);
    lines.push('');
    lines.push('=== RÉSUMÉ ===');
    lines.push(`Total tickets,${totalTickets}`);
    lines.push(`Tickets résolus,${resolved}`);
    lines.push(`Taux résolution,${totalTickets > 0 ? Math.round((resolved / totalTickets) * 100) : 0}%`);
    lines.push(`Tickets P1 critiques,${p1}`);
    lines.push(`Délai résolution moyen (h),${avgResolution}`);
    lines.push(`Brouillons IA approuvés,${aiDrafts}`);
    lines.push(`Techniciens actifs,${techPerf.length}`);
    lines.push('');
    lines.push('=== TICKETS ===');
    lines.push('ID,Titre,Statut,Priorité,Demandeur,Assigné,Équipe,Créé le');
    for (const t of tickets) {
      lines.push([
        t.id,
        `"${(t.title || '').replace(/"/g, '""')}"`,
        t.status,
        t.priority,
        t.requester?.fullName || '',
        t.assignedTo?.fullName || '',
        t.team?.name || 'Non assignée',
        new Date(t.createdAt).toLocaleDateString('fr-FR'),
      ].join(','));
    }

    const csv = lines.join('\n');
    const filename = `rapport-itsm-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv); // BOM pour Excel
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
