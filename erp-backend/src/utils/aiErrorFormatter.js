// Formate proprement les erreurs renvoyées par les providers d'IA (Gemini, OpenAI,
// Anthropic, Mistral, NVIDIA…) afin de ne plus exposer le corps brut des réponses
// d'erreur (gros objets JSON difficiles à lire). On extrait uniquement les infos
// utiles : fournisseur, code HTTP, catégorie d'erreur, message court, limite de
// quota concernée et délai avant nouvelle tentative. La réponse brute reste
// disponible en logs (debug).

const MAX_MESSAGE_LENGTH = 260;

// Catégories lisibles déduites du code HTTP
const CATEGORY_BY_STATUS = {
  400: 'Requête invalide',
  401: 'Authentification invalide',
  402: 'Paiement requis',
  403: 'Accès refusé',
  404: 'Ressource introuvable',
  408: 'Temps de réponse dépassé',
  409: 'Conflit',
  413: 'Requête trop volumineuse',
  422: 'Données invalides',
  429: 'Quota ou limite de débit atteint',
  500: 'Erreur interne du service',
  502: 'Service indisponible',
  503: 'Service indisponible (surchargé)',
  504: 'Délai dépassé côté fournisseur',
};

// Catégories déduites des codes d'erreur JSON (champs error.status / error.code)
const CATEGORY_BY_CODE_PATTERN = [
  { pattern: /UNAUTHENTICATED|PERMISSION_DENIED|INVALID_API_KEY|API_KEY/i, label: 'Authentification invalide' },
  { pattern: /RESOURCE_EXHAUSTED|RATE_LIMIT/i, label: 'Quota ou limite de débit atteint' },
  { pattern: /UNAVAILABLE|OVERLOADED|DEADLINE_EXCEEDED|TIMEOUT/i, label: 'Service indisponible' },
  { pattern: /NOT_FOUND|DOES_NOT_EXIST/i, label: 'Ressource introuvable (clé ou modèle invalide)' },
  { pattern: /INVALID_ARGUMENT|BAD_REQUEST|FAILED_PRECONDITION|BILLING/i, label: 'Requête invalide' },
];

// Convertit un nombre de secondes en durée lisible (ex: 37222 → "10h 20m")
function formatDuration(totalSeconds) {
  const total = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (!total) return null;
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  const parts = [];
  if (days) parts.push(`${days}j`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds && !days && !hours) parts.push(`${seconds}s`);
  return parts.join(' ');
}

// Tente de parser le corps de réponse comme JSON (les fournisseurs renvoient souvent un gros objet)
function tryParseJson(body) {
  if (!body || typeof body !== 'string') return null;
  const trimmed = body.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

// Extrait le délai de re-tentative (en secondes) annoncé par le fournisseur.
// Gemini : error.details[].retryDelay ; d'autres renvoient un header Retry-After.
function extractRetryDelay(parsed) {
  const details = parsed?.error?.details;
  if (Array.isArray(details)) {
    for (const d of details) {
      if (d && d.retryDelay !== undefined) {
        const seconds = parseFloat(String(d.retryDelay));
        if (!Number.isNaN(seconds) && seconds > 0) return seconds;
      }
    }
  }
  return null;
}

// Extrait la limite de quota concernée (métrique + modèle) depuis les violations
// détaillées renvoyées par Gemini, avec un fallback textuel sur error.message.
function extractQuotaInfo(parsed) {
  if (parsed?.error?.details && Array.isArray(parsed.error.details)) {
    for (const d of parsed.error.details) {
      for (const v of d?.violations || []) {
        if (v?.quotaMetric) {
          return {
            metric: String(v.quotaMetric).split('/').pop(),
            model: v.quotaDimensions?.model || '',
          };
        }
      }
    }
  }
  // Fallback : motif textuel présent dans certains messages Gemini
  const msg = String(parsed?.error?.message || '');
  const metricMatch = msg.match(/metric:\s*([\w.]+)/i);
  const modelMatch = msg.match(/model:\s*([\w.\-]+)/i);
  if (metricMatch || modelMatch) {
    return { metric: metricMatch ? metricMatch[1] : '', model: modelMatch ? modelMatch[1] : '' };
  }
  return null;
}

// Nettoie un message : espaces multiples, retours à la ligne inutiles, troncature.
function cleanMessage(message, maxLength = MAX_MESSAGE_LENGTH) {
  const cleaned = String(message || '')
    .replace(/\r\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1)}…`;
}

// Point d'entrée principal : formate une erreur HTTP d'un provider d'IA.
// Exemple de sortie :
//   [Google Gemini] Quota ou limite de débit atteint (HTTP 429) : You exceeded your
//   current quota… — Limite concernée : generate_requests_per_model_per_day
//   (gemini-omni-1.1-flash) — Nouvelle tentative possible dans environ 10h 20m
function formatProviderHttpError({ provider, label, status, body } = {}) {
  const providerLabel = label || provider?.label || provider?.name || 'Provider IA';
  const statusCode = Number(status) || 0;
  const responseBody = String(body || '');
  const parsed = tryParseJson(responseBody);

  // Message lisible : champ error.message des API, sinon le corps brut nettoyé
  let message = String(parsed?.error?.message || parsed?.message || responseBody || '').trim();
  if ((message.startsWith('"') && message.endsWith('"')) || (message.startsWith("'") && message.endsWith("'"))) {
    message = message.slice(1, -1).trim();
  }
  message = cleanMessage(message);

  // Catégorie : d'abord le code d'erreur JSON (plus précis), puis le code HTTP
  const errorCode = String(parsed?.error?.status || parsed?.error?.code || parsed?.code || '');
  let category = CATEGORY_BY_STATUS[statusCode] || 'Erreur';
  for (const { pattern, label: catLabel } of CATEGORY_BY_CODE_PATTERN) {
    if (pattern.test(errorCode)) {
      category = catLabel;
      break;
    }
  }
  // Certains fournisseurs renvoient "Quota exceeded" avec un statut 400
  if (/quota|rate limit|trop de requêtes/i.test(message) && statusCode !== 429) {
    category = 'Quota ou limite de débit atteint';
  }

  const retrySeconds = extractRetryDelay(parsed);
  const retryLabel = retrySeconds ? formatDuration(retrySeconds) : null;
  const quota = extractQuotaInfo(parsed);

  const parts = [`[${providerLabel}] ${category} (HTTP ${statusCode || '—'})`];
  if (message) parts.push(message);
  if (quota && (quota.metric || quota.model)) {
    parts.push(`Limite concernée : ${[quota.model, quota.metric].filter(Boolean).join(' — ')}`);
  }
  if (retryLabel) parts.push(`Nouvelle tentative possible dans environ ${retryLabel}`);
  return parts.join(' — ');
}

// Compacte un message d'erreur arbitraire (sécurité pour les erreurs non-HTTP ou
// déjà levées ailleurs) : extrait le champ "message" d'un éventuel JSON embarqué,
// sinon tronque proprement le texte.
function compactErrorMessage(message, maxLength = 800) {
  const text = String(message || 'Erreur inconnue');
  if (text.length <= maxLength) return text;

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const parsed = tryParseJson(text.slice(start, end + 1));
    const extracted = parsed?.error?.message || parsed?.message;
    if (extracted) return cleanMessage(extracted);
  }
  return cleanMessage(text, maxLength);
}

module.exports = { formatProviderHttpError, formatDuration, compactErrorMessage };