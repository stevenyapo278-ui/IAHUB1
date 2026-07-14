const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(authenticate);
router.use(requirePermission('settings.ai', ['ADMIN', 'SUPERADMIN']));

// ── Lister toutes les compétences ────────────────────────────────────────
router.get('/', async (req, res) => {
  const skills = await prisma.skill.findMany({
    orderBy: { name: 'asc' },
    include: {
      userSkills: {
        include: { user: { select: { id: true, fullName: true, email: true, role: true } } },
        orderBy: { level: 'desc' },
      },
    },
  });
  return res.json(skills);
});

// ── Créer une compétence ────────────────────────────────────────────────
router.post(
  '/',
  [body('name').trim().notEmpty().withMessage('Le nom de la compétence est requis')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, description, category } = req.body;

    const existing = await prisma.skill.findUnique({ where: { name } });
    if (existing) return res.status(409).json({ error: 'Cette compétence existe déjà' });

    const skill = await prisma.skill.create({
      data: { name, description: description || null, category: category || null },
    });

    return res.status(201).json(skill);
  }
);

// ── Modifier une compétence ─────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { name, description, category } = req.body;

  const data = {};
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = description;
  if (category !== undefined) data.category = category;

  try {
    const skill = await prisma.skill.update({ where: { id }, data });
    return res.json(skill);
  } catch (err) {
    return res.status(404).json({ error: 'Compétence introuvable' });
  }
});

// ── Supprimer une compétence ────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    await prisma.skill.delete({ where: { id } });
    return res.status(204).send();
  } catch (err) {
    return res.status(404).json({ error: 'Compétence introuvable' });
  }
});

// ── Assigner une compétence à un utilisateur ────────────────────────────
// Body : { userId, level }
router.post('/:id/assign', async (req, res) => {
  const skillId = Number(req.params.id);
  const { userId, level } = req.body;

  if (!userId) return res.status(400).json({ error: 'userId requis' });
  const skillLevel = level ? Math.min(5, Math.max(1, Number(level))) : 3;

  const user = await prisma.user.findUnique({ where: { id: Number(userId) } });
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (user.role === 'REQUESTER') return res.status(400).json({ error: 'Un demandeur ne peut pas avoir de compétences' });

  const existing = await prisma.userSkill.findUnique({
    where: { userId_skillId: { userId: Number(userId), skillId } },
  });

  if (existing) {
    const us = await prisma.userSkill.update({
      where: { id: existing.id },
      data: { level: skillLevel },
    });
    return res.json(us);
  }

  const us = await prisma.userSkill.create({
    data: { userId: Number(userId), skillId, level: skillLevel },
  });

  return res.status(201).json(us);
});

// ── Retirer une compétence à un utilisateur ─────────────────────────────
router.delete('/:skillId/assign/:userId', async (req, res) => {
  const skillId = Number(req.params.skillId);
  const userId = Number(req.params.userId);

  try {
    const us = await prisma.userSkill.findUnique({
      where: { userId_skillId: { userId, skillId } },
    });
    if (!us) return res.status(404).json({ error: 'Assignation introuvable' });

    await prisma.userSkill.delete({ where: { id: us.id } });
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Statistiques de précision des assignations ──────────────────────────
router.get('/stats/accuracy', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const totalAssignments = await prisma.reassignmentLog.count({
      where: { createdAt: { gte: since } },
    });

    const autoAssigned = await prisma.reassignmentLog.count({
      where: { createdAt: { gte: since }, wasAutoAssigned: true },
    });

    const corrected = await prisma.reassignmentLog.count({
      where: { createdAt: { gte: since }, wasAutoAssigned: true, previousTechnicianId: { not: null } },
    });

    const reasons = await prisma.reassignmentLog.groupBy({
      by: ['reason'],
      _count: { id: true },
      where: { createdAt: { gte: since }, reason: { not: null } },
    });

    const accuracy = autoAssigned > 0
      ? Math.round(((autoAssigned - corrected) / autoAssigned) * 100)
      : null;

    // Évolution journalière
    const dailyStats = await prisma.$queryRawUnsafe(`
      SELECT
        DATE("createdAt") as date,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE "wasAutoAssigned" = true) as auto,
        COUNT(*) FILTER (WHERE "wasAutoAssigned" = true AND "previousTechnicianId" IS NOT NULL) as corrected
      FROM "ReassignmentLog"
      WHERE "createdAt" >= $1
      GROUP BY DATE("createdAt")
      ORDER BY date
    `, since);

    return res.json({
      periodDays: days,
      totalAssignments,
      autoAssigned,
      corrected,
      accuracy,
      reasons,
      dailyStats,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
