const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(authenticate);
router.use(requirePermission('settings.integrations'));

function maskKey(key) {
  if (!key) return null;
  if (key.length <= 4) return '****';
  return `${'*'.repeat(key.length - 4)}${key.slice(-4)}`;
}

router.get('/', async (req, res) => {
  const configs = await prisma.apiConfig.findMany({ orderBy: { serviceName: 'asc' } });
  return res.json(configs.map((c) => ({ ...c, apiKey: maskKey(c.apiKey) })));
});

router.get('/:id', async (req, res) => {
  const config = await prisma.apiConfig.findUnique({ where: { id: Number(req.params.id) } });
  if (!config) return res.status(404).json({ error: 'Configuration introuvable' });
  return res.json({ ...config, apiKey: maskKey(config.apiKey) });
});

// Champs requis par service connu, pour donner un message d'erreur précis
const REQUIRED_FIELDS = {
  glpi: [
    { key: 'baseUrl', label: 'URL de base' },
    { key: 'apiKey', label: 'Clé API (User Token)' },
    { key: 'extra.appToken', label: 'App Token' },
  ],
};

function getMissingFields(serviceName, { baseUrl, apiKey, extra }) {
  const required = REQUIRED_FIELDS[serviceName];
  if (!required) return [];
  const values = { baseUrl, apiKey, 'extra.appToken': extra?.appToken };
  return required.filter((f) => !values[f.key]).map((f) => f.label);
}

router.post('/', [body('serviceName').notEmpty()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { serviceName, baseUrl, apiKey, extra, isActive } = req.body;

  const existing = await prisma.apiConfig.findUnique({ where: { serviceName } });
  if (existing) return res.status(409).json({ error: 'Cette configuration existe déjà' });

  const missing = getMissingFields(serviceName, { baseUrl, apiKey, extra });
  if (missing.length > 0) {
    return res.status(400).json({ error: `Champ(s) manquant(s) : ${missing.join(', ')}` });
  }

  const config = await prisma.apiConfig.create({
    data: {
      serviceName,
      baseUrl: baseUrl || null,
      apiKey: apiKey || null,
      extra: extra || undefined,
      isActive: isActive !== undefined ? isActive : true,
    },
  });

  return res.status(201).json({ ...config, apiKey: maskKey(config.apiKey) });
});

// Les id GLPI (glpiTicketId, glpiGroupId, glpiCategoryId) sont des numéros internes à CHAQUE
// instance GLPI, pas des identifiants universels — un ticket #5 sur le nouveau GLPI n'a aucun
// rapport avec le ticket #5 de l'ancien. Détache toutes les correspondances existantes pour que
// la prochaine synchro recrée les vrais liens proprement, sans faux raccordement par collision d'id.
async function detachGlpiLinks() {
  const [tickets, teams, categories] = await Promise.all([
    prisma.ticket.updateMany({ where: { glpiTicketId: { not: null } }, data: { glpiTicketId: null } }),
    prisma.team.updateMany({ where: { glpiGroupId: { not: null } }, data: { glpiGroupId: null } }),
    prisma.ticketCategory.deleteMany({}), // pas de glpiCategoryId nullable : on repart d'une table vide, resynchronisée immédiatement après
  ]);
  return { tickets: tickets.count, teams: teams.count, categories: categories.count };
}

router.patch('/:id', async (req, res) => {
  const { baseUrl, apiKey, extra, isActive } = req.body;
  const data = {};
  if (baseUrl !== undefined) data.baseUrl = baseUrl;
  if (apiKey !== undefined) data.apiKey = apiKey;
  if (extra !== undefined) data.extra = extra;
  if (isActive !== undefined) data.isActive = isActive;

  const before = await prisma.apiConfig.findUnique({ where: { id: Number(req.params.id) } });
  if (!before) return res.status(404).json({ error: 'Configuration introuvable' });

  // Changement d'instance GLPI détecté (URL différente) — on détache les anciens liens avant
  // d'enregistrer la nouvelle config, sinon la prochaine synchro mélangerait les deux instances.
  const isGlpiUrlChange = before.serviceName === 'glpi' && baseUrl !== undefined && baseUrl !== before.baseUrl && before.baseUrl;
  let detached = null;
  if (isGlpiUrlChange) {
    detached = await detachGlpiLinks();
  }

  try {
    const config = await prisma.apiConfig.update({ where: { id: Number(req.params.id) }, data });
    return res.json({ ...config, apiKey: maskKey(config.apiKey), ...(detached ? { glpiLinksReset: detached } : {}) });
  } catch (err) {
    return res.status(404).json({ error: 'Configuration introuvable' });
  }
});

// Teste la connexion au service configuré (actuellement supporté : glpi)
router.post('/:id/test-connection', async (req, res) => {
  const config = await prisma.apiConfig.findUnique({ where: { id: Number(req.params.id) } });
  if (!config) return res.status(404).json({ error: 'Configuration introuvable' });

  const missing = getMissingFields(config.serviceName, config);
  if (missing.length > 0) {
    return res.status(422).json({ connected: false, error: `Champ(s) manquant(s) : ${missing.join(', ')}` });
  }

  if (config.serviceName === 'glpi') {
    try {
      const appToken = config.extra?.appToken;
      const sessionRes = await fetch(`${config.baseUrl}/initSession`, {
        headers: { 'App-Token': appToken, Authorization: `user_token ${config.apiKey}` },
      });
      const data = await sessionRes.json().catch(() => null);
      if (!sessionRes.ok || !data?.session_token) {
        const message = Array.isArray(data) ? data[1] : 'Réponse GLPI invalide';
        return res.status(422).json({ connected: false, error: message || `Échec (${sessionRes.status})` });
      }
      await fetch(`${config.baseUrl}/killSession`, {
        headers: { 'App-Token': appToken, 'Session-Token': data.session_token },
      }).catch(() => {});
      return res.json({ connected: true });
    } catch (err) {
      return res.status(502).json({ connected: false, error: err.message || 'Connexion impossible' });
    }
  }

  return res.status(422).json({ connected: false, error: `Test de connexion non supporté pour "${config.serviceName}"` });
});

router.delete('/:id', async (req, res) => {
  try {
    await prisma.apiConfig.delete({ where: { id: Number(req.params.id) } });
    return res.status(204).send();
  } catch (err) {
    return res.status(404).json({ error: 'Configuration introuvable' });
  }
});

module.exports = router;
