// ── Filtre DLP avant appel au modèle hébergé ───────────────────────────────
// Mesure ANSSI 4.5 (Q-4.5-02) : les données transmises à un modèle hébergé sont
// réputées accessibles au fournisseur. Ce module masque, AVANT sérialisation,
// les données sensibles structurées que l'agent pourrait transmettre sans que
// l'utilisateur ne les ait jamais saisies lui-même (résultats d'outils, corps
// d'e-mail, pièces jointes analysées).
//
// Principes :
//  - filtre déterministe, hors du modèle : le LLM ne peut ni le voir ni le désactiver ;
//  - refus par défaut : activé sauf si AI_DLP_ENABLED=false (dérogation tracée) ;
//  - ne dépend d'aucun fournisseur : appliqué au point d'envoi unique
//    (`callProviderWithFallback`), donc aussi bien au chat qu'aux pipelines e-mail ;
//  - chaque masquage est compté par catégorie, sans jamais journaliser la valeur.
const AI_DLP_TOKENS = Object.freeze({
  IBAN: '[IBAN_MASQUÉ]',
  CARD: '[CARTE_MASQUÉE]',
  NIR: '[NIR_MASQUÉ]',
  PHONE: '[TÉLÉPHONE_MASQUÉ]',
  SECRET: '[SECRET_MASQUÉ]',
});

// Un numéro de carte valide passe le contrôle de Luhn : évite de masquer des
// identifiants numériques arbitraires (n° de ticket, de série…).
function luhnValid(digits) {
  const s = String(digits).replace(/\D/g, '');
  if (s.length < 13 || s.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let d = s.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

// Les e-mails ne sont pas supprimés : l'adresse du demandeur est souvent
// indispensable au raisonnement de l'agent. On masque la partie locale, comme
// le fait déjà `maskEmail()` pour les logs.
function maskEmailAddress(address) {
  const [local, domain] = String(address).split('@');
  if (!domain) return '[EMAIL_MASQUÉ]';
  const head = local.slice(0, 1);
  return `${head}${'*'.repeat(Math.max(2, Math.min(local.length - 1, 6)))}@${domain}`;
}

// Détecteurs ordonnés : du plus spécifique au plus général.
const DETECTORS = [
  {
    type: 'SECRET',
    pattern: /\b(?:api[_-]?key|apikey|secret|token|password|mot\s+de\s+passe|passwd)\b\s*[:=]\s*["']?[^\s"',;}]{4,}/gi,
    replace: () => AI_DLP_TOKENS.SECRET,
  },
  {
    type: 'IBAN',
    // FR + 2 chiffres de contrôle + 23 caractères (BBAN), avec ou sans espaces.
    pattern: /\bFR\d{2}(?:[ ]?[A-Z0-9]{4}){5}[ ]?[A-Z0-9]{3}\b/gi,
    replace: () => AI_DLP_TOKENS.IBAN,
  },
  {
    type: 'NIR',
    // N° de sécurité sociale : sexe(1) + année(2) + mois(2) + département(2/2A/2B) + commune(3) + ordre(3) + clé(2)
    pattern: /\b[12][ ]?\d{2}[ ]?(?:0[1-9]|1[0-2])[ ]?(?:\d{2}|2[AB])[ ]?\d{3}[ ]?\d{3}[ ]?\d{2}\b/gi,
    replace: () => AI_DLP_TOKENS.NIR,
  },
  {
    type: 'CARD',
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    replace: (match) => (luhnValid(match) ? AI_DLP_TOKENS.CARD : match),
  },
  {
    type: 'PHONE',
    pattern: /(?:\+33|0)[\s.-]?[1-9](?:[\s.-]?\d{2}){4}\b/g,
    replace: () => AI_DLP_TOKENS.PHONE,
  },
  {
    type: 'EMAIL',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replace: (match) => maskEmailAddress(match),
  },
];

function parseDisabledTypes(raw) {
  return new Set(
    String(raw || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  );
}

function isDlpEnabled(env = process.env) {
  return String(env.AI_DLP_ENABLED ?? 'true').toLowerCase() !== 'false';
}

/**
 * Masque les données sensibles d'une chaîne.
 * @param {string} input
 * @param {object} [options]
 * @param {Set<string>|string[]} [options.disabledTypes] catégories à ne pas filtrer
 * @returns {{ text: string, findings: Record<string, number> }}
 */
function redactText(input, options = {}) {
  if (typeof input !== 'string' || input.length === 0) {
    return { text: input, findings: {} };
  }

  const disabled = options.disabledTypes instanceof Set
    ? options.disabledTypes
    : new Set(options.disabledTypes || []);
  const findings = {};
  let text = input;

  for (const detector of DETECTORS) {
    if (disabled.has(detector.type)) continue;
    text = text.replace(detector.pattern, (...args) => {
      const match = args[0];
      const replaced = detector.replace(match);
      if (replaced !== match) {
        findings[detector.type] = (findings[detector.type] || 0) + 1;
      }
      return replaced;
    });
  }

  return { text, findings };
}

/**
 * Applique le filtre à un tableau de messages au format OpenAI/Anthropic.
 * Seul le contenu textuel est modifié ; la structure (tool calls, rôles) est intacte.
 * @returns {{ messages: Array, findings: Record<string, number> }}
 */
function redactMessages(messages, options = {}) {
  if (!Array.isArray(messages)) return { messages, findings: {} };
  const findings = {};
  const out = messages.map((msg) => {
    if (!msg || typeof msg !== 'object') return msg;
    if (typeof msg.content === 'string') {
      const res = redactText(msg.content, options);
      mergeFindings(findings, res.findings);
      return { ...msg, content: res.text };
    }
    if (Array.isArray(msg.content)) {
      return {
        ...msg,
        content: msg.content.map((part) => {
          if (part && part.type === 'text' && typeof part.text === 'string') {
            const res = redactText(part.text, options);
            mergeFindings(findings, res.findings);
            return { ...part, text: res.text };
          }
          return part;
        }),
      };
    }
    return msg;
  });
  return { messages: out, findings };
}

function mergeFindings(target, src) {
  for (const [k, v] of Object.entries(src || {})) {
    target[k] = (target[k] || 0) + v;
  }
}

/**
 * Raccourci utilisé au point d'envoi : renvoie le texte filtré et les catégories
 * touchées (jamais les valeurs), pour la trace d'audit.
 */
function redactForModel(input, env = process.env) {
  if (!isDlpEnabled(env)) return { text: input, findings: {}, enabled: false };
  const disabled = parseDisabledTypes(env.AI_DLP_DISABLED_TYPES);
  const res = redactText(input, { disabledTypes: disabled });
  return { ...res, enabled: true };
}

module.exports = {
  AI_DLP_TOKENS,
  DETECTORS,
  isDlpEnabled,
  redactText,
  redactMessages,
  redactForModel,
  maskEmailAddress,
  luhnValid,
};
