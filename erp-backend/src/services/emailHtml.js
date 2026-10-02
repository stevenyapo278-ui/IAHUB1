// Résolution des images inline (cid:) et des URLs d'uploads dans les corps HTML d'emails.
//
// Problème traité : un corps HTML stocké peut contenir
//   - src="cid:image001.png"     → référencement inline non réécrit à l'ingest (pièce jointe
//                                   non sauvegardée, clé de correspondance différente, casse...)
//   - src="cid:logo-signature"   → signature multi-images insérée à l'envoi (jamais résolue en base)
//   - src="http://hôte/uploads/…" → URL absolue en HTTP servie depuis une page HTTPS (mixed content
//                                   bloqué par le navigateur → image non affichée)
//   - src="/uploads/…"            → fichier absent du volume → 404 → icône cassée
//
// À la lecture, on réécrit en conséquence et on retire les <img> finalement non résolus
// (mieux vaut rien afficher qu'une icône cassée). Chemin fichier : TOUJOURS process.cwd()
// (règle du dépôt — le volume Docker est monté sur <WORKDIR>/uploads).

const fs = require('fs');
const path = require('path');
const prisma = require('../prismaClient');
const { getSystemSettings } = require('./systemSettings');

const UPLOADS_PREFIX = '/uploads/';
const IMG_TAG_RE = /<img\b[^>]*>/gi;

// ── Chemins ────────────────────────────────────────────────────────────────

// '…/uploads/<sous-dossier>/<fichier>' → '/uploads/<sous-dossier>/<fichier>'
function toPublicUploadUrl(localFilepath) {
  if (!localFilepath) return null;
  const normalized = String(localFilepath).replace(/\\/g, '/');
  const idx = normalized.lastIndexOf(`${UPLOADS_PREFIX}`);
  if (idx !== -1) return `${UPLOADS_PREFIX}${normalized.slice(idx + UPLOADS_PREFIX.length)}`;
  if (normalized.startsWith('uploads/')) return `/${normalized}`;
  return null;
}

