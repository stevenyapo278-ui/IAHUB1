// Champs personnalisés (équivalent plugin GLPI Forms) : définition des champs
// rendus dynamiquement à la création d'un ticket, selon la catégorie choisie.

const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(authenticate);

const FIELD_TYPES = ['TEXT', 'NUMBER', 'SELECT', 'DATE', 'TEXTAREA', 'CHECKBOX'];

// Liste des définitions. ?categoryId=X → champs de cette catégorie + champs globaux
// (categoryId null). Sans filtre → toutes les définitions.
router.get('/', async (req, res) => {
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
  const where = categoryId ? { OR: [{ categoryId }, { categoryId: null }] } : {};
  const fields = await prisma.customFieldDefinition.findMany({
    where,
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    include: { category: { select: { id: true, name: true } } },
  });
  res.json(fields);
});

router.post(
  '/',
  requirePermission('tickets.manage'),
  [
    body('label').notEmpty().trim().withMessage('Le libellé est requis'),
    body('type').isIn(FIELD_TYPES).withMessage('Type de champ invalide'),
    body('categoryId').optional({ nullable: true }).isInt().withMessage('categoryId invalide'),
    body('position').optional().isInt({ min: 0 }),
    body('required').optional().isBoolean(),
    body('isActive').optional().isBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { label, type, options, required, categoryId, position, isActive } = req.body;
    if (type === 'SELECT' && !Array.isArray(options)) {
      return res.status(400).json({ error: 'Un champ SELECT doit définir une liste d\'options' });
    }
    if (categoryId) {
      const cat = await prisma.ticketCategory.findUnique({ where: { id: Number(categoryId) } });
      if (!cat) return res.status(404).json({ error: 'Catégorie introuvable' });
    }

    const field = await prisma.customFieldDefinition.create({
      data: {
        label: label.trim(),
        type,
        options: options || undefined,
        required: !!required,
        categoryId: categoryId ? Number(categoryId) : null,
        position: position ?? 0,
        isActive: isActive ?? true,
      },
      include: { category: { select: { id: true, name: true } } },
    });
    return res.status(201).json(field);
  }
);

router.patch(
  '/:id',
  requirePermission('tickets.manage'),
  [
    body('label').optional().notEmpty().trim(),
    body('type').optional().isIn(FIELD_TYPES),
    body('categoryId').optional({ nullable: true }).isInt(),
    body('position').optional().isInt({ min: 0 }),
    body('required').optional().isBoolean(),
    body('isActive').optional().isBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const id = Number(req.params.id);
    const existing = await prisma.customFieldDefinition.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Champ introuvable' });

    const data = {};
    if (req.body.label !== undefined) data.label = req.body.label.trim();
    if (req.body.type !== undefined) data.type = req.body.type;
    if (req.body.options !== undefined) data.options = req.body.options;
    if (req.body.required !== undefined) data.required = req.body.required;
    if (req.body.position !== undefined) data.position = req.body.position;
    if (req.body.isActive !== undefined) data.isActive = req.body.isActive;
    if (req.body.categoryId !== undefined) {
      const categoryId = req.body.categoryId ? Number(req.body.categoryId) : null;
      if (categoryId) {
        const cat = await prisma.ticketCategory.findUnique({ where: { id: categoryId } });
        if (!cat) return res.status(404).json({ error: 'Catégorie introuvable' });
      }
      data.categoryId = categoryId;
    }

    const field = await prisma.customFieldDefinition.update({
      where: { id },
      data,
      include: { category: { select: { id: true, name: true } } },
    });
    return res.json(field);
  }
);

router.delete('/:id', requirePermission('tickets.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.customFieldDefinition.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Champ introuvable' });

  await prisma.customFieldDefinition.delete({ where: { id } });
  return res.json({ deleted: true });
});

module.exports = router;
