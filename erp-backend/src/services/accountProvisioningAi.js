// ── Pré-remplissage IA du formulaire « comptes applicatifs » ────────────────
// L'IA ne décide jamais à la place du technicien : elle propose (applications,
// nombre de comptes, logins/emails) et le formulaire reste entièrement éditable.
//
// Deux étages pour maîtriser coût et fiabilité :
//   1. Pré-filtre déterministe (mots-clés + alias du catalogue). Si le ticket ne
//      parle manifestement pas de comptes, aucun appel IA n'est fait.
//   2. Extraction structurée JSON (un seul appel court) avec liste FERMÉE
//      d'applications : toute application hors catalogue est ignorée, jamais
//      inventée. En cas d'échec IA, on retombe proprement sur le pré-filtre.
const prisma = require('../prismaClient');
const { getSystemSettings } = require('./systemSettings');
const { callAI } = require('./aiTicketComparison');
const { htmlToText } = require('../utils/htmlToText');
const { logger } = require('../utils/logger');

const MAX_TEXT_LENGTH = 6000;
const MAX_FOLLOWUPS = 8;

const ACCOUNT_KEYWORD_RE = /\b(compte|comptes|acc[eè]s|identifiant|identifiants|login|logins|utilisateur|utilisateurs|habilitation|habilitations|mot de passe|profil)\b/i;
const CREATION_KEYWORD_RE = /\b(cr[ée][ée]e?|cr[ée]ation|cr[ée]er|ouvert|ouverte|ajout[ée]e?|param[ée]tr[ée]e?|activ[ée]e?|mise en place|mis en place)(?![a-z0-9])/i;

// Le module ne se limite pas aux créations : une mise à jour de droits sur un
// compte existant est aussi une opération d'administration à tracer. Il faut
// néanmoins une preuve explicite (« droits ajoutés », « accès accordé ») pour
// distinguer un travail réalisé d'une simple demande.
const RIGHTS_KEYWORD_RE = /\b(droits?|habilitations?|permissions?|privil[eè]ges?|r[oô]les?|acc[eè]s)\b/i;
const RIGHTS_ATTESTATION_RE = /\b(ajout[ée]{1,2}s?|accord[ée]{1,2}s?|octroy[ée]{1,2}s?|attribu[ée]{1,2}s?|modifi[ée]{1,2}s?|chang[ée]{1,2}s?|augment[ée]{1,2}s?|[ée]tendu[e]?s?|donn[ée]{1,2}s?|retir[ée]{1,2}s?|r[ée]voqu[ée]{1,2}s?|supprim[ée]{1,2}s?|mise? à jour|mis à jour)(?![a-z0-9])/i;

// Le pré-filtre déterministe ne comprend pas le sens d'une phrase, mais il peut
// éviter les deux erreurs les plus fréquentes sans appeler l'IA :
//   • une NÉGATION (« aucun compte créé », « compte déjà existant ») ;
//   • une DEMANDE au futur/impératif (« merci de créer », « création de compte »)
//     qui ne prouve pas que le travail a été fait.
// Les regex sont volontairement étroites (fenêtres courtes) pour ne pas casser
// une phrase comme « aucun problème, le compte a été créé ».
const NEGATION_RE = new RegExp(
  [
    '\\baucun[e]?\\s+(?:de\\s+)?(?:compte|acc[eè]s|identifiant|login|cr[ée]ation|droit|habilitation|permission)',
    '\\bpas\\s+(?:de\\s+|d[\'’])?(?:compte|acc[eè]s|identifiant|login|cr[ée]ation|droit|habilitation|permission)',
    '\\bsans\\s+(?:compte|acc[eè]s|identifiant|login|cr[ée]ation|droit|habilitation|permission)',
    '\\b(?:compte|acc[eè]s|identifiant|login)[^.\\n]{0,20}\\b(?:d[ée]j[àa]\\s+existant|existant|existait)',
    '\\brien\\s+(?:de\\s+)?(?:cr[ée][ée]|à\\s+cr[ée]er)',
    '\\baucun(?:e)?\\s+(?:modification|changement)\\s+(?:de\\s+)?(?:droit|habilitation|permission)',
  ].join('|'),
  'i'
);
const ATTESTATION_RE = /\b(cr[ée][ée]|cr[ée][ée]e|cr[ée][ée]s|cr[ée][ée]es|cree|creee|ajout[ée]|ajout[ée]e|ajout[ée]s|ajout[ée]es|param[ée]tr[ée]|param[ée]tr[ée]e|activ[ée]|activ[ée]e|activ[ée]s|activ[ée]es|ouvert|ouverte|ouverts|ouvertes|transmis|transmise|install[ée]|install[ée]e|d[ée]ploy[ée]|d[ée]ploy[ée]e|effectu[ée]|effectu[ée]e|r[ée]alis[ée]|r[ée]alis[ée]e|mis en place|mise en place)(?![a-z0-9])/i;
const REQUEST_RE = /\b(merci de|il faut|besoin d|demande de|demand[ée]e?|à cr[ée]er|cr[ée]er|ouverture de|ouvrir|cr[ée]ation de)\b/i;

