const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { sendDailySummary } = require('../services/dailySummary');
const { resolveBackendUrl } = require('../services/systemSettings');

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
// et stocke son URL absolue sur SystemSettings, pour qu'elle reste résolvable depuis la boîte mail
// du destinataire (pas seulement depuis le navigateur de l'admin). L'URL de base utilisée vient du
// réglage UI "URL du serveur" si configuré, sinon de BACKEND_URL, sinon localhost.
router.post(
  '/signature-logo',
  requirePermission('automation.manage', ['ADMIN']),
  logoUpload.single('logo'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });

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
    body('notifyTechnicianOnAssignment').optional().isBoolean(),
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
    if (req.body.notifyTechnicianOnAssignment !== undefined) data.notifyTechnicianOnAssignment = req.body.notifyTechnicianOnAssignment;

    const updated = await prisma.systemSettings.update({ where: { id: 1 }, data });

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

module.exports = router;
