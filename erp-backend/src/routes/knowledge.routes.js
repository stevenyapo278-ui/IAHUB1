const express = require('express');
const multer = require('multer');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { extractText } = require('../utils/documentExtract');
const { chunkText } = require('../utils/chunking');
const { generateEmbedding, toVectorLiteral } = require('../utils/embeddings');
const { rerank, listRerankCandidates } = require('../utils/reranking');
const { auditLog } = require('../services/auditLogService');
const { validateUpload } = require('../utils/security');

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

  // Valider que le fichier n'est pas dangereux
  const validation = validateUpload(req.file.originalname, req.file.mimetype, 'kb');
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  const ext = (req.file.originalname.split('.').pop() || '').toLowerCase();
  if (!['pdf', 'docx', 'md', 'markdown', 'txt'].includes(ext)) {
    return res.status(400).json({ error: 'Format de fichier non supporté. PDF, DOCX, MD ou TXT requis.' });
  }

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

    const docTitle = document.title;
    const docCategory = category || '';
    const docTags = parsedTags.join(', ');

    for (let i = 0; i < chunks.length; i++) {
      // Build enriched text for vector embedding logic
      let enrichedText = `Document: ${docTitle}`;
      if (docCategory) enrichedText += ` | Catégorie: ${docCategory}`;
      if (docTags) enrichedText += ` | Tags: ${docTags}`;
      enrichedText += `\nContenu: ${chunks[i]}`;

      const embedding = await generateEmbedding(enrichedText);
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
    auditLog('KNOWLEDGE_DOCUMENT_UPLOADED', { actor: req.user, targetType: 'KnowledgeDocument', targetId: updated.id, targetLabel: updated.title, metadata: { sourceType: updated.sourceType, chunksCount: updated._count?.chunks } }).catch(() => {});
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
  if (!['pdf', 'docx', 'md', 'markdown', 'txt'].includes(ext)) {
    return res.status(400).json({ error: 'Format de fichier non supporté. PDF, DOCX, MD ou TXT requis.' });
  }

  const sourceType = ext === 'pdf' ? 'pdf' : ext === 'docx' ? 'docx' : 'markdown';
  const newTitle = req.body.title || document.title;

  await prisma.knowledgeDocument.update({
    where: { id: document.id },
    data: {
      sourceType,
      filename: req.file.originalname,
      title: newTitle,
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

    const docCategory = document.category || '';
    const docTags = (document.tags || []).join(', ');

    for (let i = 0; i < chunks.length; i++) {
      // Build enriched text for vector embedding logic
      let enrichedText = `Document: ${newTitle}`;
      if (docCategory) enrichedText += ` | Catégorie: ${docCategory}`;
      if (docTags) enrichedText += ` | Tags: ${docTags}`;
      enrichedText += `\nContenu: ${chunks[i]}`;

      const embedding = await generateEmbedding(enrichedText);
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
    const doc = await prisma.knowledgeDocument.findUnique({ where: { id: Number(req.params.id) }, select: { id: true, title: true } });
    await prisma.knowledgeDocument.delete({ where: { id: Number(req.params.id) } });
    auditLog('KNOWLEDGE_DOCUMENT_DELETED', { actor: req.user, targetType: 'KnowledgeDocument', targetId: doc.id, targetLabel: doc.title }).catch(() => {});
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

// ── Brouillons de connaissances (KnowledgeDraft) ───────────────────────────

// Liste des brouillons en attente (PENDING)
router.get('/drafts', async (req, res) => {
  const { status } = req.query;
  const where = status ? { status } : { status: 'PENDING' };
  const drafts = await prisma.knowledgeDraft.findMany({
    where,
    include: {
      ticket: {
        select: {
          id: true,
          title: true,
          requester: { select: { fullName: true, email: true } },
        },
      },
      reviewedBy: { select: { fullName: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return res.json(drafts);
});

// Mettre à jour un brouillon (titre, problème, cause, solution, keywords, catégorie, tags)
router.patch('/drafts/:id', requirePermission('knowledge.manage', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const draft = await prisma.knowledgeDraft.findUnique({ where: { id: Number(req.params.id) } });
  if (!draft) return res.status(404).json({ error: 'Brouillon introuvable' });
  if (draft.status !== 'PENDING') return res.status(400).json({ error: 'Seuls les brouillons en attente peuvent être modifiés' });

  const { title, problem, cause, solution, keywords, category, tags } = req.body;
  const data = {};
  if (title !== undefined) data.title = title;
  if (problem !== undefined) data.problem = problem;
  if (cause !== undefined) data.cause = cause;
  if (solution !== undefined) data.solution = solution;
  if (keywords !== undefined) data.keywords = keywords;
  if (category !== undefined) data.category = category;
  if (tags !== undefined) data.tags = tags;

  const updated = await prisma.knowledgeDraft.update({
    where: { id: draft.id },
    data,
  });
  return res.json(updated);
});

// Approuver un brouillon : crée un KnowledgeDocument + chunks à partir du draft
router.post('/drafts/:id/approve', requirePermission('knowledge.manage', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const draft = await prisma.knowledgeDraft.findUnique({ where: { id: Number(req.params.id) } });
  if (!draft) return res.status(404).json({ error: 'Brouillon introuvable' });
  if (draft.status !== 'PENDING') return res.status(400).json({ error: 'Ce brouillon a déjà été traité' });

  // Créer le document de connaissance (sourceType = 'article')
  const articleContent = `Problème :
${draft.problem}

Cause :
${draft.cause}

Solution :
${draft.solution}

Mots-clés : ${draft.keywords.join(', ')}`;

  const document = await prisma.knowledgeDocument.create({
    data: {
      title: draft.title,
      sourceType: 'article',
      status: 'READY',
      category: draft.category,
      tags: draft.tags,
      author: req.user?.fullName || 'Validation Centre',
    },
  });

  // Créer un chunk unique avec le contenu complet
  const { generateEmbedding, toVectorLiteral } = require('../utils/embeddings');
  try {
    const embedding = await generateEmbedding(articleContent);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "KnowledgeChunk" (id, "documentId", "chunkIndex", content, embedding, "createdAt")
       VALUES (DEFAULT, $1, $2, $3, $4::vector, now())`,
      document.id,
      0,
      articleContent,
      toVectorLiteral(embedding)
    );
  } catch {
    // Si l'embedding échoue, on crée le document sans chunk (recherche textuelle uniquement)
  }

  // Marquer le draft comme approuvé
  const updated = await prisma.knowledgeDraft.update({
    where: { id: draft.id },
    data: {
      status: 'APPROVED',
      reviewedById: req.user?.id,
      reviewedAt: new Date(),
      documentId: document.id,
    },
  });

  // Log l'événement
  try {
    const { logEvent } = require('../services/ticketEvent');
    if (draft.ticketId) {
      await logEvent(draft.ticketId, 'KNOWLEDGE_CREATED', req.user?.email || 'SYSTEM', { draftId: draft.id, documentId: document.id });
    }
  } catch {}

  auditLog('KNOWLEDGE_DRAFT_APPROVED', { actor: req.user, targetType: 'KnowledgeDraft', targetId: draft.id, targetLabel: draft.title, metadata: { documentId: document.id } }).catch(() => {});

  return res.json({ draft: updated, document });
});

// Rejeter un brouillon
router.post('/drafts/:id/reject', requirePermission('knowledge.manage', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const { reason } = req.body;
  const draft = await prisma.knowledgeDraft.findUnique({ where: { id: Number(req.params.id) } });
  if (!draft) return res.status(404).json({ error: 'Brouillon introuvable' });
  if (draft.status !== 'PENDING') return res.status(400).json({ error: 'Ce brouillon a déjà été traité' });

  const updated = await prisma.knowledgeDraft.update({
    where: { id: draft.id },
    data: {
      status: 'REJECTED',
      reviewedById: req.user?.id,
      reviewedAt: new Date(),
      reviewNote: reason || null,
    },
  });

  auditLog('KNOWLEDGE_DRAFT_REJECTED', { actor: req.user, targetType: 'KnowledgeDraft', targetId: draft.id, targetLabel: draft.title, metadata: { reason } }).catch(() => {});

  return res.json(updated);
});

// ── Parse PDF structuré (OpenDataLoader-style) ─────────────────────
const { extractStructuredContent } = require('../utils/structuredExtract');

// Récupère le contenu structuré d'un document PDF existant (re-parse depuis les chunks)
router.get('/documents/:id/structured', async (req, res) => {
  const doc = await prisma.knowledgeDocument.findUnique({ where: { id: Number(req.params.id) }, include: { chunks: { orderBy: { chunkIndex: 'asc' } } } });
  if (!doc) return res.status(404).json({ error: 'Document introuvable' });

  // Reconstruire le contenu structuré depuis les chunks existants
  const fullText = doc.chunks.map(c => c.content).join('\n\n');
  const blocks = [];
  const lines = fullText.split('\n');
  let currentParagraph = [];

  function flushParagraph() {
    if (currentParagraph.length > 0) {
      const content = currentParagraph.join(' ').trim();
      if (content) blocks.push({ type: 'paragraph', content });
      currentParagraph = [];
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { flushParagraph(); continue; }

    // Heading detection
    const mdMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (mdMatch) { flushParagraph(); blocks.push({ type: 'heading', level: mdMatch[1].length, content: mdMatch[2].trim() }); continue; }
    if (trimmed.length > 3 && trimmed.length < 100 && trimmed === trimmed.toUpperCase() && /^[A-ZÀÂÉÈÊËÏÎÔÙÛÜÇ\s\d\.\-:()]+$/.test(trimmed)) {
      flushParagraph(); blocks.push({ type: 'heading', level: 2, content: trimmed }); continue;
    }

    // Table detection
    if (trimmed.includes('|') && trimmed.split('|').length >= 3) {
      flushParagraph();
      const lastBlock = blocks[blocks.length - 1];
      if (lastBlock && lastBlock.type === 'table') {
        const cells = trimmed.split('|').map(c => c.trim()).filter(c => c);
        if (!cells.every(c => /^[-=]+$/.test(c))) lastBlock.rows.push(cells);
      } else {
        const cells = trimmed.split('|').map(c => c.trim()).filter(c => c);
        blocks.push({ type: 'table', headers: cells, rows: [], content: trimmed });
      }
      continue;
    }

    // List detection
    const bulletMatch = trimmed.match(/^[\-\*•]\s+(.+)/);
    if (bulletMatch) {
      flushParagraph();
      const lastBlock = blocks[blocks.length - 1];
      if (lastBlock && lastBlock.type === 'list') {
        lastBlock.items.push(bulletMatch[1].trim());
      } else {
        blocks.push({ type: 'list', items: [bulletMatch[1].trim()], ordered: false, content: bulletMatch[1].trim() });
      }
      continue;
    }

    currentParagraph.push(trimmed);
  }
  flushParagraph();

  return res.json({
    blocks,
    pageCount: doc.chunks.length,
    blockCount: blocks.length,
    headingCount: blocks.filter(b => b.type === 'heading').length,
    tableCount: blocks.filter(b => b.type === 'table').length,
    paragraphCount: blocks.filter(b => b.type === 'paragraph').length,
  });
});

// Parse un PDF uploadé et retourne le contenu structuré (preview avant indexation)
router.post('/parse-pdf', requirePermission('knowledge.manage', ['ADMIN', 'TECHNICIAN']), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier PDF requis' });

  const ext = (req.file.originalname.split('.').pop() || '').toLowerCase();
  if (ext !== 'pdf' && !req.file.mimetype?.includes('pdf')) {
    return res.status(400).json({ error: 'Seuls les fichiers PDF sont supportés pour le parsing structuré' });
  }

  try {
    const structured = await extractStructuredContent(req.file.buffer);
    return res.json(structured);
  } catch (err) {
    return res.status(500).json({ error: 'Erreur lors du parsing PDF : ' + err.message });
  }
});

module.exports = router;
