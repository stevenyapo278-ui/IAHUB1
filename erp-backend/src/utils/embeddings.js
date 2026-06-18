const prisma = require('../prismaClient');

const EMBEDDING_DIMENSIONS = 768;

// Récupère la clé API par défaut pour Gemini, utilisée pour générer les embeddings
// (text-embedding-004 produit des vecteurs de 768 dimensions).
async function getEmbeddingProvider() {
  const provider = await prisma.aiProvider.findUnique({
    where: { name: 'gemini' },
    include: { keys: { where: { isActive: true } } },
  });
  if (!provider || !provider.isActive) return null;
  const key = provider.keys.find((k) => k.isDefault) || provider.keys[0];
  if (!key) return null;
  return { baseUrl: provider.baseUrl || 'https://generativelanguage.googleapis.com/v1beta', apiKey: key.apiKey };
}

// Génère l'embedding (vecteur de 768 dimensions) d'un texte via l'API Gemini.
async function generateEmbedding(text) {
  const config = await getEmbeddingProvider();
  if (!config) throw new Error('Aucun fournisseur IA configuré pour générer les embeddings (Gemini requis)');

  const res = await fetch(`${config.baseUrl}/models/text-embedding-004:embedContent?key=${config.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/text-embedding-004',
      content: { parts: [{ text }] },
    }),
  });

  if (!res.ok) throw new Error(`Échec de la génération d'embedding (${res.status})`);
  const data = await res.json();
  return data.embedding.values;
}

// Formate un vecteur JS en littéral pgvector pour les requêtes SQL brutes : '[0.1,0.2,...]'
function toVectorLiteral(vector) {
  return `[${vector.join(',')}]`;
}

module.exports = { EMBEDDING_DIMENSIONS, generateEmbedding, toVectorLiteral, getEmbeddingProvider };
