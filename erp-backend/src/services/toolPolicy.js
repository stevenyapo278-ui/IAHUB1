// ── Passerelle d'autorisation des outils de l'agent ─────────────────────
// Point d'application de politique UNIQUE, indépendant du modèle : tout outil exécuté
// par le chatbot texte ou l'assistant vocal passe par ici avant de toucher une ressource.
//
// Principes :
//  - refus par défaut : un outil absent du registre n'est jamais exécuté ;
//  - le modèle ne peut ni modifier ni contourner cette politique (elle est côté serveur) ;
//  - trois interrupteurs d'arrêt, actionnables sans redémarrage :
//      SystemSettings.aiKillSwitch    → arrêt total (aucun appel IA, aucun outil)
//      SystemSettings.aiWritesEnabled → coupe les actions d'écriture/externes
//      SystemSettings.aiDisabledTools → liste de refus explicite par outil
//  - toute décision refusée sur un outil sensible est auditée (AI_TOOL_DENIED).
const { getSystemSettings } = require('./systemSettings');
const { auditLog } = require('./auditLogService');
const { hasPermission } = require('../middleware/permissions');
const { logger } = require('../utils/logger');

const READ = 'read';
const WRITE = 'write';
const EXTERNAL = 'external';

// Registre des outils connus. `kind` pilote l'interrupteur appliqué :
//   read     → toujours autorisé (si l'utilisateur est authentifié)
//   write    → exige authenticated + aiWritesEnabled
//   external → exige authenticated + aiWritesEnabled + permission dédiée
// `risk` sert à décider si une exécution réussie mérite une trace d'audit.
const TOOL_REGISTRY = Object.freeze({
  // ── Lecture / recherche ────────────────────────────────────────────────
  ask_assistant: { kind: READ, risk: 1 },
  get_context: { kind: READ, risk: 1, allowAnonymous: true },
  search_tickets: { kind: READ, risk: 1 },
  check_ticket: { kind: READ, risk: 1 },
  get_ticket_summary: { kind: READ, risk: 1 },
  get_ticket_count: { kind: READ, risk: 1 },
  get_ticket_links: { kind: READ, risk: 1 },
  get_ticket_time_entries: { kind: READ, risk: 1 },
  find_similar_tickets: { kind: READ, risk: 1 },
  search_users: { kind: READ, risk: 2 },
  search_teams: { kind: READ, risk: 1 },
  search_locations: { kind: READ, risk: 1 },
  search_inventory: { kind: READ, risk: 1 },
  search_knowledge: { kind: READ, risk: 1 },
  search_emails: { kind: READ, risk: 2 },
  get_top_locations: { kind: READ, risk: 1 },
  get_top_technicians: { kind: READ, risk: 1 },
  get_team_report: { kind: READ, risk: 1 },
  get_category_distribution: { kind: READ, risk: 1 },
  analyze_root_cause: { kind: READ, risk: 2 },
  generate_report: { kind: READ, risk: 1 },

  // ── Écriture (modifie l'état de la plateforme) ─────────────────────────
  create_ticket: { kind: WRITE, risk: 2, idempotent: true },
  change_ticket_status: { kind: WRITE, risk: 3 },
  assign_ticket: { kind: WRITE, risk: 3 },
  update_ticket_status: { kind: WRITE, risk: 3 },
  add_ticket_followup: { kind: WRITE, risk: 2, idempotent: true },

  // ── Effet externe (sort de la plateforme) ─────────────────────────────
  send_ticket_report: {
    kind: EXTERNAL,
    risk: 3,
    idempotent: true,
    permission: 'automation.manage',
  },
});

// Cache court : la politique est lue à CHAQUE appel d'outil (donc à chaque tour de
// conversation) mais les réglages changent rarement. 2 s suffisent à propager un arrêt
// d'urgence sans marteler la base ; invalidatePolicyCache() court-circuite l'attente.
const CACHE_TTL_MS = 2000;
let cache = { at: 0, settings: null };

async function loadPolicy() {
  if (cache.settings && Date.now() - cache.at < CACHE_TTL_MS) return cache.settings;
  try {
    const settings = await getSystemSettings();
    cache = { at: Date.now(), settings };
    return settings;
  } catch (err) {
    // Fail-closed : si la politique est illisible, on refuse les actions sensibles
    // mais on laisse passer la lecture (sinon l'assistant devient totalement muet).
    logger.error(`[toolPolicy] Lecture de la politique impossible : ${err.message}`);
    const fallback = { aiEnabled: true, aiKillSwitch: false, aiWritesEnabled: true, aiDisabledTools: [] };
    cache = { at: Date.now(), settings: fallback };
    return fallback;
  }
}

function invalidatePolicyCache() {
  cache = { at: 0, settings: null };
}

