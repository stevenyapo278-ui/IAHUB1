const prisma = require('../prismaClient');

// Colonne pgvector figée à 1024 dimensions (cf. prisma/schema.prisma — choisi pour matcher les
// modèles d'embedding NVIDIA NIM disponibles en l'absence de clé Gemini/OpenAI) — chaque candidat
// d'embeddings essayé ci-dessous doit produire un vecteur de cette taille, sinon il est écarté
// et le candidat suivant est tenté (load balancing par compatibilité, pas seulement par priorité).
const EMBEDDING_DIMENSIONS = 1024;

// Anthropic n'a pas d'API d'embeddings — toujours ignoré pour cet usage, même actif/avec clé.
const PROVIDERS_WITHOUT_EMBEDDINGS = new Set(['anthropic']);

// Modèle d'embedding par défaut si aucun modèle de type EMBEDDING n'est explicitement configuré
// pour ce fournisseur (l'utilisateur peut en configurer un dédié depuis Paramètres > IA).
const DEFAULT_EMBEDDING_MODEL = {
  gemini: 'text-embedding-004',
  openai: 'text-embedding-3-small',
  nvidia: 'nvidia/nv-embedqa-e5-v5',
  mistral: 'mistral-embed',
};

// Construit la liste de TOUS les candidats essayables (fournisseur actif + clé active + modèle
// d'embedding), dans l'ordre : fournisseurs marqués isDefault d'abord, puis alphabétique — pour
// que generateEmbedding() puisse parcourir la liste entière au lieu de s'arrêter au premier
// fournisseur trouvé, même s'il s'avère incompatible (mauvaise taille de vecteur, modèle absent...).
async function listEmbeddingCandidates() {
  const providers = await prisma.aiProvider.findMany({
    where: { isActive: true },
    include: {
      keys: { where: { isActive: true }, orderBy: { isDefault: 'desc' } },
      models: { where: { isActive: true, type: 'EMBEDDING' }, orderBy: { isDefault: 'desc' } },
    },
    orderBy: { label: 'asc' },
  });

  const candidates = [];
  for (const provider of providers) {
    if (PROVIDERS_WITHOUT_EMBEDDINGS.has(provider.name)) continue;
    if (provider.keys.length === 0) continue;

    const key = provider.keys[0];
    const models = provider.models.length > 0
      ? provider.models.map((m) => m.name)
      : (DEFAULT_EMBEDDING_MODEL[provider.name] ? [DEFAULT_EMBEDDING_MODEL[provider.name]] : []);

    for (const model of models) {
      candidates.push({ providerName: provider.name, baseUrl: provider.baseUrl, apiKey: key.apiKey, model });
    }
  }
  return candidates;
}

// Conservé pour compatibilité (utilisé par d'anciens appelants éventuels) : renvoie juste le
// premier candidat, sans garantie de compatibilité réelle — préférer generateEmbedding() qui
// parcourt tous les candidats jusqu'à en trouver un qui fonctionne.
async function getEmbeddingProvider() {
  const candidates = await listEmbeddingCandidates();
  return candidates[0] || null;
}

async function embedWithGemini(config, text) {
  const baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  const res = await fetch(`${baseUrl}/models/${config.model}:embedContent?key=${config.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: `models/${config.model}`, content: { parts: [{ text }] } }),
  });
  if (!res.ok) throw new Error(`Échec de la génération d'embedding Gemini (${res.status})`);
  const data = await res.json();
  return data.embedding.values;
}

// Format OpenAI-compatible (OpenAI, NVIDIA NIM, Mistral) : POST /embeddings, { data: [{ embedding }] }.
// "dimensions" force la taille du vecteur quand l'API le supporte (OpenAI text-embedding-3-*) ;
// NVIDIA NIM rejette ce paramètre (400) et impose "input_type" à la place — la taille native du
// vecteur est vérifiée après coup par essaiEmbedding() plutôt que forcée à la requête.
async function embedWithOpenAICompat(config, text) {
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  const body = { model: config.model, input: text };
  if (config.providerName === 'openai') body.dimensions = EMBEDDING_DIMENSIONS;
  if (config.providerName === 'nvidia') body.input_type = 'query';

  const res = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Échec de la génération d'embedding ${config.providerName} (${res.status})`);
  const data = await res.json();
  return data.data?.[0]?.embedding;
}

async function essaiEmbedding(config, text) {
  const vector = config.providerName === 'gemini'
    ? await embedWithGemini(config, text)
    : await embedWithOpenAICompat(config, text);

  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `vecteur de ${vector?.length ?? 0} dimensions, ${EMBEDDING_DIMENSIONS} attendues`
    );
  }
  return vector;
}

// Génère l'embedding (vecteur de 1024 dimensions) d'un texte en essayant TOUS les fournisseurs/
// modèles actifs disponibles dans l'ordre, et en gardant le premier qui produit un vecteur
// compatible — load balancing par compatibilité : un fournisseur incompatible (mauvaise taille,
// clé invalide, quota dépassé) ne bloque pas la génération si un autre fournisseur actif convient.
async function generateEmbedding(text) {
  const candidates = await listEmbeddingCandidates();
  if (candidates.length === 0) {
    throw new Error('Aucun fournisseur IA actif ne supporte la génération d\'embeddings (configurez une clé pour Gemini, OpenAI, NVIDIA ou Mistral)');
  }

  const failures = [];
  for (const config of candidates) {
    try {
      return await essaiEmbedding(config, text);
    } catch (err) {
      failures.push(`${config.providerName}/${config.model} : ${err.message}`);
    }
  }

  throw new Error(
    `Aucun fournisseur/modèle d'embedding actif n'a produit un vecteur compatible (${EMBEDDING_DIMENSIONS} dimensions requises). ` +
    `Détails : ${failures.join(' | ')}`
  );
}

// Formate un vecteur JS en littéral pgvector pour les requêtes SQL brutes : '[0.1,0.2,...]'
function toVectorLiteral(vector) {
  return `[${vector.join(',')}]`;
}

module.exports = { EMBEDDING_DIMENSIONS, generateEmbedding, toVectorLiteral, getEmbeddingProvider, listEmbeddingCandidates };
