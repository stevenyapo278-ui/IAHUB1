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
      const res = await fetch(`${base}/models`, {
        headers: { 'x-goog-api-key': apiKey },
      });
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

// Les API distantes n'exposent pas le type d'un modèle (Gemini renvoie par exemple
// "gemini-embedding-001" sans le distinguer d'un modèle de chat). Sans cette inférence,
// tous les modèles synchronisés arrivent en CHAT : les modèles d'embedding deviennent
// invisibles pour la recherche vectorielle et sont proposés à tort dans les sélecteurs
// de chat, où ils échouent en 404 (pas de /generateContent sur un modèle d'embedding).
function inferModelType(name) {
  const n = String(name || '');
  if (/rerank/i.test(n)) return 'RERANK';
  if (/embed/i.test(n)) return 'EMBEDDING';
  return 'CHAT';
}

// Synchronise les modèles d'un fournisseur : récupère la liste distante et
// ajoute en base les modèles manquants.
// Retourne { added: number } en cas de succès.
// Retourne { error: string } si la synchro n'a pas pu être effectuée.
async function syncProviderModels(providerId) {
  const provider = await prisma.aiProvider.findUnique({
    where: { id: providerId },
    include: {
      models: { select: { name: true } }, // inclut les modèles actifs ET isDeleted: true pour ne pas les ré-ajouter
      keys: { where: { isActive: true }, select: { apiKey: true }, take: 1 },
    },
  });

  if (!provider || provider.isDeleted) return { error: 'Fournisseur introuvable' };
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
    data: newNames.map((name) => ({
      providerId,
      name,
      type: inferModelType(name),
      isActive: true,
      isDefault: false,
      isDeleted: false,
    })),
    skipDuplicates: true,
  });

  return { added: newNames.length };
}

// Synchronise tous les fournisseurs actifs disposant d'au moins une clé active et non supprimés.
async function syncAllProviders() {
  const providers = await prisma.aiProvider.findMany({ where: { isActive: true, isDeleted: false }, select: { id: true } });
  const results = {};
  for (const { id } of providers) {
    results[id] = await syncProviderModels(id);
  }
  return results;
}

// Corrige le type des modèles déjà en base dont le nom indique clairement un usage
// autre que le chat. La synchronisation distante crée tous les modèles en CHAT (les
// API ne exposent pas leur type) : sans ce rattrapage, gemini-embedding-001 reste
// invisible pour la recherche vectorielle et proposé dans les sélecteurs de chat, où
// il échoue en 404. Idempotent — ne touche jamais aux modèles dont le type est déjà
// correct, ni aux modèles supprimés.
async function fixModelTypes() {
  const models = await prisma.aiModel.findMany({
    where: { isDeleted: false, type: 'CHAT' },
    select: { id: true, name: true },
  });
  const toFix = models.filter((m) => inferModelType(m.name) !== 'CHAT');
  if (toFix.length === 0) return { fixed: 0 };

  for (const m of toFix) {
    await prisma.aiModel.update({ where: { id: m.id }, data: { type: inferModelType(m.name) } });
  }
  return { fixed: toFix.length };
}

module.exports = { syncProviderModels, syncAllProviders, inferModelType, fixModelTypes };
