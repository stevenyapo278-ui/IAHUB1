const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/permissions');
const { normalizeHost, resolveBackendUrl, resolveFrontendUrl } = require('../services/systemSettings');
const { getSessionPolicy, applySessionPolicy } = require('../services/sessionPolicy');
const { auditLog } = require('../services/auditLogService');
const { purgeTickets, freshStart } = require('../services/ticketPurge');
const cacheStore = require('../services/cacheStore');
const { getIO } = require('../utils/socket');

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

// Ajoute la politique de session EFFECTIVE (UI > env > défaut) à la réponse :
// le front peut ainsi afficher la valeur réellement appliquée et sa provenance,
// même quand la colonne UI est vide (null = valeur héritée de l'environnement).
function withSessionPolicy(settings) {
  return { ...settings, sessionPolicy: getSessionPolicy() };
}

router.get('/', async (req, res) => {
  const settings = await getOrCreateSettings();
  return res.json(withSessionPolicy(settings));
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

  await prisma.systemSettings.upsert({
    where: { id: 1 },
    update: { autonomousMode: isPause },
    create: { id: 1, autonomousMode: isPause },
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
// PUT / PATCH / — sauvegarde des réglages (existants)
// ═══════════════════════════════════════════════════════════════════════════
const PUT_FIELDS = [
  'backendUrl', 'frontendUrl', 'enforceHttps',
  'autoSendAiEmails', 'autonomousMode', 'enableFewShotTriage',
  'closeChildrenWithParent', 'autoApproveManualTickets', 'enableAutoCreateSkills',
  'glpiTicketsSyncIntervalSeconds', 'emailSyncIntervalSeconds', 'aiModelsSyncIntervalHours',
  'draftReminderEnabled', 'draftReminderDelayMinutes',
  'dailySummaryEnabled', 'dailySummaryTime', 'dailySummaryRecipients', 'dailySummaryLastSentDate',
  'approvalReminderMinutes', 'closedTicketBehavior', 'reopenThresholdDays',
  'solvedAutoCloseDays', 'slaMonitorIntervalSeconds', 'dueDateMonitorIntervalSeconds',
  'chatbotNotifyEmail', 'ticketCreationEmailEnabled', 'ticketCreationEmailRecipients',
  'acknowledgementMessage', 'acknowledgementOffHoursMessage', 'acknowledgementBusinessHoursEnabled',
  'acknowledgementBusinessDays', 'acknowledgementBusinessStartTime', 'acknowledgementBusinessEndTime',
  'notifyTechnicianOnAssignment', 'emailFailureNotificationEmail',
  'emailSignature', 'signatureLogoUrl', 'signatureLogoHeight', 'signatureLogos', 'goLiveDate',
  'emailAcknowledgementEnabled', 'emailKnownIncidentEnabled', 'emailAssignmentEnabled',
  'emailSlaBreachEnabled', 'emailDueDateBreachEnabled', 'emailStatusChangeEnabled',
  'emailResolvedEnabled', 'emailEscalationEnabled', 'emailMajorIncidentResolvedEnabled',
  'emailApprovalEnabled', 'slaHours', 'navigationConfig',
  'portalAllowNewRequest',
  'loginThemeMode', 'loginThemeFixedVariant', 'loginThemeEnabledVariants',
  'aiEnabled', 'aiDailyTokenBudget', 'aiTokenAlertThreshold', 'aiTokenAlertRecipients',
  // Module « Création de comptes applicatifs » (page Avancé, SUPERADMIN uniquement)
  'accountProvisioningEnabled', 'accountProvisioningAiPrefill', 'accountProvisioningRetrySeconds',
  // Politique de session (page Avancé) — null = hériter de l'environnement
  'sessionIdleTimeoutMinutes', 'sessionMaxHours',
];

// Bornes de sécurité des réglages de session. 0 = contrôle désactivé.
const SESSION_POLICY_BOUNDS = {
  sessionIdleTimeoutMinutes: { min: 0, max: 100000, label: "Délai d'inactivité (minutes)" },
  sessionMaxHours: { min: 0, max: 8760, label: 'Durée maximale de session (heures)' },
};

// `null`/vide = remise à la valeur héritée (env puis défaut). Sinon entier >= 0.
function normalizeSessionPolicyField(field, raw) {
  const bounds = SESSION_POLICY_BOUNDS[field];
  if (raw === null || raw === undefined || raw === '') return { value: null };
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
    return { error: `${bounds.label} : valeur entière entre ${bounds.min} et ${bounds.max} attendue` };
  }
  return { value: parsed };
}

async function handleSaveSettings(req, res) {
  const data = {};
  for (const field of PUT_FIELDS) {
    if (req.body[field] !== undefined) data[field] = req.body[field];
  }
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'Aucun réglage à sauvegarder (champs non reconnus)' });
  }

  for (const field of Object.keys(SESSION_POLICY_BOUNDS)) {
    if (data[field] === undefined) continue;
    const { value, error } = normalizeSessionPolicyField(field, data[field]);
    if (error) return res.status(400).json({ error });
    data[field] = value;
  }

  try {
    const settings = await prisma.systemSettings.upsert({
      where: { id: 1 },
      update: data,
      create: { id: 1, ...data },
    });

    // Applique immédiatement la nouvelle politique : la session en cours et les
    // suivantes utilisent les valeurs enregistrées, sans redémarrage.
    applySessionPolicy(settings);

    // Les réglages (dont navigationConfig, qui pilote la sidebar de tous les utilisateurs) sont
    // servis via GET /api/system-settings derrière un cache TTL 30s : on l'invalide pour que la
    // nouvelle valeur soit servie immédiatement, et on prévient tous les clients connectés via
    // Socket.IO pour qu'ils rafraîchissent leur config sans attendre un rechargement de page.
    cacheStore.clear('GET /api/system-settings');
    const io = getIO();
    if (io) io.emit('system-settings:updated', { ts: Date.now() });

    auditLog('SETTINGS_UPDATED', {
      actor: req.user,
      targetType: 'SystemSettings',
      targetId: 1,
      targetLabel: Object.keys(data).join(', '),
      metadata: { fields: Object.keys(data) },
    }).catch(() => {});

    return res.json(withSessionPolicy(settings));
  } catch (err) {
    console.error('[advancedsettings.routes] Erreur sauvegarde réglages:', err);
    return res.status(500).json({ error: 'Erreur lors de la sauvegarde des réglages : ' + err.message });
  }
}

router.put('/', handleSaveSettings);
router.patch('/', handleSaveSettings);

module.exports = router;
