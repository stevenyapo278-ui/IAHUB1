// ── Formatage strict des titres de tickets ─────────────────────────────────
// Règles demandées :
//   1. Les titres de tickets sont toujours EN GRANDS CARACTÈRES (majuscules).
//   2. Format "LIEU : ACTION" — la partie LIEU est TOUJOURS le lieu réellement résolu
//      et validé en base (jamais celui deviné par l'IA, jamais le nom d'une application).
//      Sans lieu validé → préfixe "INDÉTERMINÉ".
const MAX_TITLE_LENGTH = 80;
const UNDETERMINED = 'INDÉTERMINÉ';
const SEPARATOR = ' : ';

// Majuscules francophones (gère les accents : é → É)
function toUpperFr(text) {
  return String(text ?? '').toLocaleUpperCase('fr-FR');
}

/**
 * Formate un titre de ticket : "LIEU : ACTION" en majuscules.
 * @param {string} rawTitle - Titre brut (sujet email ou suggestion IA, éventuellement "SITE : ACTION")
 * @param {string|null} [locationName] - Nom du lieu résolu en base (priorité absolue) ou null
 * @returns {string} Titre en majuscules, max 80 caractères
 */
function formatTicketTitle(rawTitle, locationName = null) {
  const raw = String(rawTitle || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';

  // Séparation site / action sur le premier séparateur " : " ou ": "
  let site = null;
  let action = raw;
  const sepMatch = raw.match(/^([^:]{2,}?)\s*:\s+(.+)$/);
  if (sepMatch) {
    site = sepMatch[1].trim();
    action = sepMatch[2].trim();
  }

  // Le lieu résolu en base écrase toujours le site proposé par l'IA ou l'expéditeur
  const resolvedSite = locationName ? String(locationName).trim() : site;

  const upperAction = toUpperFr(action);
  if (resolvedSite) {
    if (!upperAction) return toUpperFr(resolvedSite).substring(0, MAX_TITLE_LENGTH);
    return `${toUpperFr(resolvedSite)}${SEPARATOR}${upperAction}`.substring(0, MAX_TITLE_LENGTH);
  }
  return upperAction.substring(0, MAX_TITLE_LENGTH);
}

module.exports = { formatTicketTitle, toUpperFr, UNDETERMINED, MAX_TITLE_LENGTH };
