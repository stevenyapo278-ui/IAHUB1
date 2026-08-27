const express = require('express');
const cacheStore = require('../services/cacheStore');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { auditLog } = require('../services/auditLogService');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  const { search, limit } = req.query;
  const where = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { category: { contains: search, mode: 'insensitive' } }
    ];
  }
  const teams = await prisma.team.findMany({
    where,
    take: limit ? Number(limit) : undefined,
    include: {
      members: { select: { id: true, fullName: true, email: true, role: true } },
      defaultObservers: { select: { id: true, fullName: true, email: true, role: true } },
      _count: { select: { tickets: { where: { status: { notIn: ['SOLVED', 'CLOSED'] } } } } },
    },
    orderBy: { name: 'asc' },
  });
  return res.json(teams);
});

// Statuts comptant comme "charge active" — alignés sur ticketAutoAssign.js, pour que ce qui
// s'affiche ici corresponde exactement à ce que l'auto-assignation utilise pour choisir le moins chargé.
const ACTIVE_STATUSES = ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER'];

router.get('/:id', async (req, res) => {
  const team = await prisma.team.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      members: { select: { id: true, fullName: true, email: true, role: true } },
      defaultObservers: { select: { id: true, fullName: true, email: true, role: true } },
    },
  });
  if (!team) return res.status(404).json({ error: 'Équipe introuvable' });

  const loadCounts = await prisma.ticket.groupBy({
    by: ['assignedToId'],
    where: { assignedToId: { in: team.members.map((m) => m.id) }, status: { in: ACTIVE_STATUSES } },
    _count: { id: true },
  });
  const loadByUserId = Object.fromEntries(loadCounts.map((c) => [c.assignedToId, c._count.id]));

  const membersWithLoad = team.members
    .map((m) => ({ ...m, activeTicketCount: loadByUserId[m.id] || 0 }))
    .sort((a, b) => a.activeTicketCount - b.activeTicketCount);

  return res.json({ ...team, members: membersWithLoad });
});

router.post('/', requirePermission('teams.manage', ['ADMIN', 'HOTLINE']), [body('name').notEmpty()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, category, groupEmail, defaultObserverIds } = req.body;

  const existing = await prisma.team.findUnique({ where: { name } });
  if (existing) return res.status(409).json({ error: 'Une équipe avec ce nom existe déjà' });

  const ids = Array.isArray(defaultObserverIds) ? defaultObserverIds.map(Number) : [];
  const team = await prisma.team.create({
    data: {
      name,
      category: category || null,
      groupEmail: groupEmail || null,
      ...(ids.length > 0 ? { defaultObservers: { connect: ids.map((id) => ({ id })) } } : {}),
    },
    include: {
      members: { select: { id: true, fullName: true, email: true, role: true } },
      defaultObservers: { select: { id: true, fullName: true, email: true, role: true } },
    },
  });
  cacheStore.clear('GET /api/teams');
  return res.status(201).json(team);
  auditLog('TEAM_CREATED', { actor: req.user, targetType: 'Team', targetId: team.id, targetLabel: team.name }).catch(() => {});
});

router.patch('/:id', requirePermission('teams.manage', ['ADMIN', 'HOTLINE']), async (req, res) => {
  const { name, category, groupEmail, defaultObserverIds } = req.body;
  const data = {};
  if (name !== undefined) data.name = name;
  if (category !== undefined) data.category = category;
  if (groupEmail !== undefined) data.groupEmail = groupEmail || null;
  if (defaultObserverIds !== undefined) {
    const ids = Array.isArray(defaultObserverIds) ? defaultObserverIds.map(Number) : [];
    data.defaultObservers = { set: ids.map((id) => ({ id })) };
  }

  try {
    const team = await prisma.team.update({
      where: { id: Number(req.params.id) },
      data,
      include: {
        members: { select: { id: true, fullName: true, email: true, role: true } },
        defaultObservers: { select: { id: true, fullName: true, email: true, role: true } },
      },
    });
    cacheStore.clear('GET /api/teams');
    return res.json(team);
    auditLog('TEAM_UPDATED', { actor: req.user, targetType: 'Team', targetId: team.id, targetLabel: team.name, metadata: { changedFields: Object.keys(data) } }).catch(() => {});
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Équipe introuvable' });
    console.error('[team.routes] Erreur mise à jour équipe:', err);
    return res.status(500).json({ error: 'Erreur interne' });
  }
});

router.delete('/:id', requirePermission('teams.manage', ['ADMIN']), async (req, res) => {
  try {
    const team = await prisma.team.findUnique({ where: { id: Number(req.params.id) }, select: { id: true, name: true } });
    await prisma.team.delete({ where: { id: Number(req.params.id) } });
    cacheStore.clear('GET /api/teams');
    auditLog('TEAM_DELETED', { actor: req.user, targetType: 'Team', targetId: team.id, targetLabel: team.name }).catch(() => {});
    return res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Équipe introuvable' });
    console.error('[team.routes] Erreur suppression équipe:', err);
    return res.status(500).json({ error: 'Erreur interne' });
  }
});

module.exports = router;
