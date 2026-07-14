const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { syncTeamsFromGlpi, syncCategoriesFromGlpi } = require('../services/glpiTicketCreator');

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
      _count: { select: { tickets: true } },
    },
    orderBy: { name: 'asc' },
  });
  return res.json(teams);
});

// Statuts comptant comme "charge active" — alignés sur ticketAutoAssign.js, pour que ce qui
// s'affiche ici corresponde exactement à ce que l'auto-assignation utilise pour choisir le moins chargé.
const ACTIVE_STATUSES = ['NEW', 'OPEN', 'PENDING', 'WAITING_FOR_USER'];

router.get('/:id', async (req, res) => {
  const team = await prisma.team.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      members: { select: { id: true, fullName: true, email: true, role: true } },
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

router.post('/', requirePermission('teams.manage', ['ADMIN']), [body('name').notEmpty()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, category, groupEmail } = req.body;

  const existing = await prisma.team.findUnique({ where: { name } });
  if (existing) return res.status(409).json({ error: 'Une équipe avec ce nom existe déjà' });

  const team = await prisma.team.create({ data: { name, category: category || null, groupEmail: groupEmail || null } });
  return res.status(201).json(team);
});

router.patch('/:id', requirePermission('teams.manage', ['ADMIN']), async (req, res) => {
  const { name, category, groupEmail } = req.body;
  const data = {};
  if (name !== undefined) data.name = name;
  if (category !== undefined) data.category = category;
  if (groupEmail !== undefined) data.groupEmail = groupEmail || null;

  try {
    const team = await prisma.team.update({ where: { id: Number(req.params.id) }, data });
    return res.json(team);
  } catch (err) {
    return res.status(404).json({ error: 'Équipe introuvable' });
  }
});

// Synchronise les équipes (Group) et les catégories de tickets (ITILCategory) depuis GLPI
router.post('/sync-glpi', requirePermission('teams.manage', ['ADMIN']), async (req, res) => {
  try {
    const synced = await syncTeamsFromGlpi();
    if (synced === null) {
      return res.status(422).json({ error: 'GLPI non configuré ou inactif (Settings → GLPI)' });
    }
    const syncedCategories = await syncCategoriesFromGlpi();
    return res.json({ synced, syncedCategories: syncedCategories || 0 });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Erreur lors de la synchronisation GLPI' });
  }
});

router.delete('/:id', requirePermission('teams.manage', ['ADMIN']), async (req, res) => {
  try {
    await prisma.team.delete({ where: { id: Number(req.params.id) } });
    return res.status(204).send();
  } catch (err) {
    return res.status(404).json({ error: 'Équipe introuvable' });
  }
});

module.exports = router;
