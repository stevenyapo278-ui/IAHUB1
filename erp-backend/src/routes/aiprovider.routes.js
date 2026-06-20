const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate, authorize } = require('../middleware/auth');
const { syncProviderModels } = require('../utils/modelSync');

const router = express.Router();
router.use(authenticate);
router.use(authorize('ADMIN'));

function maskKey(key) {
  if (!key) return null;
  if (key.length <= 4) return '****';
  return `${'*'.repeat(key.length - 4)}${key.slice(-4)}`;
}

function serializeProvider(provider) {
  return {
    ...provider,
    keys: provider.keys?.map((k) => ({ ...k, apiKey: maskKey(k.apiKey) })),
  };
}

// List all providers with their models and keys (masked)
router.get('/', async (req, res) => {
  const providers = await prisma.aiProvider.findMany({
    include: {
      models: { orderBy: { name: 'asc' } },
      keys: { include: { model: { select: { id: true, name: true } } }, orderBy: { label: 'asc' } },
    },
    orderBy: { label: 'asc' },
  });

  return res.json(providers.map(serializeProvider));
});

router.get('/:id', async (req, res) => {
  const provider = await prisma.aiProvider.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      models: { orderBy: { name: 'asc' } },
      keys: { include: { model: { select: { id: true, name: true } } }, orderBy: { label: 'asc' } },
    },
  });
  if (!provider) return res.status(404).json({ error: 'Fournisseur introuvable' });
  return res.json(serializeProvider(provider));
});

// Create provider
router.post('/', [body('name').notEmpty(), body('label').notEmpty()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, label, baseUrl, isActive } = req.body;

  const existing = await prisma.aiProvider.findUnique({ where: { name } });
  if (existing) return res.status(409).json({ error: 'Ce fournisseur existe déjà' });

  const provider = await prisma.aiProvider.create({
    data: { name, label, baseUrl: baseUrl || null, isActive: isActive !== undefined ? isActive : true },
  });

  return res.status(201).json(provider);
});

router.patch('/:id', async (req, res) => {
  const { label, baseUrl, isActive } = req.body;
  const data = {};
  if (label !== undefined) data.label = label;
  if (baseUrl !== undefined) data.baseUrl = baseUrl;
  if (isActive !== undefined) data.isActive = isActive;

  try {
    const provider = await prisma.aiProvider.update({ where: { id: Number(req.params.id) }, data });
    return res.json(provider);
  } catch (err) {
    return res.status(404).json({ error: 'Fournisseur introuvable' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await prisma.aiProvider.delete({ where: { id: Number(req.params.id) } });
    return res.status(204).send();
  } catch (err) {
    return res.status(404).json({ error: 'Fournisseur introuvable' });
  }
});

// Synchronise les modèles disponibles depuis l'API du fournisseur (nécessite une clé active)
router.post('/:id/sync-models', async (req, res) => {
  const providerId = Number(req.params.id);
  const provider = await prisma.aiProvider.findUnique({ where: { id: providerId } });
  if (!provider) return res.status(404).json({ error: 'Fournisseur introuvable' });

  const added = await syncProviderModels(providerId);

  if (added === null) {
    return res.status(422).json({
      error: "Synchronisation impossible : aucune clé API active ou fournisseur non pris en charge",
    });
  }

  return res.json({ added });
});

// --- Models ---

router.post('/:id/models', [body('name').notEmpty()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const providerId = Number(req.params.id);
  const { name, label, type, isDefault, isActive } = req.body;
  const modelType = type === 'EMBEDDING' ? 'EMBEDDING' : 'CHAT';

  const existing = await prisma.aiModel.findUnique({ where: { providerId_name: { providerId, name } } });
  if (existing) return res.status(409).json({ error: 'Ce modèle existe déjà pour ce fournisseur' });

  // "Par défaut" est unique par TYPE (chat / embedding), pas par fournisseur entier — un fournisseur
  // peut avoir un modèle de chat par défaut ET un modèle d'embedding par défaut simultanément.
  if (isDefault) {
    await prisma.aiModel.updateMany({ where: { providerId, type: modelType }, data: { isDefault: false } });
  }

  const model = await prisma.aiModel.create({
    data: {
      providerId,
      name,
      label: label || null,
      type: modelType,
      isDefault: !!isDefault,
      isActive: isActive !== undefined ? isActive : true,
    },
  });

  return res.status(201).json(model);
});

router.patch('/models/:modelId', async (req, res) => {
  const modelId = Number(req.params.modelId);
  const { label, isDefault, isActive } = req.body;

  const model = await prisma.aiModel.findUnique({ where: { id: modelId } });
  if (!model) return res.status(404).json({ error: 'Modèle introuvable' });

  if (isDefault) {
    await prisma.aiModel.updateMany({ where: { providerId: model.providerId, type: model.type }, data: { isDefault: false } });
  }

  const data = {};
  if (label !== undefined) data.label = label;
  if (isDefault !== undefined) data.isDefault = isDefault;
  if (isActive !== undefined) data.isActive = isActive;

  const updated = await prisma.aiModel.update({ where: { id: modelId }, data });
  return res.json(updated);
});

router.delete('/models/:modelId', async (req, res) => {
  try {
    await prisma.aiModel.delete({ where: { id: Number(req.params.modelId) } });
    return res.status(204).send();
  } catch (err) {
    return res.status(404).json({ error: 'Modèle introuvable' });
  }
});

// --- Keys ---

router.post('/:id/keys', [body('label').notEmpty(), body('apiKey').notEmpty()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const providerId = Number(req.params.id);
  const { label, apiKey, modelId, isDefault, isActive } = req.body;

  if (isDefault) {
    await prisma.aiKey.updateMany({
      where: { providerId, modelId: modelId || null },
      data: { isDefault: false },
    });
  }

  const key = await prisma.aiKey.create({
    data: {
      providerId,
      modelId: modelId || null,
      label,
      apiKey,
      isDefault: !!isDefault,
      isActive: isActive !== undefined ? isActive : true,
    },
  });

  return res.status(201).json({ ...key, apiKey: maskKey(key.apiKey) });
});

router.patch('/keys/:keyId', async (req, res) => {
  const keyId = Number(req.params.keyId);
  const { label, apiKey, modelId, isDefault, isActive } = req.body;

  const existingKey = await prisma.aiKey.findUnique({ where: { id: keyId } });
  if (!existingKey) return res.status(404).json({ error: 'Clé introuvable' });

  if (isDefault) {
    await prisma.aiKey.updateMany({
      where: {
        providerId: existingKey.providerId,
        modelId: modelId !== undefined ? (modelId || null) : existingKey.modelId,
      },
      data: { isDefault: false },
    });
  }

  const data = {};
  if (label !== undefined) data.label = label;
  if (apiKey) data.apiKey = apiKey;
  if (modelId !== undefined) data.modelId = modelId || null;
  if (isDefault !== undefined) data.isDefault = isDefault;
  if (isActive !== undefined) data.isActive = isActive;

  const updated = await prisma.aiKey.update({ where: { id: keyId }, data });
  return res.json({ ...updated, apiKey: maskKey(updated.apiKey) });
});

router.delete('/keys/:keyId', async (req, res) => {
  try {
    await prisma.aiKey.delete({ where: { id: Number(req.params.keyId) } });
    return res.status(204).send();
  } catch (err) {
    return res.status(404).json({ error: 'Clé introuvable' });
  }
});

module.exports = router;
