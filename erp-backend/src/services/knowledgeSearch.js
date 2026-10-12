const prisma = require('../prismaClient');
const { generateEmbedding, toVectorLiteral } = require('../utils/embeddings');
const { rerank, listRerankCandidates } = require('../utils/reranking');

/**
 * Recherche hybride unifiée : combine similarité sémantique (vector) + recherche par mots-clés
 * (full-text PostgreSQL) + reranking optionnel. Utilisée par le chatbot, le follow-up reply
 * generator, et la route /api/knowledge/search.
 *
 * Le pipeline (seuil absolu + coupe relative + rerank) est le même que celui de
 * searchEmailRag : sans seuil, un corpus hors-sujet renvoyait ses pires chunks au
 * modèle, qui les présentait alors comme des documentation pertinente.
 *
 * @param {string} query - Requête de recherche
 * @param {object} options
 * @param {number} options.topK - Nombre de résultats souhaités (défaut: 5)
 * @param {boolean} options.useHybrid - Activer la recherche hybride (défaut: true)
 * @param {string} options.category - Filtre par catégorie (optionnel)
 * @param {string[]} options.tags - Filtre par tags (optionnel)
 * @param {boolean} options.applyReranking - Appliquer le reranking si disponible (défaut: true)
 * @param {number} options.minScore - Plancher absolu sur combined_score (défaut: 0.12)
 * @param {number} options.relativeFloor - Garde les résultats ≥ ce % du meilleur score (défaut: 0.3)
 * @returns {Promise<Array>} Résultats avec similarity, text_rank, combined_score
 */
async function searchKnowledge(query, options = {}) {
  const {
    topK = 5,
    useHybrid = true,
    category = null,
    tags = null,
    applyReranking = true,
    minScore = 0.12,
    relativeFloor = 0.3,
  } = typeof options === 'number' ? { topK: options } : options;

  if (!query || !query.trim()) return [];

  const embedding = await generateEmbedding(query, 'RETRIEVAL_QUERY');

  // Si un Reranker est actif, récupérer plus de candidats pour le tri secondaire.
  // Dans tous les cas on tire PLUS que topK : la coupe relative a besoin d'une queue
  // longue à écarter, sinon elle n'a rien à filtrer.
  const rerankCandidates = await listRerankCandidates();
  const hasActiveReranker = applyReranking && rerankCandidates.length > 0;
  const dbLimit = hasActiveReranker ? Math.max(30, topK * 3) : Math.max(topK * 4, 20);

  // Construire les filtres metadata.
  // ⚠️ L'index du premier paramètre de filtre dépend de la requête : en hybride les
  // positions sont $1= vecteur, $2 = requête, $3 = LIMIT ; en pur vecteur $1 = vecteur,
  // $2 = LIMIT. Démarrer à 3 en mode hybride faisait comparer d.category à la LIMIT —
  // le filtre catégorie ne retournait alors JAMAIS rien.
  const metadataFilters = [];
  const filterParams = [];
  let paramIndex = useHybrid ? 4 : 3;

  if (category) {
    metadataFilters.push(`d.category = $${paramIndex}`);
    filterParams.push(category);
    paramIndex++;
  }

  if (tags && tags.length > 0) {
    metadataFilters.push(`d.tags && $${paramIndex}`);
    filterParams.push(tags);
    paramIndex++;
  }

  let whereClause = metadataFilters.length > 0
    ? `WHERE d.status = 'READY' AND ${metadataFilters.join(' AND ')}`
    : `WHERE d.status = 'READY'`;

  // Plancher absolu appliqué côté SQL (seulement utile en hybride : en pur vecteur
  // la similarité seule est déjà bornée et la coupe relative suffit).
  if (useHybrid && minScore > 0) {
    whereClause += ` AND (0.7 * (1 - (c.embedding <=> $1::vector)) + 0.3 * ts_rank(to_tsvector('french', c.content), plainto_tsquery('french', $2))) >= ${Number(minScore)}`;
  }

  // Recherche hybride ou pure vectorielle
  let results;
  if (useHybrid) {
    results = await prisma.$queryRawUnsafe(
      `SELECT c.id, c."documentId", c."chunkIndex", c.content, d.title, d."sourceType", d.category, d.tags,
              1 - (c.embedding <=> $1::vector) AS similarity,
              ts_rank(to_tsvector('french', c.content), plainto_tsquery('french', $2)) AS text_rank,
              (0.7 * (1 - (c.embedding <=> $1::vector)) + 0.3 * ts_rank(to_tsvector('french', c.content), plainto_tsquery('french', $2))) AS combined_score
       FROM "KnowledgeChunk" c
       JOIN "KnowledgeDocument" d ON d.id = c."documentId"
       ${whereClause}
       ORDER BY combined_score DESC
       LIMIT $3`,
      toVectorLiteral(embedding),
      query,
      dbLimit,
      ...filterParams
    );
  } else {
    results = await prisma.$queryRawUnsafe(
      `SELECT c.id, c."documentId", c."chunkIndex", c.content, d.title, d."sourceType", d.category, d.tags,
              1 - (c.embedding <=> $1::vector) AS similarity,
              0 AS text_rank,
              (1 - (c.embedding <=> $1::vector)) AS combined_score
       FROM "KnowledgeChunk" c
       JOIN "KnowledgeDocument" d ON d.id = c."documentId"
       ${whereClause}
       ORDER BY combined_score DESC
       LIMIT $2`,
      toVectorLiteral(embedding),
      dbLimit,
      ...filterParams
    );
  }

  // Coupe relative : supprime la queue longue de résultats faibles tout en gardant
  // le(s) meilleur(s) — la distribution des scores varie selon le modèle d'embedding.
  let finalResults = results;
  if (results.length > 1 && relativeFloor > 0) {
    const best = Math.max(...results.map((r) => Number(r.combined_score) || 0));
    if (best > 0) {
      const cut = best * relativeFloor;
      const kept = results.filter((r) => (Number(r.combined_score) || 0) >= cut);
      finalResults = kept.length > 0 ? kept : results.slice(0, 1);
    }
  }

  // Reranking si disponible
  if (hasActiveReranker && finalResults.length > 0) {
    try {
      const reranked = await rerank(query, finalResults);
      finalResults = reranked.slice(0, topK);
    } catch {
      finalResults = finalResults.slice(0, topK);
    }
  } else {
    finalResults = finalResults.slice(0, topK);
  }

  return finalResults;
}

module.exports = { searchKnowledge };
