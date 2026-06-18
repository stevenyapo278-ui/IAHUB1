const prisma = require('../prismaClient');
const { generateEmbedding, toVectorLiteral } = require('../utils/embeddings');

async function searchKnowledge(query, topK = 5) {
  const embedding = await generateEmbedding(query);
  return prisma.$queryRawUnsafe(
    `SELECT c.id, c."documentId", c."chunkIndex", c.content, d.title, d."sourceType",
            1 - (c.embedding <=> $1::vector) AS similarity
     FROM "KnowledgeChunk" c
     JOIN "KnowledgeDocument" d ON d.id = c."documentId"
     WHERE d.status = 'READY'
     ORDER BY c.embedding <=> $1::vector
     LIMIT $2`,
    toVectorLiteral(embedding), topK
  );
}

module.exports = { searchKnowledge };
