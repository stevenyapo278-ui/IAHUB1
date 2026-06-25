const express = require('express');
const multer = require('multer');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { extractText } = require('../utils/documentExtract');
const { chunkText } = require('../utils/chunking');
const { generateEmbedding, toVectorLiteral } = require('../utils/embeddings');
const { rerank, listRerankCandidates } = require('../utils/reranking');

const router = express.Router();
const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } }); // 20 Mo max

router.use(authenticate);

// Liste des documents de la base de connaissances (avec filtres)
router.get('/documents', async (req, res) => {
  const { category, tag, status } = req.query;
  const where = {};
  if (status) where.status = status;
  if (category) where.category = category;
  if (tag) where.tags = { has: tag };
  const documents = await prisma.knowledgeDocument.findMany({
    where,
    include: { _count: { select: { chunks: true, feedbacks: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return res.json(documents);
});

// Upload d'un document (PDF, DOCX, Markdown) : extraction, découpage et indexation pgvector
router.post('/documents', requirePermission('knowledge.manage', ['ADMIN', 'TECHNICIAN']), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier requis' });

  const ext = (req.file.originalname.split('.').pop() || '').toLowerCase();
  const sourceType = ext === 'pdf' ? 'pdf' : ext === 'docx' ? 'docx' : 'markdown';

  // Parse metadata from request body
  const { category, tags, author } = req.body;
  const parsedTags = tags ? (Array.isArray(tags) ? tags : JSON.parse(tags)) : [];

  const document = await prisma.knowledgeDocument.create({
    data: {
      title: req.body.title || req.file.originalname,
      sourceType,
      filename: req.file.originalname,
      status: 'PROCESSING',
      category,
      tags: parsedTags,
      author,
    },
  });

  try {
    const text = await extractText(req.file.buffer, req.file.mimetype, req.file.originalname);
    const chunks = chunkText(text);

    if (chunks.length === 0) {
      await prisma.knowledgeDocument.update({
        where: { id: document.id },
        data: { status: 'ERROR', error: 'Aucun contenu exploitable dans le document' },
      });
      return res.status(422).json({ error: 'Aucun contenu exploitable dans le document' });
    }

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await generateEmbedding(chunks[i]);
      await prisma.$executeRawUnsafe(
        `INSERT INTO "KnowledgeChunk" (id, "documentId", "chunkIndex", content, embedding, "createdAt")
         VALUES (DEFAULT, $1, $2, $3, $4::vector, now())`,
        document.id,
        i,
        chunks[i],
        toVectorLiteral(embedding)
      );
    }

    const updated = await prisma.knowledgeDocument.update({
      where: { id: document.id },
      data: { status: 'READY' },
      include: { _count: { select: { chunks: true } } },
    });

    return res.status(201).json(updated);
  } catch (err) {
    await prisma.knowledgeDocument.update({
      where: { id: document.id },
      data: { status: 'ERROR', error: err.message || 'Erreur lors du traitement du document' },
    });
    return res.status(502).json({ error: err.message || 'Erreur lors du traitement du document' });
  }
});

// Remplace le fichier source d'un document existant : ré-extrait, ré-découpe et ré-indexe les
// fragments/embeddings sur le MÊME document (conserve son id, sa position dans la liste, son
// historique), au lieu de supprimer puis recréer une nouvelle ligne.
router.put('/documents/:id/replace', requirePermission('knowledge.manage', ['ADMIN', 'TECHNICIAN']), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier requis' });

  const document = await prisma.knowledgeDocument.findUnique({ where: { id: Number(req.params.id) } });
  if (!document) return res.status(404).json({ error: 'Document introuvable' });

  const ext = (req.file.originalname.split('.').pop() || '').toLowerCase();
  const sourceType = ext === 'pdf' ? 'pdf' : ext === 'docx' ? 'docx' : 'markdown';

  await prisma.knowledgeDocument.update({
    where: { id: document.id },
    data: {
      sourceType,
      filename: req.file.originalname,
      title: req.body.title || document.title,
      status: 'PROCESSING',
      error: null,
    },
  });

  try {
    const text = await extractText(req.file.buffer, req.file.mimetype, req.file.originalname);
    const chunks = chunkText(text);

    if (chunks.length === 0) {
      await prisma.knowledgeDocument.update({
        where: { id: document.id },
        data: { status: 'ERROR', error: 'Aucun contenu exploitable dans le document' },
      });
      return res.status(422).json({ error: 'Aucun contenu exploitable dans le document' });
    }

    // Supprime les anciens fragments avant de réindexer — évite de mélanger l'ancien et le
    // nouveau contenu dans la recherche sémantique le temps de la réindexation.
    await prisma.knowledgeChunk.deleteMany({ where: { documentId: document.id } });

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await generateEmbedding(chunks[i]);
      await prisma.$executeRawUnsafe(
        `INSERT INTO "KnowledgeChunk" (id, "documentId", "chunkIndex", content, embedding, "createdAt")
         VALUES (DEFAULT, $1, $2, $3, $4::vector, now())`,
        document.id,
        i,
        chunks[i],
        toVectorLiteral(embedding)
      );
    }

    const updated = await prisma.knowledgeDocument.update({
      where: { id: document.id },
      data: { status: 'READY' },
      include: { _count: { select: { chunks: true } } },
    });

    return res.json(updated);
  } catch (err) {
    await prisma.knowledgeDocument.update({
      where: { id: document.id },
      data: { status: 'ERROR', error: err.message || 'Erreur lors du traitement du document' },
    });
    return res.status(502).json({ error: err.message || 'Erreur lors du traitement du document' });
  }
});

// Supprime un document et ses chunks (cascade)
router.delete('/documents/:id', requirePermission('knowledge.manage', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  try {
    await prisma.knowledgeDocument.delete({ where: { id: Number(req.params.id) } });
    return res.status(204).send();
  } catch (err) {
    return res.status(404).json({ error: 'Document introuvable' });
  }
});

// Recherche hybride : combine similarité sémantique + recherche par mots-clés + filtres
router.post('/search', async (req, res) => {
  const { query, limit, category, tags, useHybrid = true } = req.body;
  if (!query) return res.status(400).json({ error: 'query est requis' });

  try {
    const embedding = await generateEmbedding(query);
    const userLimit = Number(limit) || 5;

    // Si un Reranker est actif, on récupère plus de candidats pour l'étape de tri secondaire
    const rerankCandidates = await listRerankCandidates();
    const hasActiveReranker = rerankCandidates.length > 0;
    const dbLimit = hasActiveReranker ? Math.max(30, userLimit * 3) : Math.min(userLimit, 20);

    // Build where clause for metadata filters
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

    // Hybrid search: combine vector similarity with full-text search (if enabled)
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

    let finalResults = results;
    if (hasActiveReranker) {
      const reranked = await rerank(query, results);
      finalResults = reranked.slice(0, userLimit);
    }

    return res.json(finalResults);
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Erreur lors de la recherche' });
  }
});

// Ajouter un feedback sur un résultat de recherche
router.post('/feedback', async (req, res) => {
  const { documentId, chunkId, query, rating, comment, userEmail } = req.body;
  if (!documentId || !query || !rating) {
    return res.status(400).json({ error: 'documentId, query et rating sont requis' });
  }

  try {
    const feedback = await prisma.knowledgeFeedback.create({
      data: {
        documentId,
        chunkId,
        query,
        rating,
        comment,
        userEmail,
      },
    });
    return res.status(201).json(feedback);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erreur lors de l\'enregistrement du feedback' });
  }
});

// Obtenir les feedbacks pour un document
router.get('/documents/:id/feedbacks', async (req, res) => {
  const { id } = req.params;
  try {
    const feedbacks = await prisma.knowledgeFeedback.findMany({
      where: { documentId: Number(id) },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(feedbacks);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erreur lors de la récupération des feedbacks' });
  }
});

module.exports = router;