// URL absolue en HTTP vers /uploads → relative (mixed content bloqué en HTTPS).
// Les URL localhost/127.0.0.1/0.0.0.0 en HTTP(S) sont réécrites aussi : elles ne
// fonctionnent que depuis la machine de l'admin.
function normalizeUploadUrls(html) {
  if (!html || !/https?:\/\//i.test(html)) return html;
  return html
    .replace(/http:\/\/[^"'()\s>]+\/uploads\//gi, UPLOADS_PREFIX)
    .replace(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?\/uploads\//gi, UPLOADS_PREFIX);
}

// ── Correspondances cid: → URL publique ────────────────────────────────────

function setKey(map, key, url) {
  const k = String(key || '').trim().toLowerCase();
  if (!k || map.has(k)) return;
  map.set(k, url);
}

// Clés candidates d'un cid : plein, sans balise <>, sans partie domaine
// ('image001.abc@corp' → 'image001.abc' → 'image001' via la clé du fichier).
function cidCandidates(rawCid) {
  const clean = String(rawCid || '').trim().replace(/^[<(\s]+|[>)\s]+$/g, '').toLowerCase();
  if (!clean) return [];
  const list = [clean];
  const withoutDomain = clean.split('@')[0];
  if (withoutDomain && !list.includes(withoutDomain)) list.push(withoutDomain);
  return list;
}

// URL d'upload connue (signature) → chemin local '/uploads/…', quelle que soit l'URL de base
// utilisée à l'enregistrement (http://ip:4000, https://domaine.tld…).
function toLocalUploadPath(url) {
  const match = String(url || '').match(/^(?:https?:\/\/[^/]+)?(\/uploads\/[^"'\s]+)$/i);
  return match ? match[1] : null;
}

function addAttachmentKeys(map, attachment) {
  const url = toPublicUploadUrl(attachment?.localFilepath);
  if (!url) return;
  const filename = String(attachment.filename || '').trim();
  if (filename) {
    setKey(map, filename, url);
    const withoutExt = filename.replace(/\.[^.]+$/, '');
    if (withoutExt) setKey(map, withoutExt, url);
  }
}

// cid:logo-signature, cid:logo-signature-1, cid:logo-signature-2… (cf. emailSender.js)
function addSignatureKeys(map, settings) {
  const logos = Array.isArray(settings?.signatureLogos) ? settings.signatureLogos : [];
  logos.forEach((logo, index) => {
    const url = toLocalUploadPath(logo?.url);
    if (!url) return;
    const cid = index === 0 ? 'logo-signature' : `logo-signature-${index}`;
    setKey(map, cid, url);
  });
  // Compat anciens réglages : une seule URL stockée hors liste
  if (logos.length === 0 && settings?.signatureLogoUrl) {
    const url = toLocalUploadPath(settings.signatureLogoUrl);
    if (url) setKey(map, 'logo-signature', url);
  }
}

// Charge la table de correspondance pour un ensemble de tickets / emails entrants.
async function loadCidMap({ ticketIds = [], incomingEmailIds = [], includeSignature = true } = {}) {
  const tIds = [...new Set(ticketIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  const eIds = [...new Set(incomingEmailIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  const map = new Map();

  // Les pièces jointes d'un email entrant rattaché au ticket portent l'emailId, pas le ticketId :
  // on complète la liste des emails pour ne rien rater.
  let allEmailIds = eIds;
  if (tIds.length > 0) {
    const linked = await prisma.incomingEmail.findMany({
      where: { erpTicketId: { in: tIds } },
      select: { id: true },
    });
    allEmailIds = [...new Set([...eIds, ...linked.map((e) => e.id)])];
  }

  if (tIds.length > 0 || allEmailIds.length > 0) {
    const or = [];
    if (tIds.length > 0) or.push({ ticketId: { in: tIds } });
    if (allEmailIds.length > 0) or.push({ incomingEmailId: { in: allEmailIds } });
    const rows = await prisma.ticketAttachment.findMany({
      where: { localFilepath: { not: null }, OR: or },
      select: { filename: true, localFilepath: true },
    });
    for (const row of rows) addAttachmentKeys(map, row);
  }

  if (includeSignature) {
    try {
      addSignatureKeys(map, await getSystemSettings());
    } catch {
      // réglages indisponibles : on continue sans signature
    }
  }
  return map;
}

// ── Réécriture du HTML ─────────────────────────────────────────────────────

function applyCidMap(html, cidMap) {
  if (!html || !cidMap || cidMap.size === 0) return html;
  // On remplace uniquement dans la valeur d'un attribut d'image/lien (toujours entre guillemets
  // dans un HTML d'email) : ainsi un cid de type '<image001.png>' est réécrit entièrement et
  // ne laisse jamais de '>' résiduel dans l'URL.
  return html.replace(/(\s(?:src|srcset|href|poster|style)\s*=\s*["'])([^"']*)(["'])/gi, (match, before, value, after) => {
    if (!/cid:/i.test(value)) return match;
    const replaced = value.replace(/cid:([^,\s)"']+)/gi, (subMatch, rawCid) => {
      for (const candidate of cidCandidates(rawCid)) {
        const mapped = cidMap.get(candidate);
        if (mapped) return mapped;
      }
      return subMatch;
    });
    return `${before}${replaced}${after}`;
  });
}

function imgTagSrc(tag) {
  const m = tag.match(/\ssrc\s*=\s*("([^"]*)"|'([^']*)')/i);
  if (!m) return null;
  return m[2] ?? m[3] ?? '';
}

function imgTagSrcset(tag) {
  const m = tag.match(/\ssrcset\s*=\s*("([^"]*)"|'([^']*)')/i);
  if (!m) return null;
  return m[2] ?? m[3] ?? '';
}

function fileExistsForPublicUrl(url) {
  // url = '/uploads/…' → résolution par rapport à process.cwd() (volume Docker monté dessus).
  // path.join concatène : join(cwd, '/uploads/x') = <cwd>/uploads/x (contrairement à resolve).
  const onDisk = path.join(process.cwd(), url);
  try {
    return fs.existsSync(onDisk);
  } catch {
    return false;
  }
}

// Supprime les <img> qu'on n'a pas pu rendre utilisables : src cid: non résolu,
// srcset contenant un cid:, ou fichier /uploads absent du disque.
function cleanupImgTags(html) {
  if (!html) return html;
  return html.replace(IMG_TAG_RE, (tag) => {
    const src = imgTagSrc(tag);
    const srcset = imgTagSrcset(tag);
    if (src === null && srcset === null) return tag;
    if (srcset && /cid:/i.test(srcset)) return '';
    if (!src) return tag;
    if (/^cid:/i.test(src)) return '';
    if (src.startsWith(UPLOADS_PREFIX) && !fileExistsForPublicUrl(src)) return '';
    return tag;
  });
}

function resolveHtml(html, cidMap) {
  if (!html) return html;
  let out = normalizeUploadUrls(html);
  out = applyCidMap(out, cidMap);
  out = cleanupImgTags(out);
  return out;
}

// ── Points d'entrée ────────────────────────────────────────────────────────

// Résout un corps HTML isolé (ticketId OU incomingEmailIds selon ce qu'on connaît).
async function resolveEmailHtml(html, { ticketId = null, incomingEmailIds = [], ticketIds = [] } = {}) {
  if (!html) return html;
  const cidMap = await loadCidMap({
    ticketIds: [...(ticketIds || []), ...(ticketId ? [ticketId] : [])],
    incomingEmailIds: incomingEmailIds || [],
  });
  return resolveHtml(html, cidMap);
}

// Résout en masse les bodyHtml d'une liste de messages (une seule requête d'attachments).
// Reconnait emailId/incomingEmailId (IncomingEmail) et ticketId (TicketMessage).
async function resolveMessagesHtml(messages, { ticketId = null } = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const ticketIds = [ticketId];
  const incomingEmailIds = [];
  for (const m of messages) {
    if (m.ticketId) ticketIds.push(m.ticketId);
    const emailId = m.emailId || m.incomingEmailId || (m.kind === 'inbound' ? m.id : null);
    if (emailId && m.kind === 'inbound') incomingEmailIds.push(emailId);
  }
  const needsCid = messages.some((m) => m.bodyHtml && /cid:|https?:|\/uploads\//i.test(m.bodyHtml));
  if (!needsCid) return messages;
  const cidMap = await loadCidMap({ ticketIds, incomingEmailIds });
  for (const m of messages) {
    if (m.bodyHtml) m.bodyHtml = resolveHtml(m.bodyHtml, cidMap);
  }
  return messages;
}

module.exports = {
  toPublicUploadUrl,
  normalizeUploadUrls,
  cidCandidates,
  buildSignatureCidMap: (settings) => {
    const map = new Map();
    addSignatureKeys(map, settings);
    return map;
  },
  applyCidMap,
  cleanupImgTags,
  resolveHtml,
  loadCidMap,
  resolveEmailHtml,
  resolveMessagesHtml,
};
