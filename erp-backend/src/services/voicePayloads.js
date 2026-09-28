// Sanitizer des résultats d'outils vocaux → payloads `tool_result` envoyés au front.
// Le front ne reçoit QUE ce qu'il faut pour afficher une carte : jamais d'objets Prisma
// complets, jamais d'emails bruts. Les données sont déjà cloisonnées par RBAC
// (executeTool reçoit l'utilisateur du JWT et applique les Policy Gates par outil).
// Chaque builder retourne null si le résultat n'est pas affichable (erreur, vide…).

const TICKET_FIELDS = ['id', 'titre', 'statut', 'priorite', 'lieu', 'technicien', 'creeLe'];

function pick(obj, fields) {
  const out = {};
  for (const f of fields) {
    if (obj[f] !== undefined) out[f] = obj[f];
  }
  return out;
}

const BUILDERS = {
  // Liste de tickets → cartes cliquables
  search_tickets: (r) => {
    if (!Array.isArray(r?.tickets) || r.tickets.length === 0) return null;
    return {
      kind: 'tickets',
      total: r.total ?? r.tickets.length,
      tickets: r.tickets.map((t) => pick(t, TICKET_FIELDS)),
    };
  },

  // Détail d'un ticket → carte unique (description = extrait déjà tronqué à 200 car.)
  check_ticket: (r) => (r?.ticket
    ? {
        kind: 'ticket',
        ticket: pick(r.ticket, ['id', 'titre', 'description', 'statut', 'priorite', 'categorie', 'lieu', 'technicien', 'equipe']),
      }
    : null),

  get_ticket_summary: (r) => (r?.ticket
    ? { kind: 'ticket', ticket: pick(r.ticket, ['id', 'titre', 'description', 'statut', 'priorite', 'categorie', 'lieu', 'technicien', 'equipe']) }
    : null),

  // Actions d'écriture → carte de confirmation
  create_ticket: (r) => (r?.success && r?.ticket
    ? { kind: 'action', action: 'created', ticket: pick(r.ticket, ['id', 'titre', 'statut', 'priorite']), message: r.message }
    : null),

  update_ticket_status: (r) => (r?.success && r?.ticket
    ? { kind: 'action', action: 'status_changed', ticket: pick(r.ticket, ['id', 'titre', 'statut']), message: r.message }
    : null),

  add_ticket_followup: (r) => {
    if (!r || r.needsConfirmation) return null; // simple demande de confirmation, rien à afficher
    if (!r.success && r.error) return null;
    return {
      kind: 'action',
      action: 'followup',
      ticketId: r.ticketId ?? r.ticket?.id ?? null,
      message: r.message || 'Suivi ajouté',
    };
  },

  // Agrégats → carte stats + mini-graphiques
  get_ticket_count: (r) => {
    if (typeof r?.total !== 'number') return null;
    const byStatus = ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER', 'SOLVED', 'CLOSED']
      .filter((s) => typeof r[s] === 'number')
      .map((s) => ({ statut: s, nombre: r[s] }));
    return {
      kind: 'stats',
      stats: pick(r, ['total', 'ouverts', 'enAttente', 'resolus', 'fermes']),
      ...(r.periode ? { periode: r.periode } : {}),
      ...(byStatus.length ? { byStatus } : {}),
    };
  },

  generate_report: (r) => {
    if (typeof r?.total !== 'number') return null;
    return {
      kind: 'stats',
      stats: pick(r, ['total', 'ouverts', 'resolus', 'fermes']),
      ...(r.periode ? { periode: r.periode } : {}),
      ...(Array.isArray(r.parPriorite)
        ? { byPriority: r.parPriorite.map((p) => ({ priorite: p.priorite, nombre: p.nombre })) }
        : {}),
      ...(Array.isArray(r.parStatut)
        ? { byStatus: r.parStatut.map((s) => ({ statut: s.statut, nombre: s.nombre })) }
        : {}),
    };
  },
};

function buildToolResultPayload(name, result) {
  if (result == null || result.error) return null;
  const builder = BUILDERS[name];
  if (!builder) return null;
  try {
    return builder(result) || null;
  } catch {
    return null;
  }
}

// ── Forme d'envoi au modèle Gemini (sendToolResponse) ──
// Le proto attend un Struct dans `function_responses[].response` : un tableau ou
// un scalaire à la racine fait fermer la session (code 1007 « Unknown name "response" »).
// Ex réel : search_teams renvoie [{ id, name… }] → on enveloppe sous `items`.
function toGeminiResponse(entry) {
  if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
    return { response: { items: entry } };
  }
  const { response } = entry;
  if (Array.isArray(response)) return { ...entry, response: { items: response } };
  if (response !== null && response !== undefined && typeof response !== 'object') {
    return { ...entry, response: { value: response } };
  }
  return entry;
}

module.exports = { buildToolResultPayload, toGeminiResponse };
