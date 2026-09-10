const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { sendDailySummary } = require('../services/dailySummary');
const { runSolvedAutoCloseScheduler } = require('../services/solvedAutoCloseScheduler');
const { resolveBackendUrl, resolveFrontendUrl } = require('../services/systemSettings');
const { auditLog } = require('../services/auditLogService');
const { validateUpload } = require('../utils/security');
const cacheStore = require('../services/cacheStore');

const router = express.Router();
router.use(authenticate);

const LOGO_UPLOAD_DIR = path.join('uploads', 'signature-logo');
fs.mkdirSync(LOGO_UPLOAD_DIR, { recursive: true });

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: LOGO_UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `logo-${Date.now()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 Mo max
  fileFilter: (req, file, cb) => {
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/webp'].includes(file.mimetype)) {
      return cb(new Error('Format d\'image non supporté'));
    }
    return cb(null, true);
  },
});

async function getOrCreateSettings() {
  try {
    let settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
    if (!settings) {
      settings = await prisma.systemSettings.create({ data: { id: 1 } });
    }
    return settings;
  } catch (err) {
    console.error('[systemsettings] Erreur lecture SystemSettings:', err.message);
    return {
      id: 1,
      autoSendAiEmails: false,
      enableFewShotTriage: true,
      emailApprovalEnabled: true,
      emailAcknowledgementEnabled: true,
    };
  }
}

router.get('/', async (req, res) => {
  const settings = await getOrCreateSettings();
  return res.json(settings);
});

// Upload du logo de signature email : sauvegarde le fichier sur disque (persistant via volume Docker)
// et stocke son URL absolue sur SystemSettings, pour qu'elle reste résolvable depuis la boîte mail
// du destinataire (pas seulement depuis le navigateur de l'admin). L'URL de base utilisée vient du
// réglage UI "URL du serveur" si configuré, sinon de BACKEND_URL, sinon localhost.
router.post(
  '/signature-logo',
  requirePermission('automation.manage', ['ADMIN']),
  logoUpload.single('logo'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });

    // Valider que le fichier n'est pas dangereux
    const validation = validateUpload(req.file.originalname, req.file.mimetype, 'logo');
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const settings = await getOrCreateSettings();
    const backendUrl = resolveBackendUrl(settings);
    const logoUrl = `${backendUrl}/uploads/signature-logo/${req.file.filename}`;

    const updated = await prisma.systemSettings.update({ where: { id: 1 }, data: { signatureLogoUrl: logoUrl } });
    return res.json(updated);
  }
);

router.patch(
  '/',
  requirePermission('automation.manage', ['ADMIN']),
  [
    body('draftReminderEnabled').optional().isBoolean(),
    body('draftReminderDelayMinutes').optional().isInt({ min: 1, max: 1440 }),
    body('enableFewShotTriage').optional().isBoolean(),
    body('acknowledgementMessage').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('emailSignature').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('signatureLogoUrl').optional({ nullable: true }).isString(),
    body('signatureLogoHeight').optional().isInt({ min: 16, max: 200 }),
    body('dailySummaryEnabled').optional().isBoolean(),
    body('dailySummaryTime').optional().matches(/^([01]\d|2[0-3]):([0-5]\d)$/),
    body('dailySummaryRecipients').optional().isArray(),
    body('dailySummaryRecipients.*').optional().isEmail(),
    body('ticketCreationEmailEnabled').optional().isBoolean(),
    body('ticketCreationEmailRecipients').optional().isArray(),
    body('ticketCreationEmailRecipients.*').optional().isEmail(),
    body('notifyTechnicianOnAssignment').optional().isBoolean(),
    body('emailFailureNotificationEmail').optional({ nullable: true }).isEmail(),
    body('emailFailureNotificationRecipients').optional().isArray(),
    body('emailFailureNotificationRecipients.*').optional().isEmail(),
    body('slaHours').optional().isObject(),
    body('slaMonitorIntervalSeconds').optional().isInt({ min: 0, max: 3600 }),
    body('enableAutoCreateSkills').optional().isBoolean(),
    body('emailAcknowledgementEnabled').optional().isBoolean(),
    body('emailKnownIncidentEnabled').optional().isBoolean(),
    body('emailAssignmentEnabled').optional().isBoolean(),
    body('emailSlaBreachEnabled').optional().isBoolean(),
    body('emailDueDateBreachEnabled').optional().isBoolean(),
    body('emailStatusChangeEnabled').optional().isBoolean(),
    body('emailResolvedEnabled').optional().isBoolean(),
    body('emailEscalationEnabled').optional().isBoolean(),
    body('emailMajorIncidentResolvedEnabled').optional().isBoolean(),
    body('emailApprovalEnabled').optional().isBoolean(),
    body('solvedAutoCloseDays').optional().isInt({ min: 0, max: 365 }),
    body('voiceAiModelId').optional({ nullable: true }).isInt(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    await getOrCreateSettings();

    const data = {};
    if (req.body.draftReminderEnabled !== undefined) data.draftReminderEnabled = req.body.draftReminderEnabled;
    if (req.body.draftReminderDelayMinutes !== undefined) data.draftReminderDelayMinutes = req.body.draftReminderDelayMinutes;
    if (req.body.enableFewShotTriage !== undefined) data.enableFewShotTriage = req.body.enableFewShotTriage;
    if (req.body.acknowledgementMessage !== undefined) data.acknowledgementMessage = req.body.acknowledgementMessage || null;
    if (req.body.emailSignature !== undefined) data.emailSignature = req.body.emailSignature || null;
    if (req.body.signatureLogoUrl !== undefined) data.signatureLogoUrl = req.body.signatureLogoUrl || null;
    if (req.body.signatureLogoHeight !== undefined) data.signatureLogoHeight = req.body.signatureLogoHeight;
    if (req.body.dailySummaryEnabled !== undefined) data.dailySummaryEnabled = req.body.dailySummaryEnabled;
    if (req.body.dailySummaryTime !== undefined) data.dailySummaryTime = req.body.dailySummaryTime;
    if (req.body.dailySummaryRecipients !== undefined) data.dailySummaryRecipients = req.body.dailySummaryRecipients;
    if (req.body.ticketCreationEmailEnabled !== undefined) data.ticketCreationEmailEnabled = req.body.ticketCreationEmailEnabled;
    if (req.body.ticketCreationEmailRecipients !== undefined) data.ticketCreationEmailRecipients = req.body.ticketCreationEmailRecipients;
    if (req.body.notifyTechnicianOnAssignment !== undefined) data.notifyTechnicianOnAssignment = req.body.notifyTechnicianOnAssignment;
    if (req.body.emailFailureNotificationEmail !== undefined) data.emailFailureNotificationEmail = req.body.emailFailureNotificationEmail || null;
    if (req.body.emailFailureNotificationRecipients !== undefined) data.emailFailureNotificationRecipients = req.body.emailFailureNotificationRecipients;
    if (req.body.enableAutoCreateSkills !== undefined) data.enableAutoCreateSkills = req.body.enableAutoCreateSkills;
    if (req.body.slaHours !== undefined) data.slaHours = req.body.slaHours;
    if (req.body.slaMonitorIntervalSeconds !== undefined) data.slaMonitorIntervalSeconds = req.body.slaMonitorIntervalSeconds;
    if (req.body.solvedAutoCloseDays !== undefined) data.solvedAutoCloseDays = req.body.solvedAutoCloseDays;
    if (req.body.emailAcknowledgementEnabled !== undefined) data.emailAcknowledgementEnabled = req.body.emailAcknowledgementEnabled;
    if (req.body.emailKnownIncidentEnabled !== undefined) data.emailKnownIncidentEnabled = req.body.emailKnownIncidentEnabled;
    if (req.body.emailAssignmentEnabled !== undefined) data.emailAssignmentEnabled = req.body.emailAssignmentEnabled;
    if (req.body.emailSlaBreachEnabled !== undefined) data.emailSlaBreachEnabled = req.body.emailSlaBreachEnabled;
    if (req.body.emailDueDateBreachEnabled !== undefined) data.emailDueDateBreachEnabled = req.body.emailDueDateBreachEnabled;
    if (req.body.emailStatusChangeEnabled !== undefined) data.emailStatusChangeEnabled = req.body.emailStatusChangeEnabled;
    if (req.body.emailResolvedEnabled !== undefined) data.emailResolvedEnabled = req.body.emailResolvedEnabled;
    if (req.body.emailEscalationEnabled !== undefined) data.emailEscalationEnabled = req.body.emailEscalationEnabled;
    if (req.body.emailMajorIncidentResolvedEnabled !== undefined) data.emailMajorIncidentResolvedEnabled = req.body.emailMajorIncidentResolvedEnabled;
    if (req.body.emailApprovalEnabled !== undefined) data.emailApprovalEnabled = req.body.emailApprovalEnabled;
    if (req.body.voiceAiModelId !== undefined) data.voiceAiModelId = req.body.voiceAiModelId || null;

    const updated = await prisma.systemSettings.update({ where: { id: 1 }, data });
    cacheStore.clear();

    auditLog('SYSTEM_SETTINGS_UPDATED', { actor: req.user, targetType: 'SystemSettings', targetId: 1, targetLabel: 'Réglages automatisation', metadata: { changedFields: Object.keys(data) } }).catch(() => {});

    return res.json(updated);
  }
);

// Déclenche un envoi immédiat du récapitulatif, pour vérifier le rendu/les destinataires sans
// attendre l'heure configurée.
router.post('/daily-summary/test', requirePermission('automation.manage', ['ADMIN']), async (req, res) => {
  try {
    const result = await sendDailySummary();
    return res.json(result);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

// ── Test d'envoi de templates email ─────────────────────────────────────────
// Envoie un email de test avec un template donné (prédéfini avec des données fictives)
// pour vérifier le rendu visuel sans créer de ticket réel. Chaque template réutilise
// le même builder que l'envoi réel (emailSender.js) : le test reflète exactement le rendu
// que recevront les destinataires.
const {
  sendEmail,
  buildAcknowledgementHtml, buildKnownIncidentNotificationHtml,
  buildAssignmentNotificationHtml, buildSlaBreachHtml, buildDueDateHtml,
  buildStatusChangeHtml, buildReminderHtml, getEmailSignature,
} = require('../services/emailSender');

const EMAIL_TEST_TEMPLATES = {
  acknowledgement: {
    label: 'Accusé de réception',
    build: ({ signature, ticketLink }) => buildAcknowledgementHtml({
      toName: 'Jean Dupont', glpiTicketId: 999, ticketId: 999,
      originalSubject: 'Problème d\'impression bureau 305',
      customMessage: 'Votre demande a bien été reçue (ticket #{ticketId}).',
      signature, ticketLink,
    }),
  },
  known_incident: {
    label: 'Incident déjà connu',
    build: ({ signature, ticketLink }) => buildKnownIncidentNotificationHtml({
      toName: 'Jean Dupont', glpiTicketId: 999, ticketId: 999,
      originalSubject: 'Panne réseau site Abidjan', isMajor: true, impactedCount: 12,
      signature, ticketLink,
    }),
  },
  assignment: {
    label: 'Assignation technicien',
    build: ({ signature, ticketLink }) => buildAssignmentNotificationHtml({
      technicianName: 'Jean Dupont', glpiTicketId: 999, ticketId: 999,
      ticketTitle: 'Test template email', priority: 'P2', category: 'IT — Matériel', teamName: 'Support IT',
      signature, ticketLink,
    }),
  },
  sla_breach: {
    label: 'Dépassement SLA',
    build: ({ signature, ticketLink }) => buildSlaBreachHtml({
      technicianName: 'Jean Dupont', glpiTicketId: 999, ticketId: 999,
      ticketTitle: 'Test template email', priority: 'P2',
      slaResponseDueAt: new Date(Date.now() - 3600000).toISOString(),
      signature, ticketLink,
    }),
  },
  due_date: {
    label: 'Dépassement échéance',
    build: ({ signature, ticketLink }) => buildDueDateHtml({
      technicianName: 'Jean Dupont', glpiTicketId: 999, ticketId: 999,
      ticketTitle: 'Test template email', priority: 'P2',
      dueDate: new Date(Date.now() - 7200000).toISOString(),
      signature, ticketLink,
    }),
  },
  status_change: {
    label: 'Changement de statut',
    build: ({ signature, ticketLink }) => buildStatusChangeHtml({
      recipientName: 'Jean Dupont', glpiTicketId: 999, ticketId: 999,
      ticketTitle: 'Test template email', status: 'OPEN', priority: 'P2', category: 'IT — Matériel',
      signature, ticketLink,
    }),
  },
  reminder: {
    label: 'Relance demandeur',
    build: ({ signature, ticketLink }) => buildReminderHtml({
      toName: 'Jean Dupont', glpiTicketId: 999, ticketId: 999,
      subject: 'Test template email', isPreClose: false,
      signature, ticketLink,
    }),
  },
};

router.post('/test-email', requirePermission('automation.manage', ['ADMIN']), async (req, res) => {
  try {
    const { type, recipientEmail } = req.body;
    if (!type || !EMAIL_TEST_TEMPLATES[type]) {
      return res.status(400).json({ error: `Type inconnu. Types disponibles : ${Object.keys(EMAIL_TEST_TEMPLATES).join(', ')}` });
    }
    if (!recipientEmail) {
      return res.status(400).json({ error: 'recipientEmail est requis' });
    }

    const settings = await getOrCreateSettings();
    const frontendUrl = resolveFrontendUrl(settings);
    const signature = await getEmailSignature();

    const ticketLink = `${frontendUrl}/tickets/999`;
    const templateCtx = { signature, ticketLink };

    const bodyHtml = EMAIL_TEST_TEMPLATES[type].build(templateCtx);

    const subject = `[Test] ${EMAIL_TEST_TEMPLATES[type].label} — Ticket #999`;
    await sendEmail({ ticketId: null, to: recipientEmail, subject, bodyHtml, saveAsMessage: false });
    return res.json({ sent: true, type, recipientEmail });
  } catch (err) {
    console.error('[systemsettings] Test email échoué:', err.message);
    return res.status(502).json({ error: err.message });
  }
});

