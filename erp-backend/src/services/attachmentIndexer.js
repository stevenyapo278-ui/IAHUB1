const fs = require('fs');
const path = require('path');
const prisma = require('../prismaClient');
const { extractText, isTextExtractable, MAX_EXTRACT_CHARS } = require('../utils/documentExtract');
const { generateEmbedding, toVectorLiteral } = require('../utils/embeddings');
const { chunkText } = require('./emailRagService');
const { analyzeImageAttachments, getActiveProviders } = require('./mailAnalyzer');

// Plafond de taille pour l'OCR Vision (même limite que l'analyse d'images du pipeline mail).
const MAX_VISION_BYTES = 8 * 1024 * 1024;
const VISION_HEADER = /^---\s*\[ANALYSE VISION[^\]]*\]\s*---\s*/i;
const VISION_ITEM_HEADER = /^\[Contenu extrait de la capture d'écran[^\]]*\]\s*:\s*/i;

function isImage(mimeType, filename) {
  if ((mimeType || '').startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(filename || '');
}

// Les pièces jointes sont du contenu externe : on neutralise les balises de
// délimitation utilisées par les prompts du chatbot (même logique que le RAG mail),
// sans écraser les retours à la ligne du document.
function neutralizePromptTags(text) {
  return String(text || '').replace(
    /<\/?(mail_contenu|system|prompt|instructions?|user|assistant|resultats?|ticket_contenu|kb_contenu)\b[^>]*>/gi,
    ' '
  );
}

function resolveFilepath(localFilepath) {
  if (!localFilepath) return null;
  const absolute = path.isAbsolute(localFilepath)
    ? localFilepath
    : path.join(process.cwd(), localFilepath);
  return fs.existsSync(absolute) ? absolute : null;
}

// Lit le texte de la pièce jointe : OCR Vision pour les images, extraction
// documentaire (PDF/DOCX/XLSX/CSV/texte) sinon.
async function extractAttachmentText(attachment, filepath) {
  if (isImage(attachment.mimeType, attachment.filename)) {
    const providers = await getActiveProviders();
    if (providers.length === 0) {
      // Sans fournisseur vision, marquer EMPTY condamnerait la PJ définitivement :
      // on la laisse PENDING pour que le backfill repasse une fois une clé configurée.
      const err = new Error('Aucun fournisseur IA vision disponible');
      err.retryLater = true;
      throw err;
    }
    const buffer = fs.readFileSync(filepath);
    if (buffer.length > MAX_VISION_BYTES) {
      return { text: '', kind: 'VISION', reason: 'image trop volumineuse' };
    }
    const raw = await analyzeImageAttachments([{
      localFilepath: filepath,
      mimeType: attachment.mimeType,
      filename: attachment.filename,
    }]);
    const text = (raw || '')
      .replace(VISION_HEADER, '')
      .replace(VISION_ITEM_HEADER, '')
      .trim()
      .substring(0, MAX_EXTRACT_CHARS);
    return { text, kind: 'VISION' };
  }

  if (!isTextExtractable(attachment.mimeType, attachment.filename)) {
    return { text: '', kind: 'TEXTE', reason: 'type non supporté' };
  }

  const buffer = fs.readFileSync(filepath);
  const text = (await extractText(buffer, attachment.mimeType, attachment.filename) || '')
    .trim()
    .substring(0, MAX_EXTRACT_CHARS);
  return { text, kind: 'TEXTE' };
}

function buildAttachmentContent({ attachment, email, kind }) {
  const parts = [];
  parts.push(`Pièce jointe: ${attachment.filename}${attachment.mimeType ? ` (${attachment.mimeType})` : ''}`);
  if (attachment.ticketId) parts.push(`Ticket: #${attachment.ticketId}`);
  if (email) {
    if (email.subject) parts.push(`Email: ${email.subject}`);
    if (email.fromEmail) parts.push(`Expéditeur: ${email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail}`);
    if (email.receivedAt) parts.push(`Date: ${new Date(email.receivedAt).toLocaleString('fr-FR')}`);
  }
  parts.push(`Extraction: ${kind === 'VISION' ? 'OCR Vision (image)' : 'texte du document'}`);
  parts.push(`Contenu:\n${attachment.extractedText}`);
  return neutralizePromptTags(parts.join('\n\n'));
}

// Interrupteur global (Paramètres > Automatisation). Lit la base à chaque appel :
// la bascule s'applique immédiatement, sans redémarrage du serveur. En cas d'erreur
// de lecture, on reste activé (comportement historique).
async function isAttachmentIndexEnabled() {
  try {
    const settings = await prisma.systemSettings.findUnique({
      where: { id: 1 },
      select: { attachmentIndexEnabled: true },
    });
    return settings?.attachmentIndexEnabled !== false;
  } catch {
    return true;
  }
}

// Supprime les chunks RAG d'une pièce jointe (avant ré-indexation ou suppression).
async function deleteAttachmentChunks(attachmentId) {
  await prisma.emailRagChunk.deleteMany({ where: { sourceType: 'ATTACHMENT', sourceId: attachmentId } });
}

async function indexAttachmentChunks(attachment, email, kind) {
  await deleteAttachmentChunks(attachment.id);
  const content = buildAttachmentContent({ attachment, email, kind });
  const chunks = chunkText(content);
  const ticketId = attachment.ticketId || email?.erpTicketId || null;
  const metadata = {
    ticketId,
    erpTicketId: email?.erpTicketId || null,
    incomingEmailId: attachment.incomingEmailId || null,
    attachmentId: attachment.id,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    subject: email?.subject || attachment.filename,
    fromEmail: email?.fromEmail || null,
    fromName: email?.fromName || null,
    receivedAt: email?.receivedAt || attachment.createdAt,
    direction: 'INBOUND',
    source: 'TicketAttachment',
    extraction: kind,
  };

  for (let i = 0; i < chunks.length; i++) {
    const chunkContent = chunks[i];
    let embedding = null;
    try {
      const vector = await generateEmbedding(chunkContent);
      embedding = toVectorLiteral(vector);
    } catch (e) {
      // Sans embedding le chunk reste interrogeable en plein texte (comme le RAG mail).
      console.warn(`[attachmentIndexer] embedding PJ ${attachment.id} chunk ${i} échoué:`, e.message);
    }
    if (embedding) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "EmailRagChunk" ("sourceType", "sourceId", "chunkIndex", content, embedding, metadata, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb, now(), now())`,
        'ATTACHMENT', attachment.id, i, chunkContent, embedding, JSON.stringify(metadata)
      );
    } else {
      await prisma.emailRagChunk.create({
        data: { sourceType: 'ATTACHMENT', sourceId: attachment.id, chunkIndex: i, content: chunkContent, metadata },
      });
    }
  }
  return chunks.length;
}

/**
 * Extrait le texte (ou l'OCR Vision) d'une pièce jointe et l'indexe dans
 * EmailRagChunk avec sourceType = 'ATTACHMENT'.
 * Appelée en fire-and-forget après chaque upload/réception, et par le backfill.
 */
async function indexTicketAttachment(attachmentId) {
  // Indexation suspendue : on ne réserve pas la ligne, elle reste PENDING et sera
  // reprise au prochain passage après réactivation.
  if (!(await isAttachmentIndexEnabled())) return { status: 'DISABLED' };

  const claimed = await prisma.ticketAttachment.updateMany({
    where: { id: attachmentId, extractionStatus: 'PENDING' },
    data: { extractionStatus: 'PROCESSING' },
  });
  if (!claimed || claimed.count === 0) return null; // déjà traité ou en cours

  const attachment = await prisma.ticketAttachment.findUnique({
    where: { id: attachmentId },
    include: {
      incomingEmail: {
        select: {
          id: true, subject: true, fromEmail: true, fromName: true,
          receivedAt: true, conversationId: true, erpTicketId: true,
        },
      },
    },
  });
  if (!attachment) return null;
  const email = attachment.incomingEmail || null;

  const filepath = resolveFilepath(attachment.localFilepath);
  if (!filepath) {
    await prisma.ticketAttachment.update({
      where: { id: attachmentId },
      data: {
        extractionStatus: 'SKIPPED',
        extractionError: attachment.localFilepath ? 'Fichier introuvable sur le disque' : 'Aucun fichier local',
        extractedAt: new Date(),
      },
    });
    return { status: 'SKIPPED' };
  }

  let extracted;
  try {
    extracted = await extractAttachmentText(attachment, filepath);
  } catch (err) {
    if (err.retryLater) {
      await prisma.ticketAttachment.update({
        where: { id: attachmentId },
        data: { extractionStatus: 'PENDING', extractionError: err.message },
      });
      return { status: 'PENDING', reason: err.message };
    }
    await prisma.ticketAttachment.update({
      where: { id: attachmentId },
      data: { extractionStatus: 'ERROR', extractionError: err.message, extractedAt: new Date() },
    });
    console.warn(`[attachmentIndexer] extraction PJ ${attachmentId} échouée:`, err.message);
    return { status: 'ERROR', reason: err.message };
  }

  if (!extracted.text) {
    await prisma.ticketAttachment.update({
      where: { id: attachmentId },
      data: {
        extractionStatus: extracted.reason ? 'SKIPPED' : 'EMPTY',
        extractionError: extracted.reason || 'Aucun texte détecté',
        extractedAt: new Date(),
      },
    });
    await deleteAttachmentChunks(attachmentId);
    return { status: 'SKIPPED', reason: extracted.reason };
  }

  const updated = await prisma.ticketAttachment.update({
    where: { id: attachmentId },
    data: {
      extractedText: extracted.text,
      extractionStatus: 'DONE',
      extractionError: null,
      extractedAt: new Date(),
    },
  });

  let chunks = 0;
  try {
    chunks = await indexAttachmentChunks(updated, email, extracted.kind);
  } catch (err) {
    console.warn(`[attachmentIndexer] indexation PJ ${attachmentId} échouée:`, err.message);
  }
  return { status: 'DONE', chunks, extraction: extracted.kind };
}

/**
 * Backfill incrémental : traite les pièces jointes encore PENDING.
 * Chaque passage avance (statut mis à jour), donc le rattrapage se termine seul.
 * Lot volontairement petit : chaque image coûte un appel Vision et chaque chunk
 * un appel Embedding.
 */
async function backfillAttachmentIndex({ batchSize = 5 } = {}) {
  const stats = { processed: 0, done: 0, skipped: 0, errors: 0, chunks: 0, waitingProvider: 0 };
  const pending = await prisma.ticketAttachment.findMany({
    where: { extractionStatus: 'PENDING', localFilepath: { not: null } },
    orderBy: { id: 'asc' },
    take: batchSize,
    select: { id: true },
  });

  for (const row of pending) {
    let result;
    try {
      result = await indexTicketAttachment(row.id);
    } catch (err) {
      console.warn(`[attachmentIndexer] backfill PJ ${row.id} échoué:`, err.message);
      stats.errors += 1;
      continue;
    }
    if (!result) continue;
    stats.processed += 1;
    if (result.status === 'DONE') { stats.done += 1; stats.chunks += result.chunks || 0; }
    else if (result.status === 'SKIPPED' || result.status === 'EMPTY') stats.skipped += 1;
    else if (result.status === 'ERROR') stats.errors += 1;
    else if (result.status === 'PENDING') {
      // Aucun fournisseur vision : inutile de parcourir le reste du lot.
      stats.waitingProvider += 1;
      break;
    }
  }
  return stats;
}

/**
 * Compteurs affichés dans Paramètres > Automatisation > Indexation des pièces jointes.
 * Seules les PJ disposant d'un fichier local sont comptées (les autres ne peuvent pas
 * être extraites).
 */
async function getAttachmentIndexingStats() {
  const where = { localFilepath: { not: null } };
  const [groups, chunks, enabled] = await Promise.all([
    prisma.ticketAttachment.groupBy({ by: ['extractionStatus'], where, _count: { _all: true } }),
    prisma.emailRagChunk.count({ where: { sourceType: 'ATTACHMENT' } }),
    isAttachmentIndexEnabled(),
  ]);

  const counts = { PENDING: 0, PROCESSING: 0, DONE: 0, EMPTY: 0, SKIPPED: 0, ERROR: 0 };
  let total = 0;
  for (const g of groups) {
    const n = g._count?._all || 0;
    if (counts[g.extractionStatus] !== undefined) counts[g.extractionStatus] = n;
    total += n;
  }

  return { enabled, total, chunks, ...counts };
}

/**
 * Relance l'extraction d'une pièce jointe (bouton « Réindexer ») : purge ses chunks,
 * remet la ligne en attente puis l'extrait immédiatement. Utile pour une PJ passée
 * SKIPPED/ERROR (fournisseur Vision configuré entre-temps, fichier recopié sur le volume).
 */
async function reindexAttachment(attachmentId) {
  // Ne jamais vider le texte extrait existant si l'indexation est suspendue.
  if (!(await isAttachmentIndexEnabled())) return { status: 'DISABLED' };

  const reset = await prisma.ticketAttachment.updateMany({
    where: { id: attachmentId },
    data: { extractionStatus: 'PENDING', extractionError: null, extractedText: null, extractedAt: null },
  });
  if (!reset || reset.count === 0) return null;
  await deleteAttachmentChunks(attachmentId);
  return indexTicketAttachment(attachmentId);
}

module.exports = {
  indexTicketAttachment,
  backfillAttachmentIndex,
  deleteAttachmentChunks,
  reindexAttachment,
  getAttachmentIndexingStats,
  isAttachmentIndexEnabled,
  buildAttachmentContent,
  neutralizePromptTags,
};
