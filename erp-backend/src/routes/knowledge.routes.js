const express = require('express');
const multer = require('multer');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { extractText } = require('../utils/documentExtract');
const { chunkText } = require('../utils/chunking');
const { generateEmbedding, toVectorLiteral } = require('../utils/embeddings');

const router = express.Router();
const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } }); // 20 Mo max

router.use(authenticate);

// Liste des documents de la base de connaissances
router.get('/documents', async (req, res) => {
  const documents = await prisma.knowledgeDocument.findMany({
    include: { _count: { select: { chunks: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return res.json(documents);
});

// Upload d'un document (PDF, DOCX, Markdown) : extraction, découpage et indexation pgvector
router.post('/documents', requirePermission('knowledge.manage', ['ADMIN', 'TECHNICIAN']), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier requis' });

  const ext = (req.file.originalname.split('.').pop() || '').toLowerCase();
  const sourceType = ext === 'pdf' ? 'pdf' : ext === 'docx' ? 'docx' : 'markdown';

  const document = await prisma.knowledgeDocument.create({
    data: {
      title: req.body.title || req.file.originalname,
      sourceType,
      filename: req.file.originalname,
      status: 'PROCESSING',
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

// Recherche par similarité : retourne les 5 fragments les plus pertinents pour une requête
router.post('/search', async (req, res) => {
  const { query, limit } = req.body;
  if (!query) return res.status(400).json({ error: 'query est requis' });

  try {
    const embedding = await generateEmbedding(query);
    const topK = Math.min(Number(limit) || 5, 20);

    const results = await prisma.$queryRawUnsafe(
      `SELECT c.id, c."documentId", c."chunkIndex", c.content, d.title, d."sourceType",
              1 - (c.embedding <=> $1::vector) AS similarity
       FROM "KnowledgeChunk" c
       JOIN "KnowledgeDocument" d ON d.id = c."documentId"
       WHERE d.status = 'READY'
       ORDER BY c.embedding <=> $1::vector
       LIMIT $2`,
      toVectorLiteral(embedding),
      topK
    );

    return res.json(results);
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Erreur lors de la recherche' });
  }
});

module.exports = router;