function normalizeForMatch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Détecte les applications du catalogue citées dans le texte (nom ou alias exacts).
 *
 * Résolution de chevauchement : quand plusieurs alias se recouvrent, le PLUS LONG
 * gagne. Sans ça, « Sage Paie » remontait aussi « Sage X3 » (alias « sage »), et
 * « Sage X3 » remontait l'alias « x3 » deux fois. Priorité au libellé le plus
 * spécifique, puis dédoublonnage par application, dans l'ordre du texte.
 */
function detectApplications(text, catalog) {
  const normalizedText = normalizeForMatch(text);
  const hits = [];

  for (const app of catalog) {
    const candidates = [...new Set(
      [app.name, ...(Array.isArray(app.aliases) ? app.aliases : [])]
        .map(normalizeForMatch)
        .filter((candidate) => candidate.length >= 2)
    )];

    for (const candidate of candidates) {
      const re = new RegExp(`(^|[^a-z0-9])${escapeRegex(candidate)}([^a-z0-9]|$)`, 'g');
      let match;
      while ((match = re.exec(normalizedText)) !== null) {
        const start = match.index + match[1].length;
        hits.push({ id: app.id, name: app.name, start, end: start + candidate.length });
        // Sécurité anti-boucle infinie (match de longueur nulle impossible ici, mais
        // on protège l'itérateur si un alias vide passait malgré le filtre).
        if (re.lastIndex <= start) re.lastIndex = start + candidate.length;
      }
    }
  }

  // Les correspondances les plus longues sont retenues en premier ; toute
  // correspondance qui chevauche une zone déjà couverte est écartée.
  hits.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const accepted = [];
  for (const hit of hits) {
    const overlaps = accepted.some((kept) => hit.start < kept.end && hit.end > kept.start);
    if (!overlaps) accepted.push(hit);
  }

  const seen = new Set();
  return accepted
    .sort((a, b) => a.start - b.start)
    .filter((hit) => {
      if (seen.has(hit.id)) return false;
      seen.add(hit.id);
      return true;
    })
    .map((hit) => ({ id: hit.id, name: hit.name }));
}

function buildTicketText(ticket, followups = []) {
  const parts = [ticket?.title || '', htmlToText(ticket?.content || '')];
  const recent = [...followups]
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-MAX_FOLLOWUPS);
  for (const followup of recent) {
    parts.push(htmlToText(followup.content || ''));
  }
  return parts.filter(Boolean).join('\n---\n').slice(0, MAX_TEXT_LENGTH);
}

/**
 * Pré-remplissage déterministe, sans IA. Toujours disponible, même quand l'IA est
 * désactivée ou en échec.
 */
