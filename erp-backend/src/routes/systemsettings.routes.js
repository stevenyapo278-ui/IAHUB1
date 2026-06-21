const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

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

// Upload du logo de signature email : sauvegarde le fichier sur disque (persistant via volume Docker)
// et stocke son URL absolue (BACKEND_URL) sur SystemSettings, pour qu'elle reste résolvable depuis
// la boîte mail du destinataire (pas seulement depuis le navigateur de l'admin).
router.post(
  '/signature-logo',
  requirePermission('automation.manage', ['ADMIN']),
  logoUpload.single('logo'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });

    const backendUrl = process.env.BACKEND_URL || 'http://localhost:4000';
    const logoUrl = `${backendUrl}/uploads/signature-logo/${req.file.filename}`;

    await getOrCreateSettings();
    const updated = await prisma.systemSettings.update({ where: { id: 1 }, data: { signatureLogoUrl: logoUrl } });
    return res.json(updated);
  }
);

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
    body('acknowledgementMessage').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('emailSignature').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('signatureLogoUrl').optional({ nullable: true }).isString(),
    body('signatureLogoHeight').optional().isInt({ min: 16, max: 200 }),
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
    if (req.body.acknowledgementMessage !== undefined) data.acknowledgementMessage = req.body.acknowledgementMessage || null;
    if (req.body.emailSignature !== undefined) data.emailSignature = req.body.emailSignature || null;
    if (req.body.signatureLogoUrl !== undefined) data.signatureLogoUrl = req.body.signatureLogoUrl || null;
    if (req.body.signatureLogoHeight !== undefined) data.signatureLogoHeight = req.body.signatureLogoHeight;

    const updated = await prisma.systemSettings.update({ where: { id: 1 }, data });
    return res.json(updated);
  }
);

module.exports = router;
