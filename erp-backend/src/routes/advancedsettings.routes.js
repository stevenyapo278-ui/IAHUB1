const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/permissions');
const { normalizeHost, resolveBackendUrl, resolveFrontendUrl } = require('../services/systemSettings');

// Réglages réservés au SUPERADMIN — déplacés hors de Paramètres > Automatisation (accessible à
// tout ADMIN) car une mauvaise valeur ici peut casser la synchro GLPI/email, envoyer des emails
// sans validation humaine, ou rendre les liens/images des emails inutilisables (adresse du serveur).
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

// Valeur effectivement utilisée pour les URLs absolues (logo, liens email) si rien n'est saisi
// ici — vient de BACKEND_URL/FRONTEND_URL (variable d'environnement Docker), sinon localhost. Sert
// à pré-remplir l'UI avec la valeur réellement active, plutôt qu'un champ vide qui ne dit pas ce
// qui se passe par défaut.
router.get('/server-urls/effective', async (req, res) => {
  const settings = await getOrCreateSettings();
  const stripProtocol = (url) => url.replace(/^https?:\/\//i, '');
  return res.json({
    backendHost: stripProtocol(resolveBackendUrl(settings)),
    frontendHost: stripProtocol(resolveFrontendUrl(settings)),
  });
});

router.patch(
  '/',
  [
    body('autoApproveGlpiSolutions').optional().isBoolean(),
    body('autoSendAiEmails').optional().isBoolean(),
    body('enableGlpiTicketCreation').optional().isBoolean(),
    body('activeGlpiInstance').optional().isString().isIn(['glpi']).withMessage('Instance GLPI invalide'),
    body('glpiTicketsSyncIntervalSeconds').optional().isInt({ min: 0, max: 3600 }),
    body('emailSyncIntervalSeconds').optional().isInt({ min: 0, max: 3600 }),
    body('glpiTeamsCategoriesSyncIntervalMinutes').optional().isInt({ min: 0, max: 1440 }),
    body('aiModelsSyncIntervalHours').optional().isInt({ min: 0, max: 168 }),
    body('backendUrl').optional({ nullable: true }).isString().isLength({ max: 500 }),
    body('frontendUrl').optional({ nullable: true }).isString().isLength({ max: 500 }),
    body('goLiveDate').optional({ nullable: true }).isISO8601().withMessage('Format ISO8601 requis pour goLiveDate (ex: 2026-07-15T08:00:00Z)'),
    body('closedTicketBehavior').optional().isString().isIn(['create_new', 'reopen']).withMessage('closedTicketBehavior doit être create_new ou reopen'),
    body('reopenThresholdDays').optional().isInt({ min: 1, max: 730 }).withMessage('reopenThresholdDays doit être entre 1 et 730'),
    body('glpiSourceMarker').optional().isString().isIn(['internal_note', 'none']).withMessage('glpiSourceMarker doit être internal_note ou none'),
    body('dryRunMode').optional().isBoolean(),
    body('enableGlpiFollowupCreation').optional().isBoolean(),
    body('enableGlpiTicketClosure').optional().isBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    await getOrCreateSettings();

    const data = {};
    if (req.body.autoApproveGlpiSolutions !== undefined) data.autoApproveGlpiSolutions = req.body.autoApproveGlpiSolutions;
    if (req.body.autoSendAiEmails !== undefined) data.autoSendAiEmails = req.body.autoSendAiEmails;
    if (req.body.enableGlpiTicketCreation !== undefined) data.enableGlpiTicketCreation = req.body.enableGlpiTicketCreation;
    if (req.body.activeGlpiInstance !== undefined) data.activeGlpiInstance = req.body.activeGlpiInstance;
    if (req.body.glpiTicketsSyncIntervalSeconds !== undefined) data.glpiTicketsSyncIntervalSeconds = req.body.glpiTicketsSyncIntervalSeconds;
    if (req.body.emailSyncIntervalSeconds !== undefined) data.emailSyncIntervalSeconds = req.body.emailSyncIntervalSeconds;
    if (req.body.glpiTeamsCategoriesSyncIntervalMinutes !== undefined) data.glpiTeamsCategoriesSyncIntervalMinutes = req.body.glpiTeamsCategoriesSyncIntervalMinutes;
    if (req.body.aiModelsSyncIntervalHours !== undefined) data.aiModelsSyncIntervalHours = req.body.aiModelsSyncIntervalHours;
    if (req.body.backendUrl !== undefined) data.backendUrl = normalizeHost(req.body.backendUrl);
    if (req.body.frontendUrl !== undefined) data.frontendUrl = normalizeHost(req.body.frontendUrl);

    if (req.body.goLiveDate !== undefined) data.goLiveDate = req.body.goLiveDate ? new Date(req.body.goLiveDate) : null;
    if (req.body.closedTicketBehavior !== undefined) data.closedTicketBehavior = req.body.closedTicketBehavior;
    if (req.body.reopenThresholdDays !== undefined) data.reopenThresholdDays = req.body.reopenThresholdDays;
    if (req.body.glpiSourceMarker !== undefined) data.glpiSourceMarker = req.body.glpiSourceMarker;
    if (req.body.dryRunMode !== undefined) data.dryRunMode = req.body.dryRunMode;
    if (req.body.enableGlpiFollowupCreation !== undefined) data.enableGlpiFollowupCreation = req.body.enableGlpiFollowupCreation;
    if (req.body.enableGlpiTicketClosure !== undefined) data.enableGlpiTicketClosure = req.body.enableGlpiTicketClosure;

    const updated = await prisma.systemSettings.update({ where: { id: 1 }, data });
    return res.json(updated);
  }
);

// État de santé de chaque tâche automatique planifiée (sync GLPI, emails, relances...) — voir
// services/schedulerHealth.js. Permet de voir une panne avant qu'un utilisateur s'en plaigne.
router.get('/scheduler-health', async (req, res) => {
  const health = await prisma.schedulerHealth.findMany({ orderBy: { name: 'asc' } });
  return res.json(health);
});

module.exports = router;