function buildDeterministicPrefill(ticket, followups, catalog) {
  const text = buildTicketText(ticket, followups);
  const applications = detectApplications(text, catalog);
  const mentionsAccount = ACCOUNT_KEYWORD_RE.test(text);
  const mentionsCreation = CREATION_KEYWORD_RE.test(text);
  const mentionsNegation = NEGATION_RE.test(text);
  const mentionsAttestation = ATTESTATION_RE.test(text);
  const mentionsRequest = REQUEST_RE.test(text);
  const mentionsRightsUpdate = RIGHTS_KEYWORD_RE.test(text) && RIGHTS_ATTESTATION_RE.test(text);

  const applicationReason = applications.length > 0
    ? `Applications détectées dans le ticket : ${applications.map((a) => a.name).join(', ')}.`
    : 'Aucune application du catalogue explicitement citée : sélection manuelle requise.';

  let isAccountProvisioning = false;
  let confidence = 0.05;
  let reason = applicationReason;

  if (!mentionsAccount && applications.length === 0) {
    // Ticket manifestement hors sujet : rien à proposer, aucun appel IA ne sera fait.
  } else if (mentionsNegation) {
    confidence = 0.15;
    reason = 'Négation détectée : aucune création de compte n’est attestée.';
  } else if (mentionsAttestation) {
    isAccountProvisioning = true;
    confidence = applications.length > 0 ? 0.65 : 0.5;
    reason = applicationReason;
  } else if (mentionsRightsUpdate) {
    // Droits modifiés sur un compte existant : c'est une opération à déclarer,
    // au même titre qu'une création, mais avec une preuve un peu plus faible.
    isAccountProvisioning = true;
    confidence = applications.length > 0 ? 0.6 : 0.45;
    reason = 'Mise à jour de droits attestée sur un compte existant.';
  } else if (mentionsRequest) {
    // « Merci de créer… » est une demande : sans suivi attestant la réalisation,
    // on ne pré-remplit pas de comptes (le formulaire reste utilisable à la main).
    confidence = 0.2;
    reason = 'Demande de création détectée, sans preuve de réalisation dans le ticket.';
  } else {
    // Sans verbe de création ni preuve, la simple présence d'un mot « compte »
    // et d'une application ne suffit pas : on reste prudent (l'IA tranchera).
    isAccountProvisioning = mentionsAccount && mentionsCreation;
    confidence = isAccountProvisioning
      ? (applications.length > 0 ? 0.5 : 0.35)
      : (mentionsAccount ? 0.2 : 0.05);
  }

  return {
    isAccountProvisioning,
    confidence,
    accounts: [],
    applications,
    ignoredApplications: [],
    aiUsed: false,
    reason,
  };
}

function extractJsonObject(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let text = raw.trim();
  // Retire les fences Markdown éventuelles (```json … ```).
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    return JSON.parse(text.slice(first, last + 1));
  } catch {
    return null;
  }
}

/** Mappe un nom/alias renvoyé par l'IA vers une application du catalogue. */
function mapApplication(rawName, catalog) {
  const normalized = normalizeForMatch(rawName);
  if (!normalized) return null;
  const byName = catalog.find((a) => normalizeForMatch(a.name) === normalized);
  if (byName) return byName;
  return catalog.find((a) =>
    (Array.isArray(a.aliases) ? a.aliases : []).some((alias) => normalizeForMatch(alias) === normalized)
  ) || null;
}

function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
}

/**
 * Valide la réponse IA contre le catalogue. Exporté pour les tests unitaires.
 * Toute application inconnue est écartée : l'IA ne peut pas créer une application.
 */
