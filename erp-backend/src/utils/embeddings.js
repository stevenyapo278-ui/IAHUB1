const prisma = require('../prismaClient');
const crypto = require('crypto');
const cacheStore = require('../services/cacheStore');
const { trackAiUsage } = require('../services/aiUsageTracker');

// Colonne pgvector figée à 768 dimensions (cf. prisma/schema.prisma — choisi pour matcher
// Gemini text-embedding-004 qui produit nativement 768 dimensions) — chaque candidat
// d'embeddings essayé ci-dessous doit produire un vecteur de cette taille, sinon il est écarté
// et le candidat suivant est tenté (load balancing par compatibilité, pas seulement par priorité).
const EMBEDDING_DIMENSIONS = 768;

// Cache des embeddings : même texte = même vecteur, pas d'appel API redondant
const EMBEDDING_CACHE_PREFIX = 'embeddings:';
const EMBEDDING_CACHE_TTL = 3600; // 1 heure
const EMBEDDING_CACHE_MAX = 2000; // ≈ 2000 × 768 × 8 bytes ≈ 12 MB

// Anthropic n'a pas d'API d'embeddings — toujours ignoré pour cet usage, même actif/avec clé.
const PROVIDERS_WITHOUT_EMBEDDINGS = new Set(['anthropic']);

// Modèle d'embedding par défaut si aucun modèle de type EMBEDDING n'est explicitement configuré
// pour ce fournisseur (l'utilisateur peut en configurer un dédié depuis Paramètres > IA).
const DEFAULT_EMBEDDING_MODEL = {
  gemini: 'gemini-embedding-001',
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
    where: { isActive: true, isDeleted: false },
    include: {
      keys: { where: { isActive: true }, orderBy: { isDefault: 'desc' } },
      models: { where: { isActive: true, isDeleted: false, type: 'EMBEDDING' }, orderBy: { isDefault: 'desc' } },
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
  // taskType optimise le vecteur selon l'usage (RETRIEVAL_DOCUMENT / RETRIEVAL_QUERY).
  // NB : ces champs doivent rester au TOP LEVEL — l'objet "embedContentConfig" est
  // accepté mais ignoré silencieusement par l'API, ce qui renvoie 3072 dimensions.
  const body = {
    model: `models/${config.model}`,
    content: { parts: [{ text }] },
    outputDimensionality: EMBEDDING_DIMENSIONS,
  };
  if (config.taskType) body.taskType = config.taskType;
  const start = Date.now();
  const res = await fetch(`${baseUrl}/models/${config.model}:embedContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try { const err = await res.json(); detail = err?.error?.message || JSON.stringify(err); } catch {}
    throw new Error(`Gemini ${res.status} : ${detail || res.statusText} (vérifiez la clé API et l'activation de l'API Embedding dans Google AI Studio)`);
  }
  const data = await res.json();
  // Suivi de consommation : Gemini renvoie usageMetadata.totalTokenCount.
  const totalTokens = data.usageMetadata?.totalTokenCount || 0;
  if (totalTokens > 0) {
    trackAiUsage(
      { promptTokens: totalTokens, completionTokens: 0, totalTokens },
      'gemini',
      'embedding',
      { model: config.model, durationMs: Date.now() - start, source: 'embeddings' }
    ).catch(() => {});
  }
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

  const start = Date.now();
  const res = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Échec de la génération d'embedding ${config.providerName} (${res.status})`);
  const data = await res.json();
  // Suivi de consommation : OpenAI-compatible renvoie usage.prompt_tokens.
  const promptTokens = data.usage?.prompt_tokens || 0;
  if (promptTokens > 0) {
    trackAiUsage(
      { promptTokens, completionTokens: 0, totalTokens: promptTokens },
      config.providerName,
      'embedding',
      { model: config.model, durationMs: Date.now() - start, source: 'embeddings' }
    ).catch(() => {});
  }
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

// Génère une clé de cache à partir du texte (hash SHA-256, normalisé) ET de la portée
// du modèle (fournisseur/modèle/taskType). Sans cette portée, un changement de modèle
// resservait l'ancien vecteur pendant tout le TTL du cache — deux modèles vivant dans
// des espaces de vecteurs incompatibles produisent alors des scores cosinus faux.
function cacheKey(text, scope) {
  const normalized = (text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const digest = crypto.createHash('sha256').update(normalized).digest('hex');
  return `${EMBEDDING_CACHE_PREFIX}${scope}:${digest}`;
}

// Génère l'embedding (vecteur de 768 dimensions) d'un texte en essayant TOUS les fournisseurs/
// modèles actifs disponibles dans l'ordre, et en gardant le premier qui produit un vecteur
// compatible — load balancing par compatibilité : un fournisseur incompatible (mauvaise taille,
// clé invalide, quota dépassé) ne bloque pas la génération si un autre fournisseur actif convient.
//
// taskType : 'RETRIEVAL_DOCUMENT' par défaut (contenu indexé), 'RETRIEVAL_QUERY' pour une
// requête de recherche — le même texte produit des vecteurs différents selon le taskType.
async function generateEmbedding(text, taskType = 'RETRIEVAL_DOCUMENT') {
  const candidates = await listEmbeddingCandidates();
  if (candidates.length === 0) {
    throw new Error('Aucun fournisseur IA actif ne supporte la génération d\'embeddings (configurez une clé pour Gemini, OpenAI, NVIDIA ou Mistral)');
  }

  // Lecture sous la portée du candidat nominal, écriture sous celle du candidat gagnant.
  // En pratique il n'y a qu'un seul fournisseur d'embedding configuré (les deux coïncident) ;
  // si un repli l'emporte, on a simplement un cache miss au lieu d'un vecteur périmé.
  const nominal = candidates[0];
  const readKey = cacheKey(text, `${nominal.providerName}/${nominal.model}:${taskType}`);
  const cached = cacheStore.get(readKey);
  if (cached) return cached;

  const failures = [];
  for (const config of candidates) {
    try {
      const vector = await essaiEmbedding({ ...config, taskType }, text);
      // Mettre en cache le résultat
      cacheStore.set(cacheKey(text, `${config.providerName}/${config.model}:${taskType}`), vector, EMBEDDING_CACHE_TTL, { maxEntries: EMBEDDING_CACHE_MAX });
      return vector;
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
