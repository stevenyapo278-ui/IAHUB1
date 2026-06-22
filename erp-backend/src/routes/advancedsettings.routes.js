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
    body('glpiTicketsSyncIntervalSeconds').optional().isInt({ min: 0, max: 3600 }),
    body('emailSyncIntervalSeconds').optional().isInt({ min: 0, max: 3600 }),
    body('glpiTeamsCategoriesSyncIntervalMinutes').optional().isInt({ min: 0, max: 1440 }),
    body('aiModelsSyncIntervalHours').optional().isInt({ min: 0, max: 168 }),
    body('backendUrl').optional({ nullable: true }).isString().isLength({ max: 500 }),
    body('frontendUrl').optional({ nullable: true }).isString().isLength({ max: 500 }),
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
    if (req.body.backendUrl !== undefined) data.backendUrl = normalizeHost(req.body.backendUrl);
    if (req.body.frontendUrl !== undefined) data.frontendUrl = normalizeHost(req.body.frontendUrl);

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