function parseAiSuggestion(raw, catalog) {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'Réponse IA illisible (JSON invalide).' };
  }

  const rawAccounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
  const accounts = [];
  const ignoredApplications = [];
  // Noms vus deux fois (ligne de compte + champ dédié) : on ne les répète pas.
  const seenIgnored = new Set();
  const pushIgnored = (value) => {
    const name = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!name) return;
    const key = normalizeForMatch(name);
    if (!key || seenIgnored.has(key)) return;
    // Une application connue du catalogue n'est jamais un candidat.
    if (mapApplication(name, catalog)) return;
    seenIgnored.add(key);
    ignoredApplications.push(name);
  };

  for (const raw of rawAccounts.slice(0, 50)) {
    if (!raw || typeof raw !== 'object') continue;
    const appName = raw.application || raw.applicationName || raw.applicatif || '';
    const application = mapApplication(appName, catalog);
    if (!application) {
      pushIgnored(appName);
      continue;
    }

    const quantityRaw = Number(raw.quantity ?? raw.quantite ?? 1);
    const quantity = Number.isInteger(quantityRaw) && quantityRaw >= 1 && quantityRaw <= 500 ? quantityRaw : 1;
    const typeRaw = String(raw.type || raw.accountType || 'NOMINAL').toUpperCase();
    const type = ['NOMINAL', 'ADMIN', 'SERVICE', 'PARTAGE', 'AUTRE'].includes(typeRaw) ? typeRaw : 'NOMINAL';
    // `operation` distingue une création d'une modification de droits. Absent de
    // la réponse ⇒ création, comportement historique.
    const operationRaw = String(raw.operation || raw.operationType || '').trim().toUpperCase();
    const operation = ['CREATION', 'DROITS'].includes(operationRaw) ? operationRaw : 'CREATION';

    accounts.push({
      applicationId: application.id,
      applicationName: application.name,
      operation,
      login: String(raw.login || raw.identifiant || '').trim().slice(0, 120),
      email: String(raw.email || '').trim().slice(0, 254),
      profile: String(raw.profile || raw.profil || raw.role || '').trim().slice(0, 120),
      rights: String(raw.rights || raw.droit || raw.droits || '').trim().slice(0, 200),
      type,
      // Une modification de droits porte sur un compte nommé : quantité = 1.
      quantity: operation === 'DROITS' ? 1 : quantity,
    });
  }

  const applicationsMap = new Map();
  for (const account of accounts) {
    applicationsMap.set(account.applicationId, { id: account.applicationId, name: account.applicationName });
  }

  // Applications explicitement citées mais absentes du catalogue : collectées à
  // part pour alimenter la file de candidats (l'IA ne les crée jamais).
  for (const value of Array.isArray(parsed.unknownApplications) ? parsed.unknownApplications.slice(0, 20) : []) {
    pushIgnored(value && typeof value === 'object' ? (value.name || value.application) : value);
  }

  return {
    ok: true,
    // Un booléen explicite fait foi ; sinon on retombe sur la présence de comptes.
    isAccountProvisioning: typeof parsed.isAccountProvisioning === 'boolean'
      ? parsed.isAccountProvisioning
      : accounts.length > 0,
    confidence: clampConfidence(parsed.confidence) ?? (accounts.length > 0 ? 0.7 : 0.3),
    accounts,
    applications: Array.from(applicationsMap.values()),
    ignoredApplications: ignoredApplications.slice(0, 30),
    // Preuve textuelle : affichée au technicien, elle rend la proposition vérifiable.
    evidence: String(parsed.evidence || parsed.preuve || '').trim().slice(0, 500),
    reason: String(parsed.reason || parsed.evidence || '').slice(0, 500),
  };
}

// Schéma de sortie structurée : élimine les échecs de parsing JSON côté Gemini
// (responseSchema) et sert de contrat pour les autres providers.
const AI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isAccountProvisioning: { type: 'BOOLEAN' },
    confidence: { type: 'NUMBER' },
    reason: { type: 'STRING' },
    evidence: { type: 'STRING' },
    accounts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          application: { type: 'STRING' },
          operation: { type: 'STRING', enum: ['CREATION', 'DROITS'] },
          login: { type: 'STRING' },
          email: { type: 'STRING' },
          profile: { type: 'STRING' },
          rights: { type: 'STRING' },
          type: { type: 'STRING', enum: ['NOMINAL', 'ADMIN', 'SERVICE', 'PARTAGE', 'AUTRE'] },
          quantity: { type: 'INTEGER' },
        },
        required: ['application', 'operation'],
      },
    },
    unknownApplications: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
  },
  required: ['isAccountProvisioning', 'confidence', 'accounts'],
};

// En dessous de ce seuil, on propose les applications mais pas les comptes :
// mieux vaut une saisie manuelle qu'un pré-remplissage douteux.
const MIN_ACCOUNTS_CONFIDENCE = 0.6;

