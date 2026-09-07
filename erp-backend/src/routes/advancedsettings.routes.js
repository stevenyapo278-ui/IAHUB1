const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/permissions');
const { normalizeHost, resolveBackendUrl, resolveFrontendUrl } = require('../services/systemSettings');
const { auditLog } = require('../services/auditLogService');
const { purgeTickets, freshStart } = require('../services/ticketPurge');

// Mot de passe secret pour marquer le départ en prod
const PROD_START_PASSWORD = 'JeMarqueLeDebut';

const router = express.Router();
router.use(authenticate);
router.use(requireSuperAdmin);

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

// ── Purge tickets ───────────────────────────────────────────────────────
router.post('/purge-tickets', async (req, res) => {
  const settings = await getOrCreateSettings();
  const syncActive = !settings.autonomousMode && settings.glpiTicketsSyncIntervalSeconds > 0;
  if (syncActive) {
    await prisma.systemSettings.update({ where: { id: 1 }, data: { glpiTicketsSyncIntervalSeconds: 0 } });
  }

  const result = await purgeTickets();

  auditLog('TICKETS_PURGED', {
    actor: req.user,
    targetType: 'Ticket',
    targetId: null,
    targetLabel: 'Purge complète des tickets',
    metadata: { ticketsDeleted: result.ticketsDeleted, glpiTicketSyncDisabled: syncActive },
  }).catch(() => {});

  return res.json({ ...result, glpiTicketSyncDisabled: syncActive });
});

// ── Fresh Start — purge complète pour déploiement prod ──────────────────
router.post('/fresh-start', async (req, res) => {
  const { password } = req.body;
  if (password !== PROD_START_PASSWORD) {
    return res.status(403).json({ error: 'Mot de passe incorrect' });
  }

  const result = await freshStart();

  auditLog('FRESH_START', {
    actor: req.user,
    targetType: 'System',
    targetId: null,
    targetLabel: 'Fresh start — purge complète pour déploiement prod',
    metadata: { tablesPurged: Object.keys(result).length },
  }).catch(() => {});

  return res.json(result);
});

// ── Pause / Marquer le départ ──────────────────────────────────────────
router.post('/pause', async (req, res) => {
  const { password, action } = req.body;
  if (password !== PROD_START_PASSWORD) {
    return res.status(403).json({ error: 'Mot de passe incorrect' });
  }

  // action: 'pause' ou 'resume'
  const isPause = action === 'pause';

  await prisma.systemSettings.update({
    where: { id: 1 },
    data: { autonomousMode: isPause },
  });

  auditLog(isPause ? 'SYSTEM_PAUSED' : 'SYSTEM_RESUMED', {
    actor: req.user,
    targetType: 'System',
    targetId: null,
    targetLabel: isPause ? 'Système mis en pause (départ prod)' : 'Système repris',
  }).catch(() => {});

  return res.json({ paused: isPause, autonomousMode: isPause });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT / — sauvegarde des réglages (existants)
// ═══════════════════════════════════════════════════════════════════════════
const PUT_FIELDS = [
  'backendUrl', 'frontendUrl',
  'autoSendAiEmails', 'autonomousMode',
  'glpiTicketsSyncIntervalSeconds', 'emailSyncIntervalSeconds',
  'draftReminderEnabled', 'draftReminderDelayMinutes',
  'dailySummaryEnabled', 'dailySummaryTime', 'dailySummaryRecipients',
  'approvalReminderMinutes', 'closedTicketBehavior', 'reopenThresholdDays',
  'solvedAutoCloseDays', 'slaMonitorIntervalSeconds', 'dueDateMonitorIntervalSeconds',
  'chatbotNotifyEmail', 'ticketCreationEmailEnabled',
  'enableFewShotTriage', 'enableAutoCreateSkills',
  'slaHours',
];

router.put('/', async (req, res) => {
  const data = {};
  for (const field of PUT_FIELDS) {
    if (req.body[field] !== undefined) data[field] = req.body[field];
  }
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'Aucun réglage à sauvegarder' });
  }

  const settings = await prisma.systemSettings.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  });

  auditLog('SETTINGS_UPDATED', {
    actor: req.user,
    targetType: 'SystemSettings',
    targetId: 1,
    targetLabel: Object.keys(data).join(', '),
    metadata: { fields: Object.keys(data) },
  }).catch(() => {});

  return res.json(settings);
});

module.exports = router;
