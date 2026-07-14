const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(authenticate);
router.use(requirePermission('settings.ai', ['ADMIN', 'SUPERADMIN']));

// ── Lister toutes les règles de triage ────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const rules = await prisma.triageRule.findMany({
      orderBy: [
        { priority: 'desc' },
        { id: 'asc' }
      ]
    });
    return res.json(rules);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Créer une règle de triage ─────────────────────────────────────────────
router.post(
  '/',
  [
    body('label').trim().notEmpty().withMessage('La description de la règle est requise'),
    body('matchField').isIn(['subject', 'body', 'subject_or_body', 'from']).withMessage('Champ cible invalide'),
    body('matchType').isIn(['contains', 'regex', 'equals', 'starts_with']).withMessage('Type de correspondance invalide'),
    body('matchValue').trim().notEmpty().withMessage('La valeur de recherche est requise'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const {
      label,
      matchField,
      matchType,
      matchValue,
      category,
      skillName,
      teamName,
      ticketPriority,
      isSpam,
      priority,
      isActive
    } = req.body;

    try {
      const rule = await prisma.triageRule.create({
        data: {
          label,
          matchField,
          matchType,
          matchValue,
          category: category || null,
          skillName: skillName || null,
          teamName: teamName || null,
          ticketPriority: ticketPriority || 'P3',
          isSpam: isSpam === true || isSpam === 'true',
          priority: Number(priority) || 0,
          isActive: isActive !== false && isActive !== 'false'
        }
      });
      return res.status(201).json(rule);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// ── Modifier une règle de triage ──────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const {
    label,
    matchField,
    matchType,
    matchValue,
    category,
    skillName,
    teamName,
    ticketPriority,
    isSpam,
    priority,
    isActive
  } = req.body;

  const data = {};
  if (label !== undefined) data.label = label;
  if (matchField !== undefined) data.matchField = matchField;
  if (matchType !== undefined) data.matchType = matchType;
  if (matchValue !== undefined) data.matchValue = matchValue;
  if (category !== undefined) data.category = category || null;
  if (skillName !== undefined) data.skillName = skillName || null;
  if (teamName !== undefined) data.teamName = teamName || null;
  if (ticketPriority !== undefined) data.ticketPriority = ticketPriority || 'P3';
  if (isSpam !== undefined) data.isSpam = isSpam === true || isSpam === 'true';
  if (priority !== undefined) data.priority = Number(priority) || 0;
  if (isActive !== undefined) data.isActive = isActive === true || isActive === 'true';

  try {
    const rule = await prisma.triageRule.update({
      where: { id },
      data
    });
    return res.json(rule);
  } catch (err) {
    return res.status(404).json({ error: 'Règle de triage introuvable' });
  }
});

// ── Activer/Désactiver une règle de triage ────────────────────────────────
router.patch('/:id/toggle', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const existing = await prisma.triageRule.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Règle de triage introuvable' });

    const rule = await prisma.triageRule.update({
      where: { id },
      data: { isActive: !existing.isActive }
    });
    return res.json(rule);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Supprimer une règle de triage ─────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    await prisma.triageRule.delete({ where: { id } });
    return res.status(204).send();
  } catch (err) {
    return res.status(404).json({ error: 'Règle de triage introuvable' });
  }
});

module.exports = router;