// ── Lancer manuellement la fermeture auto des tickets résolus ─────────────
router.post('/solved-auto-close/run-now', requirePermission('automation.manage', ['ADMIN']), async (req, res) => {
  try {
    const results = await runSolvedAutoCloseScheduler();
    return res.json({ closed: results.length, results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Diagnostic : liste les tickets SOLVED avec leurs dates ────────────────
router.get('/solved-auto-close/debug', requirePermission('automation.manage', ['ADMIN']), async (req, res) => {
  try {
    const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
    const autoCloseDays = settings?.solvedAutoCloseDays ?? 3;
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - autoCloseDays);

    const tickets = await prisma.ticket.findMany({
      where: { status: 'SOLVED' },
      select: { id: true, title: true, solvedAt: true, updatedAt: true, createdAt: true },
      orderBy: { solvedAt: 'asc' },
    });

    return res.json({
      solvedAutoCloseDays: autoCloseDays,
      threshold: threshold.toISOString(),
      totalSolved: tickets.length,
      tickets: tickets.map((t) => ({
        id: t.id,
        title: t.title?.substring(0, 60),
        solvedAt: t.solvedAt,
        updatedAt: t.updatedAt,
        createdAt: t.createdAt,
        shouldClose: t.solvedAt ? t.solvedAt <= threshold : t.updatedAt <= threshold,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;