function buildPrompt({ ticket, followups, catalog }) {
  const catalogLines = catalog
    .map((app) => `- ${app.name}${Array.isArray(app.aliases) && app.aliases.length ? ` (alias: ${app.aliases.join(', ')})` : ''}`)
    .join('\n');

  return `Tu analyses un ticket de support informatique pour pré-remplir un formulaire de déclaration d'opérations sur des comptes applicatifs.

CATALOGUE D'APPLICATIONS AUTORISÉES (liste fermée, n'invente rien d'autre) :
${catalogLines || '(catalogue vide)'}

TEXTE DU TICKET ET DES DERNIERS SUIVIS (du plus ancien au plus récent) :
"""
${buildTicketText(ticket, followups)}
"""

CONSIGNES :
1. Détermine si une opération d'administration de comptes a RÉELLEMENT eu lieu, parmi deux natures :
   - CREATION : un compte a été créé ou activé ;
   - DROITS : les droits, permissions ou le profil d'un compte DÉJÀ EXISTANT ont été modifiés (ajout, retrait, extension).
   Une simple demande (« merci de créer », « il faudrait donner accès »), un diagnostic, un compte déjà existant sans changement, ne comptent PAS.
2. Le suivi le plus récent du technicien fait foi : c'est lui qui atteste de ce qui a été fait.
3. Identifie chaque opération distincte. Si le texte dit « les comptes de l'équipe (5 personnes) », renvoie une création avec quantity=5. Si deux personnes ou deux applications sont citées, renvoie deux entrées.
4. Pour une opération DROITS, renseigne le compte cible dans "login" ou "email", et décris le droit accordé dans "rights" (texte court, ex. « accès module Paie », « validation des factures ») et/ou le profil dans "profile". La quantité d'une opération DROITS vaut toujours 1.
5. L'application DOIT être l'un des noms exacts du catalogue. Si elle n'est pas identifiable, laisse "application": "" et baisse la confiance. N'invente jamais une application.
6. N'inclus JAMAIS de mot de passe, même si le texte en contient.
7. "evidence" doit citer MOT POUR MOT l'extrait du texte qui prouve l'opération. Chaîne vide si aucune preuve.
8. "confidence" est un nombre entre 0 et 1.
9. "unknownApplications" liste les logiciels explicitement nommés dans le texte qui ne figurent PAS dans le catalogue et pour lesquels une opération de compte a réellement eu lieu (ex. « SAP R/3 », « CRM maison »). Reprends le nom tel qu'écrit. Tableau vide si tout est au catalogue. N'y mets jamais un nom du catalogue.

EXEMPLES :
- « Merci de créer un compte Sage X3 pour M. Doe » (demande du demandeur, aucun suivi) → isAccountProvisioning=false, evidence="".
- « Compte Sage X3 créé pour M. Doe, identifiants remis en main propre » → isAccountProvisioning=true, accounts=[{application:"Sage X3", operation:"CREATION", login:"", profile:"", quantity:1}], evidence="Compte Sage X3 créé pour M. Doe".
- « Les 5 comptes m365 du service ont été ouverts » → isAccountProvisioning=true, accounts=[{application:"Microsoft 365", operation:"CREATION", quantity:5}].
- « Droits de validation ajoutés à j.doe sur Sage Paie » → isAccountProvisioning=true, accounts=[{application:"Sage Paie", operation:"DROITS", login:"j.doe", rights:"Validation des bulletins", quantity:1}], evidence="Droits de validation ajoutés à j.doe sur Sage Paie".
- « Merci de donner les droits de consultation Odoo à j.doe » (demande sans suivi) → isAccountProvisioning=false.
- « L'utilisateur avait déjà un compte Odoo, rien créé » → isAccountProvisioning=false.
- « Compte SAP R/3 créé pour j.doe » → isAccountProvisioning=true, accounts=[{application:"", operation:"CREATION", login:"j.doe", quantity:1}], unknownApplications=["SAP R/3"], confidence=0.6, evidence="Compte SAP R/3 créé pour j.doe".

Réponds UNIQUEMENT avec ce JSON, sans commentaire :
{
  "isAccountProvisioning": true|false,
  "confidence": 0.0,
  "reason": "justification courte en français",
  "evidence": "extrait exact du texte, ou chaîne vide",
  "accounts": [
    {
      "application": "nom exact du catalogue ou chaîne vide",
      "operation": "CREATION|DROITS",
      "login": "identifiant du compte (ou du compte cible) si connu, sinon ''",
      "email": "email si connu, sinon ''",
      "profile": "profil/rôle si connu, sinon ''",
      "rights": "droit précis accordé si operation=DROITS, sinon ''",
      "type": "NOMINAL|ADMIN|SERVICE|PARTAGE|AUTRE",
      "quantity": 1
    }
  ],
  "unknownApplications": ["logiciel cité hors catalogue"]
}`;
}

