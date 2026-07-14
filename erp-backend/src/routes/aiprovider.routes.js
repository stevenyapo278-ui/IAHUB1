const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { syncProviderModels } = require('../utils/modelSync');

const router = express.Router();
router.use(authenticate);
router.use(requirePermission('settings.ai'));

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

  const result = await syncProviderModels(providerId);

  if (result.error) {
    return res.status(422).json({ error: result.error });
  }

  return res.json({ added: result.added });
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

// ── Test de connectivité d'une clé API ─────────────────────────────────────
// Appelle l'endpoint /models du fournisseur avec la clé réelle (non masquée)
// pour vérifier que la clé est valide et que le fournisseur répond.
router.post('/keys/:keyId/test', async (req, res) => {
  const keyId = Number(req.params.keyId);

  const key = await prisma.aiKey.findUnique({
    where: { id: keyId },
    include: { provider: true },
  });
  if (!key) return res.status(404).json({ ok: false, error: 'Clé introuvable' });

  const provider = key.provider;
  const apiKey = key.apiKey; // valeur réelle (non masquée) en base

  const t0 = Date.now();
  try {
    let modelCount = null;

    switch (provider.name) {
      case 'openai': {
        const r = await fetch(`${provider.baseUrl || 'https://api.openai.com/v1'}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          return res.json({ ok: false, error: body.error?.message || `HTTP ${r.status}` });
        }
        const data = await r.json();
        modelCount = data.data?.length ?? null;
        break;
      }
      case 'mistral': {
        const r = await fetch(`${provider.baseUrl || 'https://api.mistral.ai/v1'}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          return res.json({ ok: false, error: body.message || `HTTP ${r.status}` });
        }
        const data = await r.json();
        modelCount = data.data?.length ?? null;
        break;
      }
      case 'anthropic': {
        const r = await fetch(`${provider.baseUrl || 'https://api.anthropic.com/v1'}/models`, {
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          return res.json({ ok: false, error: body.error?.message || `HTTP ${r.status}` });
        }
        const data = await r.json();
        modelCount = data.data?.length ?? null;
        break;
      }
      case 'gemini': {
        const base = provider.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
        const r = await fetch(`${base}/models?key=${apiKey}`);
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          return res.json({ ok: false, error: body.error?.message || `HTTP ${r.status}` });
        }
        const data = await r.json();
        modelCount = data.models?.length ?? null;
        break;
      }
      default: {
        // Fournisseur générique : tente GET /models avec Authorization Bearer
        const baseUrl = provider.baseUrl;
        if (!baseUrl) {
          return res.json({ ok: false, error: 'URL de base non configurée pour ce fournisseur' });
        }
        const r = await fetch(`${baseUrl}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!r.ok) {
          return res.json({ ok: false, error: `HTTP ${r.status}` });
        }
        break;
      }
    }

    return res.json({ ok: true, latencyMs: Date.now() - t0, modelCount });
  } catch (err) {
    return res.json({ ok: false, error: err.message });
  }
});

// ── Test de connectivité d'un modèle IA ─────────────────────────────────────
// Appelle l'API du fournisseur pour tester le modèle spécifique
router.post('/models/:modelId/test', async (req, res) => {
  const modelId = Number(req.params.modelId);

  try {
    const model = await prisma.aiModel.findUnique({
      where: { id: modelId },
      include: { provider: true },
    });
    if (!model) return res.status(404).json({ ok: false, error: 'Modèle introuvable' });

    const provider = model.provider;

    // Trouver une clé active pour ce fournisseur
    // 1. Clé spécifiquement liée à ce modèle
    // 2. Clé par défaut (sans modèle spécifique)
    // 3. N'importe quelle clé active du fournisseur
    const activeKeys = await prisma.aiKey.findMany({
      where: { providerId: provider.id, isActive: true },
      orderBy: [
        { isDefault: 'desc' },
        { id: 'asc' }
      ]
    });

    const key = activeKeys.find(k => k.modelId === model.id) ||
                activeKeys.find(k => !k.modelId) ||
                activeKeys[0];

    if (!key) {
      return res.status(400).json({ ok: false, error: 'Aucune clé API active configurée pour ce fournisseur' });
    }

    const apiKey = key.apiKey;
    const t0 = Date.now();

    switch (provider.name) {
      case 'openai':
      case 'mistral':
      case 'nvidia': {
        const baseUrl = provider.baseUrl || (
          provider.name === 'openai' ? 'https://api.openai.com/v1' :
          provider.name === 'mistral' ? 'https://api.mistral.ai/v1' :
          provider.name === 'nvidia' ? 'https://integrate.api.nvidia.com/v1' : ''
        );
        const r = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: model.name,
            messages: [{ role: 'user', content: 'Ping' }],
            max_tokens: 5,
            temperature: 0.1,
          }),
        });

        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          const errDetail = body.error?.message || body.message || `HTTP ${r.status}`;
          return res.json({ ok: false, error: errDetail });
        }
        break;
      }
      case 'anthropic': {
        const baseUrl = provider.baseUrl || 'https://api.anthropic.com';
        const r = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: model.name,
            messages: [{ role: 'user', content: 'Ping' }],
            max_tokens: 5,
          }),
        });

        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          const errDetail = body.error?.message || body.message || `HTTP ${r.status}`;
          return res.json({ ok: false, error: errDetail });
        }
        break;
      }
      case 'gemini': {
        const base = provider.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
        const r = await fetch(`${base}/models/${model.name}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Ping' }] }],
            generationConfig: { maxOutputTokens: 5, temperature: 0.1 },
          }),
        });

        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          const errDetail = body.error?.message || body.message || `HTTP ${r.status}`;
          return res.json({ ok: false, error: errDetail });
        }
        break;
      }
      default: {
        // Fournisseur générique : tente chat/completions compatible OpenAI
        const baseUrl = provider.baseUrl;
        if (!baseUrl) {
          return res.json({ ok: false, error: 'URL de base non configurée pour ce fournisseur' });
        }
        const r = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: model.name,
            messages: [{ role: 'user', content: 'Ping' }],
            max_tokens: 5,
          }),
        });

        if (!r.ok) {
          return res.json({ ok: false, error: `HTTP ${r.status}` });
        }
        break;
      }
    }

    return res.json({ ok: true, latencyMs: Date.now() - t0 });
  } catch (err) {
    return res.json({ ok: false, error: err.message });
  }
});

module.exports = router;
