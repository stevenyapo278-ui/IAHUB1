const crypto = require('crypto');
const prisma = require('../prismaClient');
const { fetchMessageAttachments } = require('./emailPoller');
const { uploadGlpiAttachment } = require('./glpiTicketCreator');
const { getActiveProvider, callProvider } = require('./mailAnalyzer');

const GENERIC_IMAGE_NAME = /^(image|img|photo)\d*\.(png|jpe?g|gif|bmp)$/i;
const ATTACHMENT_MENTION_KEYWORDS = /capture|screenshot|écran|piece jointe|pièce jointe|ci-joint|photo du|voir le fichier|en attache/i;

// Détermine si une image inline doit être bloquée sans même consulter l'IA : nom de fichier
// générique typique d'un export de signature ET aucune mention explicite dans le corps du mail
// d'une vraie pièce jointe — sert de filet de sécurité déterministe, le modèle IA léger utilisé
// pour le reste du tri se montrant parfois incohérent entre plusieurs images au nom identique.
function looksLikeGenericSignatureImage(attachment, bodyText) {
  return GENERIC_IMAGE_NAME.test(attachment.name || '') && !ATTACHMENT_MENTION_KEYWORDS.test(bodyText || '');
}

// Demande à l'IA de trier les images inline pertinentes (captures d'écran, photos jointes par
// l'utilisateur) des logos/signatures d'entreprise répétés dans chaque message du fil.
// Ne traite que les images inline (isInline) — les vrais fichiers joints explicitement (isInline: false)
// sont toujours conservés sans filtrage, l'utilisateur les a ajoutés intentionnellement.
async function filterOutSignatureImages(attachments, bodyText) {
  const inlineImages = attachments.filter((a) => a.isInline && a.contentType?.startsWith('image/'));
  if (inlineImages.length === 0) return attachments;

  // Filet déterministe d'abord : tout ce qui matche un nom générique sans mention de pièce jointe
  // dans le texte est écarté immédiatement, sans dépendre du jugement (parfois incohérent) de l'IA.
  const genericFiltered = attachments.filter(
    (a) => !inlineImages.includes(a) || !looksLikeGenericSignatureImage(a, bodyText)
  );
  const remainingInlineImages = inlineImages.filter((a) => genericFiltered.includes(a));
  if (remainingInlineImages.length === 0) return genericFiltered;

  const provider = await getActiveProvider();
  if (!provider) return genericFiltered; // pas de filtrage IA possible : on garde le reste par sécurité

  const { getPrompt } = require('./promptTemplates');
  const prompt = await getPrompt('filterOutSignatureImages', {
    bodyText: (bodyText || '').substring(0, 500),
    imagesList: remainingInlineImages.map((a, i) => `${i}. nom="${a.name}", type="${a.contentType}", taille=${a.size} octets`).join('\n'),
  });

  try {
    const raw = await callProvider(provider, prompt);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    const signatureIndexes = new Set(
      (parsed.results || []).filter((r) => r.isSignatureLogo).map((r) => r.index)
    );
    const signatureAttachments = new Set(remainingInlineImages.filter((_, i) => signatureIndexes.has(i)));
    return genericFiltered.filter((a) => !signatureAttachments.has(a));
  } catch {
    // En cas d'échec de l'IA (provider down, JSON invalide), on garde le reste par sécurité
    // plutôt que de risquer de perdre une vraie pièce jointe utile.
    return genericFiltered;
  }
}

function hashContent(base64) {
  return crypto.createHash('sha256').update(base64, 'base64').digest('hex');
}

// Récupère, uploade vers GLPI et enregistre les pièces jointes d'un email entrant.
// simulatedAttachments permet de contourner Graph pour les tests (/inbox/simulate).
// Retourne { saved, cidMap } où cidMap = { "contentId1": glpiDocumentId1, ... }
// pour réécrire les références cid: dans le bodyHtml du ticketMessage.
async function processIncomingAttachments({ account, graphMessageId, incomingEmailId, ticketId, glpiTicketId, simulatedAttachments, bodyText }) {
  if (!glpiTicketId) return { saved: [], cidMap: {} };

  // graphMessageId factice (préfixe SIM-) = message simulé via /inbox/simulate sans Graph réel :
  // on n'interroge jamais Graph dans ce cas, simulatedAttachments (même vide) fait foi.
  const isSimulated = typeof graphMessageId === 'string' && graphMessageId.startsWith('SIM-');

  let attachments;
  if (simulatedAttachments) {
    attachments = simulatedAttachments;
  } else if (isSimulated) {
    attachments = [];
  } else {
    const rawAttachments = await fetchMessageAttachments(account, graphMessageId);
    const filtered = await filterOutSignatureImages(rawAttachments, bodyText);
    attachments = filtered.map((a) => ({ name: a.name, contentType: a.contentType, contentBytes: a.contentBytes, contentId: a.contentId }));
  }

  // Filet de sécurité indépendant du jugement IA : si le contenu binaire exact (hash) d'une image
  // a déjà été enregistré sur ce même ticket, c'est forcément une signature/logo répété(e) plutôt
  // qu'une nouvelle vraie pièce jointe — l'IA peut se tromper, le hash ne peut pas.
  const existingHashes = new Set(
    (await prisma.ticketAttachment.findMany({ where: { ticketId }, select: { contentHash: true } }))
      .map((a) => a.contentHash)
      .filter(Boolean)
  );

  const saved = [];
  const cidMap = {};
  for (const att of attachments) {
    try {
      const contentHash = hashContent(att.contentBytes);
      if (existingHashes.has(contentHash)) continue;

      const buffer = Buffer.from(att.contentBytes, 'base64');
      const documentId = await uploadGlpiAttachment({
        glpiTicketId, buffer, filename: att.name, mimeType: att.contentType,
      });
      if (documentId) {
        const created = await prisma.ticketAttachment.create({
          data: {
            ticketId,
            glpiDocumentId: documentId,
            filename: att.name,
            mimeType: att.contentType,
            source: 'INCOMING_EMAIL',
            incomingEmailId,
            contentHash,
          },
        });
        existingHashes.add(contentHash);
        saved.push(created);
        if (att.contentId) {
          cidMap[att.contentId] = documentId;
        }
      }
    } catch (err) {
      console.error('[emailAttachmentProcessor] Échec attachment', att.name, err.message);
    }
  }
  return { saved, cidMap };
}

module.exports = { processIncomingAttachments };