/**
 * Analyse un ticket pour pré-remplir le formulaire. Ne lève jamais : renvoie
 * toujours une proposition (éventuellement vide) et un drapeau aiUsed.
 */
async function suggestProvisioning({ ticketId, user } = {}) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: Number(ticketId) },
    select: { id: true, title: true, content: true, status: true, deletedAt: true },
  });
  if (!ticket || ticket.deletedAt) {
    const err = new Error('Ticket introuvable.');
    err.statusCode = 404;
    throw err;
  }

  const [catalog, followups, settings] = await Promise.all([
    prisma.applicationCatalog.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    prisma.followup.findMany({
      where: { ticketId: ticket.id },
      select: { content: true, createdAt: true, isPrivate: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_FOLLOWUPS,
    }),
    getSystemSettings(),
  ]);

  const fallback = buildDeterministicPrefill(ticket, followups, catalog);

  const aiAllowed =
    settings.aiEnabled !== false &&
    settings.aiKillSwitch !== true &&
    settings.accountProvisioningAiPrefill !== false &&
    catalog.length > 0;

  // Pré-filtre : aucun mot-clé « compte/accès » et aucune application citée → inutile
  // de dépenser un appel IA sur un ticket qui n'a rien à voir.
  const text = buildTicketText(ticket, followups);
  if (!aiAllowed || (!ACCOUNT_KEYWORD_RE.test(text) && fallback.applications.length === 0)) {
    return {
      ...fallback,
      ticketId: ticket.id,
      fallback: true,
      classifier: 'DETERMINISTIC',
      evidence: '',
      lowConfidence: false,
    };
  }

  try {
    const raw = await callAI(buildPrompt({ ticket, followups, catalog }), 900, { jsonSchema: AI_RESPONSE_SCHEMA });
    const parsed = parseAiSuggestion(raw, catalog);
    if (!parsed.ok) {
      logger.warn(`[accountProvisioning][ai] Réponse invalide ticket ${ticket.id}: ${parsed.reason}`);
      return {
        ...fallback,
        ticketId: ticket.id,
        fallback: true,
        classifier: 'DETERMINISTIC',
        aiError: parsed.reason,
        evidence: '',
        lowConfidence: false,
      };
    }

    // Quand l'IA a répondu, c'est elle qui tranche la classification : le pré-filtre
    // déterministe ne sert que de filet quand l'IA est indisponible. On garde malgré
    // tout les applications détectées par alias si l'IA en oublie une.
    const lowConfidence = parsed.confidence < MIN_ACCOUNTS_CONFIDENCE;
    const accounts = parsed.isAccountProvisioning && !lowConfidence ? parsed.accounts : [];
    const applications = parsed.isAccountProvisioning
      ? (parsed.applications.length > 0 ? parsed.applications : fallback.applications)
      : [];

    return {
      ticketId: ticket.id,
      isAccountProvisioning: parsed.isAccountProvisioning,
      confidence: parsed.confidence,
      accounts,
      applications,
      ignoredApplications: parsed.ignoredApplications || [],
      evidence: parsed.evidence,
      reason: parsed.reason || fallback.reason,
      lowConfidence,
      classifier: 'AI',
      aiUsed: true,
      fallback: false,
      // Conservé pour l'UI : applications vues par les alias, même si l'IA conclut
      // qu'il n'y a pas eu de création (le technicien garde l'information).
      deterministicApplications: fallback.applications,
    };
  } catch (err) {
    logger.warn(`[accountProvisioning][ai] Échec ticket ${ticket.id}: ${err.message}`);
    return {
      ...fallback,
      ticketId: ticket.id,
      fallback: true,
      classifier: 'DETERMINISTIC',
      aiError: err.message,
      evidence: '',
      lowConfidence: false,
    };
  }
}

module.exports = {
  suggestProvisioning,
  parseAiSuggestion,
  buildDeterministicPrefill,
  detectApplications,
  AI_RESPONSE_SCHEMA,
  MIN_ACCOUNTS_CONFIDENCE,
};
