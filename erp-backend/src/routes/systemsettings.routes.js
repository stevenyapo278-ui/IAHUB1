const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(authenticate);

async function getOrCreateSettings() {
  return prisma.systemSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}

router.get('/', async (req, res) => {
  const settings = await getOrCreateSettings();
  return res.json(settings);
});

router.patch(
  '/',
  requirePermission('automation.manage', ['ADMIN']),
  [
    body('autoApproveGlpiSolutions').optional().isBoolean(),
    body('autoSendAiEmails').optional().isBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    await getOrCreateSettings();

    const data = {};
    if (req.body.autoApproveGlpiSolutions !== undefined) data.autoApproveGlpiSolutions = req.body.autoApproveGlpiSolutions;
    if (req.body.autoSendAiEmails !== undefined) data.autoSendAiEmails = req.body.autoSendAiEmails;

    const updated = await prisma.systemSettings.update({ where: { id: 1 }, data });
    return res.json(updated);
  }
);

module.exports = router;
