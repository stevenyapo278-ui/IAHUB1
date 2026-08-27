const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const prisma = require('../prismaClient');
const { fetchMessageAttachments } = require('./emailPoller');

const { getActiveProviders, callProviderWithFallback } = require('./mailAnalyzer');

const GENERIC_IMAGE_NAME = /^(image|img|photo)\d*\.(png|jpe?g|gif|bmp)$/i;
const ATTACHMENT_MENTION_KEYWORDS = /capture|screenshot|écran|piece jointe|pièce jointe|ci-joint|photo du|voir le fichier|en attache/i;

const ATTACHMENTS_DIR = path.join(__dirname, '..', '..', 'uploads', 'attachments');

function ensureAttachmentsDir() {
  if (!fs.existsSync(ATTACHMENTS_DIR)) {
    fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
  }
}

function looksLikeGenericSignatureImage(attachment, bodyText) {
  return GENERIC_IMAGE_NAME.test(attachment.name || '') && !ATTACHMENT_MENTION_KEYWORDS.test(bodyText || '');
}

async function filterOutSignatureImages(attachments, bodyText) {
  const inlineImages = attachments.filter((a) => a.isInline && a.contentType?.startsWith('image/'));
  if (inlineImages.length === 0) return attachments;

  const genericFiltered = attachments.filter(
    (a) => !inlineImages.includes(a) || !looksLikeGenericSignatureImage(a, bodyText)
  );
  const remainingInlineImages = inlineImages.filter((a) => genericFiltered.includes(a));
  if (remainingInlineImages.length === 0) return genericFiltered;

  const providers = await getActiveProviders();
  if (providers.length === 0) return genericFiltered;

  const { getPrompt } = require('./promptTemplates');
  const prompt = await getPrompt('filterOutSignatureImages', {
    bodyText: (bodyText || '').substring(0, 500),
    imagesList: remainingInlineImages.map((a, i) => `${i}. nom="${a.name}", type="${a.contentType}", taille=${a.size} octets`).join('\n'),
  });

  try {
    const raw = await callProviderWithFallback(providers, prompt);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    const signatureIndexes = new Set(
      (parsed.results || []).filter((r) => r.isSignatureLogo).map((r) => r.index)
    );
    const signatureAttachments = new Set(remainingInlineImages.filter((_, i) => signatureIndexes.has(i)));
    return genericFiltered.filter((a) => !signatureAttachments.has(a));
  } catch {
    return genericFiltered;
  }
}

function hashContent(base64) {
  return crypto.createHash('sha256').update(base64, 'base64').digest('hex');
}

// Plus de upload GLPI : les pièces jointes restent en local
async function uploadPendingAttachments() {
  return [];
}

async function saveAttachmentLocally({ ticketId, filename, mimeType, contentBytes, contentHash, incomingEmailId }) {
  ensureAttachmentsDir();
  const safeName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const filepath = path.join(ATTACHMENTS_DIR, safeName);
  const buffer = Buffer.from(contentBytes, 'base64');
  fs.writeFileSync(filepath, buffer);
  return prisma.ticketAttachment.create({
    data: {
      ticketId,
      filename,
      mimeType: mimeType || null,
      source: 'INCOMING_EMAIL',
      incomingEmailId: incomingEmailId || null,
      contentHash: contentHash || null,
      localFilepath: filepath,
    },
  });
}

async function processIncomingAttachments({ account, graphMessageId, incomingEmailId, ticketId, simulatedAttachments, bodyText }) {
  const isSimulated = typeof graphMessageId === 'string' && graphMessageId.startsWith('SIM-');
  if (simulatedAttachments || isSimulated) return { saved: [], cidMap: {} };

  const rawAttachments = await fetchMessageAttachments(account, graphMessageId);
  const filtered = await filterOutSignatureImages(rawAttachments, bodyText);
  const existingHashes = new Set(
    (await prisma.ticketAttachment.findMany({ where: { ticketId }, select: { contentHash: true } }))
      .map((a) => a.contentHash).filter(Boolean)
  );
  const saved = [];
  for (const att of filtered) {
    const contentHash = hashContent(att.contentBytes);
    if (existingHashes.has(contentHash)) continue;
    const created = await saveAttachmentLocally({
      ticketId, filename: att.name, mimeType: att.contentType,
      contentBytes: att.contentBytes, contentHash, incomingEmailId,
    });
    existingHashes.add(contentHash);
    saved.push(created);
  }
  return { saved, cidMap: {} };
}

module.exports = { processIncomingAttachments, uploadPendingAttachments };
