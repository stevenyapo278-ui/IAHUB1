const express = require('express');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

router.get('/stats', async (req, res) => {
  const [byStatus, byPriority, byTeam, total, openCount] = await Promise.all([
    prisma.ticket.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ['priority'], _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ['teamId'], _count: { _all: true } }),
    prisma.ticket.count(),
    prisma.ticket.count({ where: { status: { in: ['NEW', 'OPEN', 'PENDING'] } } }),
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
  const technicians = await prisma.user.findMany({
    where: { role: { in: ['TECHNICIAN', 'ADMIN'] }, isActive: true },
    select: { id: true, fullName: true, email: true },
  });

  const results = await Promise.all(
    technicians.map(async (tech) => {
      const [assigned, open, solved] = await Promise.all([
        prisma.ticket.count({ where: { assignedToId: tech.id } }),
        prisma.ticket.count({ where: { assignedToId: tech.id, status: { in: ['NEW', 'OPEN', 'PENDING'] } } }),
        prisma.ticket.count({ where: { assignedToId: tech.id, status: { in: ['SOLVED', 'CLOSED'] } } }),
      ]);
      return { id: tech.id, fullName: tech.fullName, email: tech.email, assigned, open, solved };
    })
  );

  return res.json(results.filter((r) => r.assigned > 0).sort((a, b) => b.assigned - a.assigned));
});

module.exports = router;
