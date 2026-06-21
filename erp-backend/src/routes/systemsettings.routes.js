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
    body('glpiTicketsSyncIntervalSeconds').optional().isInt({ min: 0, max: 3600 }),
    body('emailSyncIntervalSeconds').optional().isInt({ min: 0, max: 3600 }),
    body('glpiTeamsCategoriesSyncIntervalMinutes').optional().isInt({ min: 0, max: 1440 }),
    body('aiModelsSyncIntervalHours').optional().isInt({ min: 0, max: 168 }),
    body('draftReminderEnabled').optional().isBoolean(),
    body('draftReminderDelayMinutes').optional().isInt({ min: 1, max: 1440 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    await getOrCreateSettings();

    const data = {};
    if (req.body.autoApproveGlpiSolutions !== undefined) data.autoApproveGlpiSolutions = req.body.autoApproveGlpiSolutions;
    if (req.body.autoSendAiEmails !== undefined) data.autoSendAiEmails = req.body.autoSendAiEmails;
    if (req.body.glpiTicketsSyncIntervalSeconds !== undefined) data.glpiTicketsSyncIntervalSeconds = req.body.glpiTicketsSyncIntervalSeconds;
    if (req.body.emailSyncIntervalSeconds !== undefined) data.emailSyncIntervalSeconds = req.body.emailSyncIntervalSeconds;
    if (req.body.glpiTeamsCategoriesSyncIntervalMinutes !== undefined) data.glpiTeamsCategoriesSyncIntervalMinutes = req.body.glpiTeamsCategoriesSyncIntervalMinutes;
    if (req.body.aiModelsSyncIntervalHours !== undefined) data.aiModelsSyncIntervalHours = req.body.aiModelsSyncIntervalHours;
    if (req.body.draftReminderEnabled !== undefined) data.draftReminderEnabled = req.body.draftReminderEnabled;
    if (req.body.draftReminderDelayMinutes !== undefined) data.draftReminderDelayMinutes = req.body.draftReminderDelayMinutes;

    const updated = await prisma.systemSettings.update({ where: { id: 1 }, data });
    return res.json(updated);
  }
);

module.exports = router;