async function isKillSwitchActive() {
  const settings = await loadPolicy();
  return settings.aiKillSwitch === true;
}

function normalizeUser(user) {
  if (!user) return null;
  const id = Number(user.sub ?? user.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return { id, role: user.role || null, email: user.email || null, sub: id, roles: user.roles || null };
}

async function auditDenied({ tool, code, user, source }) {
  try {
    await auditLog('AI_TOOL_DENIED', {
      actor: user ? { id: user.id, email: user.email } : null,
      targetType: 'Tool',
      targetLabel: tool,
      metadata: { tool, code, source: source || 'chat' },
    });
  } catch (err) {
    logger.warn(`[toolPolicy] Audit du refus impossible : ${err.message}`);
  }
}

async function auditGranted({ tool, user, source }) {
  try {
    await auditLog('AI_TOOL_EXECUTED', {
      actor: user ? { id: user.id, email: user.email } : null,
      targetType: 'Tool',
      targetLabel: tool,
      metadata: { tool, source: source || 'chat' },
    });
  } catch (err) {
    logger.warn(`[toolPolicy] Audit de l'exécution impossible : ${err.message}`);
  }
}

/**
 * Évalue une demande d'exécution d'outil. Ne lève jamais : renvoie une décision.
 * @returns {Promise<{allowed: boolean, code?: string, message?: string, tool?: object}>}
 */
async function authorizeToolCall({ tool, user, source = 'chat' }) {
  const name = String(tool || '');
  const definition = TOOL_REGISTRY[name];
  const actor = normalizeUser(user);

  if (!definition) {
    // Refus par défaut : le modèle ne peut pas inventer un outil.
    logger.warn(`[toolPolicy] Outil inconnu refusé : ${name} (source=${source})`);
    await auditDenied({ tool: name, code: 'UNKNOWN_TOOL', user: actor, source });
    return {
      allowed: false,
      code: 'UNKNOWN_TOOL',
      message: "Cette action n'est pas disponible.",
    };
  }

  const settings = await loadPolicy();

  if (settings.aiKillSwitch === true) {
    await auditDenied({ tool: name, code: 'KILL_SWITCH', user: actor, source });
    return {
      allowed: false,
      code: 'KILL_SWITCH',
      message: "L'assistant est temporairement désactivé par l'administrateur. Aucune action ne peut être exécutée.",
    };
  }

  if (Array.isArray(settings.aiDisabledTools) && settings.aiDisabledTools.includes(name)) {
    await auditDenied({ tool: name, code: 'TOOL_DISABLED', user: actor, source });
    return {
      allowed: false,
      code: 'TOOL_DISABLED',
      message: "Cet outil a été désactivé par l'administrateur.",
    };
  }

  if (definition.kind !== READ && settings.aiWritesEnabled === false) {
    await auditDenied({ tool: name, code: 'WRITES_DISABLED', user: actor, source });
    return {
      allowed: false,
      code: 'WRITES_DISABLED',
      message: "Les actions de l'assistant sont temporairement désactivées : je peux vous renseigner, mais pas agir (création, modification, envoi).",
    };
  }

  if (!definition.allowAnonymous && !actor) {
    await auditDenied({ tool: name, code: 'AUTH_REQUIRED', user: null, source });
    return {
      allowed: false,
      code: 'AUTH_REQUIRED',
      message: 'Vous devez être connecté pour utiliser cette fonction.',
    };
  }

  if (actor && definition.permission) {
    const granted = await hasPermission(actor, definition.permission);
    if (!granted) {
      await auditDenied({ tool: name, code: 'PERMISSION_DENIED', user: actor, source });
      return {
        allowed: false,
        code: 'PERMISSION_DENIED',
        message: "Vous n'avez pas les droits nécessaires pour cette action.",
      };
    }
  }

  return { allowed: true, tool: { name, ...definition } };
}

/**
 * Variante pour les sites d'appel : journalise l'exécution des outils sensibles.
 * À appeler APRÈS une exécution réussie.
 */
async function recordToolExecution({ tool, user, source = 'chat' }) {
  const definition = TOOL_REGISTRY[tool];
  if (!definition || definition.risk < 2) return;
  await auditGranted({ tool, user: normalizeUser(user), source });
}

function isKnownTool(tool) {
  return Object.prototype.hasOwnProperty.call(TOOL_REGISTRY, tool);
}

function getToolDefinition(tool) {
  return TOOL_REGISTRY[tool] || null;
}

function isIdempotentTool(tool) {
  return TOOL_REGISTRY[tool]?.idempotent === true;
}

module.exports = {
  READ,
  WRITE,
  EXTERNAL,
  TOOL_REGISTRY,
  authorizeToolCall,
  recordToolExecution,
  isKillSwitchActive,
  invalidatePolicyCache,
  isKnownTool,
  getToolDefinition,
  isIdempotentTool,
};
