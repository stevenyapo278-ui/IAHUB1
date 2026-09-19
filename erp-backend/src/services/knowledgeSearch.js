const prisma = require('../prismaClient');
const { generateEmbedding, toVectorLiteral } = require('../utils/embeddings');
const { rerank, listRerankCandidates } = require('../utils/reranking');

/**
 * Recherche hybride unifiée : combine similarité sémantique (vector) + recherche par mots-clés
 * (full-text PostgreSQL) + reranking optionnel. Utilisée par le chatbot, le follow-up reply
 * generator, et la route /api/knowledge/search.
 *
 * @param {string} query - Requête de recherche
 * @param {object} options
 * @param {number} options.topK - Nombre de résultats souhaités (défaut: 5)
 * @param {boolean} options.useHybrid - Activer la recherche hybride (défaut: true)
 * @param {string} options.category - Filtre par catégorie (optionnel)
 * @param {string[]} options.tags - Filtre par tags (optionnel)
 * @param {boolean} options.applyReranking - Appliquer le reranking si disponible (défaut: true)
 * @returns {Promise<Array>} Résultats avec similarity, text_rank, combined_score
 */
async function searchKnowledge(query, options = {}) {
  const {
    topK = 5,
    useHybrid = true,
    category = null,
    tags = null,
    applyReranking = true,
  } = typeof options === 'number' ? { topK: options } : options;

  if (!query || !query.trim()) return [];

  const embedding = await generateEmbedding(query);

  // Si un Reranker est actif, récupérer plus de candidats pour le tri secondaire
  const rerankCandidates = await listRerankCandidates();
  const hasActiveReranker = applyReranking && rerankCandidates.length > 0;
  const dbLimit = hasActiveReranker ? Math.max(30, topK * 3) : Math.min(topK, 20);

  // Construire les filtres metadata
  const metadataFilters = [];
  const filterParams = [];
  let paramIndex = 3;

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

  const whereClause = metadataFilters.length > 0
    ? `WHERE d.status = 'READY' AND ${metadataFilters.join(' AND ')}`
    : `WHERE d.status = 'READY'`;

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

  // Reranking si disponible
  let finalResults = results;
  if (hasActiveReranker) {
    const reranked = await rerank(query, results);
    finalResults = reranked.slice(0, topK);
  }

  return finalResults;
}

module.exports = { searchKnowledge };
