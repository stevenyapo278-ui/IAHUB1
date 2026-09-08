const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { sendDailySummary } = require('../services/dailySummary');
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
// pour vérifier le rendu visuel sans créer de ticket réel.
const {
  sendEmail, buildAcknowledgementHtml, buildKnownIncidentNotificationHtml,
  sendAssignmentNotificationEmail, sendSlaBreachEmail, sendDueDateEmail,
  sendTicketStatusNotification, sendReminder, getEmailSignature,
} = require('../services/emailSender');

const EMAIL_TEST_TEMPLATES = {
  acknowledgement: {
    label: 'Accusé de réception',
    build: (signature, ticketLink) => buildAcknowledgementHtml({
      toName: 'Jean Dupont', glpiTicketId: 999, ticketId: 999,
      originalSubject: 'Problème d\'impression bureau 305',
      customMessage: 'Votre demande a bien été reçue (ticket #{ticketId}).',
      signature,
      ticketLink,
    }),
  },
  known_incident: {
    label: 'Incident déjà connu',
    build: (signature) => buildKnownIncidentNotificationHtml({
      toName: 'Jean Dupont', glpiTicketId: 999, ticketId: 999,
      originalSubject: 'Panne réseau site Abidjan', isMajor: true, impactedCount: 12,
      signature,
    }),
  },
  assignment: {
    label: 'Assignation technicien',
    build: null, // send function, not build
  },
  sla_breach: {
    label: 'Dépassement SLA',
    build: null,
  },
  due_date: {
    label: 'Dépassement échéance',
    build: null,
  },
  status_change: {
    label: 'Changement de statut',
    build: null,
  },
  reminder: {
    label: 'Relance demandeur',
    build: null,
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

    const mockTicket = {
      ticketId: 999, glpiTicketId: 999, ticketTitle: 'Test template email',
      priority: 'P2', category: 'IT — Matériel',
    };

    const mockRequester = { requesterEmail: recipientEmail, requesterName: 'Jean Dupont' };

    let bodyHtml;

    switch (type) {
      case 'acknowledgement':
        bodyHtml = EMAIL_TEST_TEMPLATES.acknowledgement.build(signature, `${frontendUrl}/tickets/999`);
        break;
      case 'known_incident':
        bodyHtml = EMAIL_TEST_TEMPLATES.known_incident.build(signature);
        break;
      case 'assignment':
        bodyHtml = `
<p>Bonjour Jean Dupont,</p>
<p>Un nouveau ticket vient de vous être <strong>assigné automatiquement</strong> par notre système d'analyse IA.</p>
<table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:600px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:14px;font-family:sans-serif">
  <tr><td style="padding:8px 12px;color:#4b5563;font-weight:600;width:180px;vertical-align:top">Numéro de ticket</td><td style="padding:8px 12px"><strong>#999</strong></td></tr>
  <tr style="background:#f9fafb"><td style="padding:8px 12px;color:#4b5563;font-weight:600">Sujet</td><td style="padding:8px 12px"><strong>Test template email</strong></td></tr>
  <tr><td style="padding:8px 12px;color:#4b5563;font-weight:600">Catégorie</td><td style="padding:8px 12px">IT — Matériel</td></tr>
  <tr style="background:#f9fafb"><td style="padding:8px 12px;color:#4b5563;font-weight:600">Priorité</td><td style="padding:8px 12px;color:#d97706;font-weight:600"><strong>Haute</strong></td></tr>
</table>
<p style="margin:20px 0"><a href="${frontendUrl}/tickets/999" style="background:#2563eb;color:#ffffff;padding:10px 20px;text-decoration:none;display:inline-block;border-radius:8px;font-weight:bold;font-size:14px;font-family:sans-serif">Prendre en charge le ticket</a></p>
<p style="color:#6b7280;font-size:12px">Connectez-vous à l'application pour consulter le détail et intervenir sur ce ticket.</p>
${signature}`;
        break;
      case 'sla_breach':
        bodyHtml = `
<p>Bonjour Jean Dupont,</p>
<p>Le ticket <strong>#999 — Test template email</strong> a dépassé son délai de réponse SLA.</p>
<table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:600px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:14px;font-family:sans-serif">
  <tr><td style="padding:8px 12px;color:#4b5563;font-weight:600;width:180px;vertical-align:top">Numéro de ticket</td><td style="padding:8px 12px"><strong>#999</strong></td></tr>
  <tr style="background:#f9fafb"><td style="padding:8px 12px;color:#4b5563;font-weight:600">Sujet</td><td style="padding:8px 12px">Test template email</td></tr>
  <tr><td style="padding:8px 12px;color:#4b5563;font-weight:600">Priorité</td><td style="padding:8px 12px;color:#d97706;font-weight:600"><strong>Haute</strong></td></tr>
  <tr style="background:#f9fafb"><td style="padding:8px 12px;color:#4b5563;font-weight:600">Délai de réponse attendu</td><td style="padding:8px 12px;color:#dc2626;font-weight:600"><strong>${new Date(Date.now() - 3600000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</strong></td></tr>
</table>
<p style="margin:20px 0"><a href="${frontendUrl}/tickets/999" style="background:#2563eb;color:#ffffff;padding:10px 20px;text-decoration:none;display:inline-block;border-radius:8px;font-weight:bold;font-size:14px;font-family:sans-serif">Prendre en charge le ticket</a></p>
<p style="color:#6b7280;font-size:12px">Ce ticket doit être pris en charge rapidement — connectez-vous pour répondre au demandeur.</p>
${signature}`;
        break;
      case 'due_date':
        bodyHtml = `
<p>Bonjour Jean Dupont,</p>
<p>Le ticket <strong>#999 — Test template email</strong> a dépassé son <strong>échéance manuelle</strong>.</p>
<table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:600px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:14px;font-family:sans-serif">
  <tr><td style="padding:8px 12px;color:#4b5563;font-weight:600;width:180px;vertical-align:top">Numéro de ticket</td><td style="padding:8px 12px"><strong>#999</strong></td></tr>
  <tr style="background:#f9fafb"><td style="padding:8px 12px;color:#4b5563;font-weight:600">Sujet</td><td style="padding:8px 12px">Test template email</td></tr>
  <tr><td style="padding:8px 12px;color:#4b5563;font-weight:600">Priorité</td><td style="padding:8px 12px;color:#d97706;font-weight:600"><strong>Haute</strong></td></tr>
  <tr style="background:#f9fafb"><td style="padding:8px 12px;color:#4b5563;font-weight:600">Échéance prévue</td><td style="padding:8px 12px;color:#dc2626;font-weight:600"><strong>${new Date(Date.now() - 7200000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</strong></td></tr>
</table>
<p style="margin:20px 0"><a href="${frontendUrl}/tickets/999" style="background:#2563eb;color:#ffffff;padding:10px 20px;text-decoration:none;display:inline-block;border-radius:8px;font-weight:bold;font-size:14px;font-family:sans-serif">Traiter le ticket</a></p>
<p style="color:#6b7280;font-size:12px">Ce ticket doit être pris en charge rapidement — connectez-vous pour le traiter.</p>
${signature}`;
        break;
      case 'status_change':
        bodyHtml = `
<p>Bonjour Jean Dupont,</p>
<p>Le statut de votre demande a changé :</p>
<table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:600px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:14px;font-family:sans-serif">
  <tr><td style="padding:8px 12px;color:#4b5563;font-weight:600;width:180px;vertical-align:top">Numéro de ticket</td><td style="padding:8px 12px"><strong>#999</strong></td></tr>
  <tr style="background:#f9fafb"><td style="padding:8px 12px;color:#4b5563;font-weight:600">Sujet</td><td style="padding:8px 12px"><strong>Test template email</strong></td></tr>
  <tr><td style="padding:8px 12px;color:#4b5563;font-weight:600">Nouveau statut</td><td style="padding:8px 12px;color:#2563eb;font-weight:600"><strong>En cours (Attribué)</strong></td></tr>
  <tr style="background:#f9fafb"><td style="padding:8px 12px;color:#4b5563;font-weight:600">Catégorie</td><td style="padding:8px 12px">IT — Matériel</td></tr>
  <tr><td style="padding:8px 12px;color:#4b5563;font-weight:600">Priorité</td><td style="padding:8px 12px;color:#d97706;font-weight:600"><strong>Haute</strong></td></tr>
</table>
<p style="margin:20px 0"><a href="${frontendUrl}/tickets/999" style="background:#2563eb;color:#ffffff;padding:10px 20px;text-decoration:none;display:inline-block;border-radius:8px;font-weight:bold;font-size:14px;font-family:sans-serif">Suivre mon ticket</a></p>
<p>Vous pouvez suivre votre demande et ajouter des informations directement dans le portail.</p>
${signature}`;
        break;
      case 'reminder':
        bodyHtml = `
<p>Bonjour Jean Dupont,</p>
<p>Nous revenons vers vous concernant votre ticket en cours :</p>
<table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:600px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:14px;font-family:sans-serif">
  <tr><td style="padding:8px 12px;color:#4b5563;font-weight:600;width:180px;vertical-align:top">Numéro de ticket</td><td style="padding:8px 12px"><strong>#999</strong></td></tr>
  <tr style="background:#f9fafb"><td style="padding:8px 12px;color:#4b5563;font-weight:600">Sujet</td><td style="padding:8px 12px">Test template email</td></tr>
</table>
<p>Votre demande est toujours en attente. Pouvez-vous nous confirmer si le problème est résolu ou s'il persiste ?</p>
<p>Répondez simplement à cet email ou cliquez sur le bouton ci-dessous :</p>
<p style="margin:20px 0"><a href="${frontendUrl}/tickets/999" style="background:#2563eb;color:#ffffff;padding:10px 20px;text-decoration:none;display:inline-block;border-radius:8px;font-weight:bold;font-size:14px;font-family:sans-serif">Suivre mon ticket</a></p>
${signature}`;
        break;
    }

    const subject = `[Test] ${EMAIL_TEST_TEMPLATES[type].label} — Ticket #999`;
    await sendEmail({ ticketId: null, to: recipientEmail, subject, bodyHtml, saveAsMessage: false });
    return res.json({ sent: true, type, recipientEmail });
  } catch (err) {
    console.error('[systemsettings] Test email échoué:', err.message);
    return res.status(502).json({ error: err.message });
  }
});

module.exports = router;
