const prisma = require('../prismaClient');

// Récupère la liste des identifiants de modèles disponibles pour un fournisseur,
// en utilisant l'une de ses clés API actives.
// Retourne un tableau de noms, ou null si le fournisseur n'est pas pris en charge.
// Lance une erreur avec le message de l'API distante en cas d'échec.
async function fetchRemoteModelNames(provider, apiKey) {
  switch (provider.name) {
    case 'openai': {
      const res = await fetch(`${provider.baseUrl || 'https://api.openai.com/v1'}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      return data.data.map((m) => m.id);
    }
    case 'mistral': {
      const res = await fetch(`${provider.baseUrl || 'https://api.mistral.ai/v1'}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      return data.data.map((m) => m.id);
    }
    case 'anthropic': {
      const res = await fetch(`${provider.baseUrl || 'https://api.anthropic.com/v1'}/models`, {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      return data.data.map((m) => m.id);
    }
    case 'gemini': {
      const base = provider.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
      const res = await fetch(`${base}/models?key=${apiKey}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      return (data.models || []).map((m) => m.name.replace(/^models\//, ''));
    }
    case 'nvidia': {
      const res = await fetch(`${provider.baseUrl || 'https://integrate.api.nvidia.com/v1'}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      return data.data.map((m) => m.id);
    }
    default:
      // Fournisseur sans endpoint "list models" connu -> ignoré
      return null;
  }
}

// Synchronise les modèles d'un fournisseur : récupère la liste distante et
// ajoute en base les modèles manquants.
// Retourne { added: number } en cas de succès.
// Retourne { error: string } si la synchro n'a pas pu être effectuée.
async function syncProviderModels(providerId) {
  const provider = await prisma.aiProvider.findUnique({
    where: { id: providerId },
    include: {
      models: { select: { name: true } },
      keys: { where: { isActive: true }, select: { apiKey: true }, take: 1 },
    },
  });

  if (!provider) return { error: 'Fournisseur introuvable' };
  if (!provider.isActive) return { error: 'Fournisseur désactivé' };
  if (provider.keys.length === 0) return { error: 'Aucune clé API active configurée pour ce fournisseur' };

  let remoteNames;
  try {
    remoteNames = await fetchRemoteModelNames(provider, provider.keys[0].apiKey);
  } catch (err) {
    return { error: err.message };
  }
  if (!remoteNames) return { error: 'Fournisseur non pris en charge pour la synchronisation automatique' };

  const existingNames = new Set(provider.models.map((m) => m.name));
  const newNames = remoteNames.filter((name) => !existingNames.has(name));

  if (newNames.length === 0) return { added: 0 };

  await prisma.aiModel.createMany({
    data: newNames.map((name) => ({ providerId, name, isActive: true, isDefault: false })),
    skipDuplicates: true,
  });

  return { added: newNames.length };
}

// Synchronise tous les fournisseurs actifs disposant d'au moins une clé active.
async function syncAllProviders() {
  const providers = await prisma.aiProvider.findMany({ where: { isActive: true }, select: { id: true } });
  const results = {};
  for (const { id } of providers) {
    results[id] = await syncProviderModels(id);
  }
  return results;
}

module.exports = { syncProviderModels, syncAllProviders };
