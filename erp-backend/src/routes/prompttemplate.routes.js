const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { DEFAULTS } = require('../services/promptTemplates');

const router = express.Router();
router.use(authenticate);

// Liste les 5 prompts : la valeur actuelle (éditée en base si présente, sinon le défaut) + le défaut
// d'origine, pour permettre un bouton "Réinitialiser" côté UI.
router.get('/', async (req, res) => {
  const rows = await prisma.promptTemplate.findMany();
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

  const result = Object.entries(DEFAULTS).map(([key, def]) => ({
    key,
    label: def.label,
    template: byKey[key]?.template || def.template,
    defaultTemplate: def.template,
    isCustomized: !!byKey[key],
    updatedAt: byKey[key]?.updatedAt || null,
  }));

  return res.json(result);
});

router.patch(
  '/:key',
  requirePermission('prompts.manage', ['ADMIN']),
  [body('template').isString().trim().notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { key } = req.params;
    const def = DEFAULTS[key];
    if (!def) return res.status(404).json({ error: 'Prompt inconnu' });

    const updated = await prisma.promptTemplate.upsert({
      where: { key },
      update: { template: req.body.template },
      create: { key, label: def.label, template: req.body.template },
    });
    return res.json(updated);
  }
);

// Réinitialise un prompt au texte par défaut codé en dur (supprime la ligne éditée en base).
router.delete('/:key', requirePermission('prompts.manage', ['ADMIN']), async (req, res) => {
  const { key } = req.params;
  if (!DEFAULTS[key]) return res.status(404).json({ error: 'Prompt inconnu' });

  await prisma.promptTemplate.deleteMany({ where: { key } });
  return res.json({ key, template: DEFAULTS[key].template, isCustomized: false });
});

module.exports = router;
