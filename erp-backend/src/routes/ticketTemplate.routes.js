const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(authenticate);

const templateSelect = {
  id: true, name: true, description: true, title: true, content: true,
  priority: true, category: true, type: true, urgency: true, impact: true,
  isActive: true, createdAt: true, updatedAt: true,
};

// Liste des modèles (les utilisateurs staff peuvent tous les voir ; seuls les actifs pour la création)
router.get('/', async (req, res) => {
  const staff = ['SUPERADMIN', 'ADMIN', 'TECHNICIAN', 'HOTLINE'].includes(req.user.role);
  const where = staff ? {} : { isActive: true };
  const templates = await prisma.ticketTemplate.findMany({ where, orderBy: { name: 'asc' }, select: templateSelect });
  return res.json(templates);
});

// Création (staff)
router.post(
  '/',
  requirePermission('tickets.assign', ['ADMIN', 'TECHNICIAN']),
  [body('name').notEmpty(), body('title').notEmpty(), body('content').notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, description, title, content, priority, category, type, urgency, impact } = req.body;
    const template = await prisma.ticketTemplate.create({
      data: {
        name: String(name).trim(),
        description: description || null,
        title: String(title).trim(),
        content: String(content).trim(),
        priority: priority || null,
        category: category || null,
        type: type || null,
        urgency: urgency || null,
        impact: impact || null,
        createdById: req.user.sub,
      },
      select: templateSelect,
    });
    return res.status(201).json(template);
  }
);

// Mise à jour (staff)
router.patch('/:id', requirePermission('tickets.assign', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.ticketTemplate.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Modèle introuvable' });

  const { name, description, title, content, priority, category, type, urgency, impact, isActive } = req.body;
  const data = {};
  if (name !== undefined) data.name = String(name).trim();
  if (description !== undefined) data.description = description || null;
  if (title !== undefined) data.title = String(title).trim();
  if (content !== undefined) data.content = String(content).trim();
  if (priority !== undefined) data.priority = priority || null;
  if (category !== undefined) data.category = category || null;
  if (type !== undefined) data.type = type || null;
  if (urgency !== undefined) data.urgency = urgency || null;
  if (impact !== undefined) data.impact = impact || null;
  if (isActive !== undefined) data.isActive = !!isActive;

  const template = await prisma.ticketTemplate.update({ where: { id }, data, select: templateSelect });
  return res.json(template);
});

// Suppression (ADMIN uniquement)
router.delete('/:id', requirePermission('tickets.delete', ['ADMIN']), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.ticketTemplate.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Modèle introuvable' });
  await prisma.ticketTemplate.delete({ where: { id } });
  return res.json({ ok: true });
});

module.exports = router;