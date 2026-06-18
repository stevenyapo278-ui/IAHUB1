const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
router.use(authorize('ADMIN'));

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

router.post('/', [body('serviceName').notEmpty()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { serviceName, baseUrl, apiKey, extra, isActive } = req.body;

  const existing = await prisma.apiConfig.findUnique({ where: { serviceName } });
  if (existing) return res.status(409).json({ error: 'Cette configuration existe déjà' });

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

router.patch('/:id', async (req, res) => {
  const { baseUrl, apiKey, extra, isActive } = req.body;
  const data = {};
  if (baseUrl !== undefined) data.baseUrl = baseUrl;
  if (apiKey !== undefined) data.apiKey = apiKey;
  if (extra !== undefined) data.extra = extra;
  if (isActive !== undefined) data.isActive = isActive;

  try {
    const config = await prisma.apiConfig.update({ where: { id: Number(req.params.id) }, data });
    return res.json({ ...config, apiKey: maskKey(config.apiKey) });
  } catch (err) {
    return res.status(404).json({ error: 'Configuration introuvable' });
  }
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
