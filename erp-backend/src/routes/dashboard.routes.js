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

// Brouillons en attente de validation (réponses IA + relances automatiques)
router.get('/pending-ai-drafts', async (req, res) => {
  const drafts = await prisma.aiEmailDraft.findMany({
    where: { status: 'PENDING' },
    include: {
      ticket: { select: { id: true, title: true, glpiTicketId: true, approvalStatus: true, sourceEmail: true, sourceName: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });
  return res.json(drafts);
});

// Statut des intégrations (GLPI, n8n, IA)
router.get('/integrations', async (req, res) => {
  const [apiConfigs, n8nWorkflows, aiProviders] = await Promise.all([
    prisma.apiConfig.findMany({ select: { id: true, serviceName: true, baseUrl: true, isActive: true } }),
    prisma.n8nWorkflow.findMany({ select: { id: true, name: true, isActive: true, lastRunAt: true, lastStatus: true } }),
    prisma.aiProvider.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        name: true,
        label: true,
        isActive: true,
        keys: { select: { id: true, isActive: true, isDefault: true } },
        models: { where: { isDeleted: false }, select: { id: true, name: true, isActive: true, isDefault: true } },
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
     const format = req.query.format === 'pdf' ? 'pdf' : 'csv';
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

    if (format === 'pdf') {
      // Génération PDF via pdfkit
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({ size: 'A4', margin: 48 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => {
        const filename = `rapport-itsm-${new Date().toISOString().slice(0, 10)}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(Buffer.concat(chunks));
      });

      const head = (text) => { doc.font('Helvetica-Bold').fontSize(9).fillColor('#334155').text(text, { continued: false }); };
      const cell = (text, x, y, w) => doc.font('Helvetica').fontSize(7).fillColor('#0f172a').text(text, x, y, { width: w, lineBreak: false, ellipsis: true });

      doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f172a').text('Rapport ERP ITSM', 48, 48);
      doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(`Période : ${periodStr} — généré le ${new Date().toLocaleString('fr-FR')}`, 48, 70);

      doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text('Résumé', 48, 96);
      let y = 114;
      const summaryRows = [
        ['Total tickets', totalTickets],
        ['Tickets résolus', resolved],
        ['Taux de résolution', `${totalTickets > 0 ? Math.round((resolved / totalTickets) * 100) : 0}%`],
        ['Tickets P1 critiques', p1],
        ['Délai résolution moyen', `${avgResolution} h`],
        ['Brouillons IA approuvés', aiDrafts],
        ['Techniciens actifs', techPerf.length],
      ];
      for (const [label, value] of summaryRows) {
        doc.font('Helvetica').fontSize(8).fillColor('#334155').text(label, 48, y, { width: 200 });
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a').text(String(value), 250, y, { width: 100 });
        y += 14;
      }

      doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text('Tickets', 48, y + 8);
      y += 26;
      const cols = [28, 150, 45, 42, 120, 100, 75, 60];
      const headers = ['ID', 'Titre', 'Statut', 'Priorité', 'Demandeur', 'Assigné', 'Équipe', 'Créé le'];
      let x = 48;
      doc.rect(48, y - 14, 500, 14).fill('#f1f5f9');
      headers.forEach((h, i) => { cell(h, x, y - 12, cols[i]); x += cols[i]; });
      y += 8;
      for (const t of tickets) {
        if (y > 780) { doc.addPage(); y = 48; }
        x = 48;
        cell(String(t.id), x, y, cols[0]); x += cols[0];
        cell(t.title || '', x, y, cols[1]); x += cols[1];
        cell(t.status, x, y, cols[2]); x += cols[2];
        cell(t.priority, x, y, cols[3]); x += cols[3];
        cell(t.requester?.fullName || '', x, y, cols[4]); x += cols[4];
        cell(t.assignedTo?.fullName || '', x, y, cols[5]); x += cols[5];
        cell(t.team?.name || 'Non assignée', x, y, cols[6]); x += cols[6];
        cell(new Date(t.createdAt).toLocaleDateString('fr-FR'), x, y, cols[7]);
        y += 12;
      }

      doc.end();
      return;
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

// ── Pilotage SLA : respect des échéances, temps de réponse/résolution, CSAT ──
router.get('/sla-analytics', async (req, res) => {
  if (!['SUPERADMIN', 'ADMIN', 'TECHNICIAN', 'HOTLINE'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Accès réservé à l\'équipe' });
  }
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const tickets = await prisma.ticket.findMany({
      where: { createdAt: { gte: since } },
      select: {
        id: true, priority: true, status: true, createdAt: true, solvedAt: true,
        slaBreachedAt: true, slaResolutionDueAt: true, slaResponseDueAt: true,
        firstResponseAt: true, csatScore: true,
      },
    });

    const RESOLVED = ['SOLVED', 'CLOSED'];
    const OPEN = ['NEW', 'OPEN', 'PENDING'];

    // Statistiques par priorité
    const byPriority = {};
    for (const p of ['P1', 'P2', 'P3', 'P4']) {
      const pool = tickets.filter((t) => t.priority === p);
      const resolvedPool = pool.filter((t) => RESOLVED.includes(t.status));
      const withSla = pool.filter((t) => t.slaResolutionDueAt || t.slaResponseDueAt);
      const breached = pool.filter((t) => t.slaBreachedAt);
      const avgResolutionH = resolvedPool.length
        ? Math.round(
            resolvedPool.reduce((sum, t) => sum + (new Date(t.solvedAt) - new Date(t.createdAt)), 0) /
            resolvedPool.length / (1000 * 60 * 60) * 10) / 10
        : null;
      const avgFirstResponseH = pool.filter((t) => t.firstResponseAt).length
        ? Math.round(
            pool.filter((t) => t.firstResponseAt)
              .reduce((sum, t) => sum + (new Date(t.firstResponseAt) - new Date(t.createdAt)), 0) /
            pool.filter((t) => t.firstResponseAt).length / (1000 * 60 * 60) * 10) / 10
        : null;
      byPriority[p] = {
        total: pool.length,
        resolved: resolvedPool.length,
        open: pool.filter((t) => OPEN.includes(t.status)).length,
        withSla,
        breached: breached.length,
        breachRate: withSla.length ? Math.round((breached.length / withSla.length) * 100) : 0,
        avgResolutionHours: avgResolutionH,
        avgFirstResponseHours: avgFirstResponseH,
      };
    }

    // Tickets ouverts en retard SLA (échéance de résolution dépassée)
    const overdue = await prisma.ticket.findMany({
      where: {
        status: { in: OPEN },
        slaResolutionDueAt: { not: null, lt: new Date() },
        slaBreachedAt: null,
      },
      select: { id: true, title: true, priority: true, status: true, slaResolutionDueAt: true, assignedTo: { select: { fullName: true } } },
      orderBy: { slaResolutionDueAt: 'asc' },
      take: 50,
    });

    // CSAT global
    const rated = tickets.filter((t) => t.csatScore);
    const csat = {
      rated: rated.length,
      average: rated.length ? Math.round((rated.reduce((s, t) => s + t.csatScore, 0) / rated.length) * 10) / 10 : null,
      distribution: [5, 4, 3, 2, 1].map((star) => ({ star, count: rated.filter((t) => t.csatScore === star).length })),
    };

    const totals = {
      total: tickets.length,
      breached: tickets.filter((t) => t.slaBreachedAt).length,
      breachRate: tickets.filter((t) => t.slaResponseDueAt || t.slaResolutionDueAt).length
        ? Math.round((tickets.filter((t) => t.slaBreachedAt).length / tickets.filter((t) => t.slaResponseDueAt || t.slaResolutionDueAt).length) * 100)
        : 0,
    };

    return res.json({ days, byPriority, overdue, csat, totals });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Santé des suggestions de clôture : taux d'acceptation sur une fenêtre glissante
// (CLOSURE_VALIDATED vs CLOSURE_REJECTED par la Hotline). Permet de détecter une dérive de l'IA.
// Sert aussi au suivi de l'évolution : série temporelle journalière (suggérées/validées/rejetées)
// et file d'attente actuelle (tickets marqués closeSuggested=true) pour le Centre de Validation.
router.get('/closure-stats', async (req, res) => {
  const days = Math.min(parseInt(req.query.days, 10) || 30, 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const groups = await prisma.ticketEvent.groupBy({
    by: ['type'],
    where: { createdAt: { gte: since }, type: { in: ['CLOSURE_VALIDATED', 'CLOSURE_REJECTED'] } },
    _count: { _all: true },
  });

  const validated = groups.find((g) => g.type === 'CLOSURE_VALIDATED')?._count._all || 0;
  const rejected = groups.find((g) => g.type === 'CLOSURE_REJECTED')?._count._all || 0;
  const total = validated + rejected;

  // Série temporelle journalière : événements de clôture (suggérées + décisions Hotline)
  const events = await prisma.ticketEvent.findMany({
    where: {
      createdAt: { gte: since },
      type: { in: ['CLOSURE_SUGGESTED', 'CLOSURE_VALIDATED', 'CLOSURE_REJECTED'] },
    },
    select: { type: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const toDayKey = (d) => d.toISOString().slice(0, 10);
  const byDay = new Map();
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    byDay.set(toDayKey(d), { date: toDayKey(d), suggested: 0, validated: 0, rejected: 0 });
  }
  for (const e of events) {
    const bucket = byDay.get(toDayKey(new Date(e.createdAt)));
    if (!bucket) continue;
    if (e.type === 'CLOSURE_SUGGESTED') bucket.suggested += 1;
    else if (e.type === 'CLOSURE_VALIDATED') bucket.validated += 1;
    else bucket.rejected += 1;
  }

  const pending = await prisma.ticket.count({ where: { closeSuggested: true } });
  const suggested = events.filter((e) => e.type === 'CLOSURE_SUGGESTED').length;

  return res.json({
    days,
    suggested,
    validated,
    rejected,
    total,
    pending,
    acceptanceRate: total > 0 ? Math.round((validated / total) * 1000) / 10 : null,
    lowTrust: await prisma.senderReputation.count({ where: { closureStatus: 'LOW_TRUST_CLOSURE' } }),
    series: [...byDay.values()],
  });
});

module.exports = router;
