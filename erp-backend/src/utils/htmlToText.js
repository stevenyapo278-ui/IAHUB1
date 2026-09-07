/**
 * Conversion HTML → texte brut lisible, sans dépendance externe.
 *
 * Pourquoi : Microsoft Graph n'expose que `bodyPreview` (~255 caractères) en texte.
 * Quand un demandeur TRANSFÈRE une conversation entière vers l'adresse support (typiquement
 * précédé de « FYI » / « pour information »), la vraie demande se trouve plus bas dans le fil
 * — le preview ne suffit pas et l'analyse IA classifyait le mail comme « informatif ».
 * On convertit donc le bodyHtml complet du fil en texte exploitable par les prompts.
 */

const BLOCK_TAGS = /<\/(p|div|tr|li|h[1-6]|blockquote|pre|table|section|article|header|footer)>/gi;
const LINEBREAK_TAGS = /<\s*(br|hr)\s*\/?>/gi;
const DROPPED_TAGS = /<(style|script|head|title|noscript)[^>]*>[\s\S]*?<\/\1>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;

// Entités HTML courantes (les autres sont laissées telles quelles — pas de dépendance heDecode)
const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&laquo;': '«', '&raquo;': '»',
  '&eacute;': 'é', '&egrave;': 'è', '&agrave;': 'à', '&ccedil;': 'ç',
  '&ecirc;': 'ê', '&ocirc;': 'ô', '&ugrave;': 'ù', '&iuml;': 'ï', '&euml;': 'ë',
  '&ndash;': '–', '&mdash;': '—', '&hellip;': '…',
};

function decodeEntities(text) {
  let out = text;
  for (const [ent, ch] of Object.entries(ENTITIES)) {
    out = out.split(ent).join(ch);
  }
  // Entités numériques décimales &#123; et hexadécimales &#x1F600;
  out = out.replace(/&#(\d+);/g, (_, code) => {
    const n = Number(code);
    return n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : '';
  });
  out = out.replace(/&#x([0-9a-f]+);/gi, (_, code) => {
    const n = parseInt(code, 16);
    return n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : '';
  });
  return out;
}

/**
 * @param {string} html  Corps HTML complet du message (message.body.content de Graph)
 * @returns {string} Texte lisible du fil de conversation (quoted replies inclus)
 */
function htmlToText(html) {
  if (!html) return '';
  if (!/<[a-z][\s\S]*>/i.test(html)) return html; // déjà du texte brut

  let text = html
    .replace(COMMENTS, '')
    .replace(DROPPED_TAGS, '')
    .replace(LINEBREAK_TAGS, '\n')
    .replace(BLOCK_TAGS, '\n')
    // Cellules de tableau séparées par un espace (les fils Outlook sont souvent en table)
    .replace(/<\/(td|th)>/gi, ' ')
    // Balises d'image → marqueur lisible
    .replace(/<img[^>]*>/gi, '[image]')
    .replace(/<[^>]+>/g, '');

  text = decodeEntities(text);
  // Normalisation : espaces multiples, lignes vides répétées, lignes de plus de 500 caractères
  text = text
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

module.exports = { htmlToText };
