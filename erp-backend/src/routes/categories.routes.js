const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { auditLog } = require('../services/auditLogService');
const cacheStore = require('../services/cacheStore');

// Invalider le cache des catégories après chaque mutation
function invalidateCategoriesCache() {
  cacheStore.clear('GET /api/categories');
}

const router = express.Router();
router.use(authenticate);

// Lister toutes les catégories (arbre)
router.get('/', async (req, res) => {
  const categories = await prisma.ticketCategory.findMany({
    orderBy: { name: 'asc' },
    include: {
      children: { orderBy: { name: 'asc' } },
      createdBy: { select: { id: true, fullName: true, avatarUrl: true } },
      _count: { select: { customFields: true } },
    },
  });
  res.json(categories);
});

// Créer une catégorie
router.post(
  '/',
  requirePermission('tickets.manage', ['ADMIN']),
  [body('name').notEmpty().trim()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, parentId } = req.body;

    const existing = await prisma.ticketCategory.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) return res.status(409).json({ error: 'Une catégorie avec ce nom existe déjà' });

    const category = await prisma.ticketCategory.create({
      data: {
        name: name.trim(),
        isCustom: true,
        parentId: parentId ? Number(parentId) : null,
        createdById: req.user.sub,
      },
    });

    await auditLog('CATEGORY_CREATED', { actor: req.user, targetType: 'TicketCategory', targetId: category.id, targetLabel: name });
    invalidateCategoriesCache();
    res.status(201).json(category);
  }
);

// Modifier une catégorie
router.patch(
  '/:id',
  requirePermission('tickets.manage', ['ADMIN']),
  async (req, res) => {
    const id = Number(req.params.id);
    const { name, parentId } = req.body;

    const existing = await prisma.ticketCategory.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Catégorie introuvable' });

    const data = {};
    if (name !== undefined) data.name = name.trim();
    if (parentId !== undefined) {
      const newParentId = parentId ? Number(parentId) : null;
      // Empêcher les cycles : vérifier que le nouveau parent n'est pas un descendant de cette catégorie
      if (newParentId && newParentId !== id) {
        const allCategories = await prisma.ticketCategory.findMany({ select: { id: true, parentId: true } });
        const childrenOfId = new Set();
        const queue = [id];
        while (queue.length > 0) {
          const current = queue.pop();
          for (const c of allCategories) {
            if (c.parentId != null && Number(c.parentId) === current && !childrenOfId.has(c.id)) {
              childrenOfId.add(c.id);
              queue.push(c.id);
            }
          }
        }
        if (childrenOfId.has(newParentId)) {
          return res.status(400).json({ error: 'Impossible de définir ce parent : cela créerait un cycle hiérarchique.' });
        }
      }
      data.parentId = newParentId;
    }

    const category = await prisma.ticketCategory.update({ where: { id }, data });
    await auditLog('CATEGORY_UPDATED', { actor: req.user, targetType: 'TicketCategory', targetId: id, targetLabel: existing.name });
    invalidateCategoriesCache();
    res.json(category);
  }
);

// Supprimer une catégorie
router.delete(
  '/:id',
  requirePermission('tickets.manage', ['ADMIN']),
  async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.ticketCategory.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Catégorie introuvable' });

    await prisma.ticketCategory.delete({ where: { id } });
    await auditLog('CATEGORY_DELETED', { actor: req.user, targetType: 'TicketCategory', targetId: id, targetLabel: existing.name });
    invalidateCategoriesCache();
    res.status(204).send();
  }
);

module.exports = router;
