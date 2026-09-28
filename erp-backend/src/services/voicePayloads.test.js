// Sanitizer tool_result : le front ne doit recevoir que les champs des cartes.
// Aucun email, aucune relation Prisma, aucun champ hors liste blanche.
const { buildToolResultPayload, toGeminiResponse } = require('./voicePayloads');

const FORBIDDEN = ['demandeur', 'requester', 'email', 'assignedTo', 'suivi', 'entreesTemps', 'contenu'];

function expectNoForbidden(payload) {
  const walk = (obj, path = '') => {
    if (obj === null || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      expect(FORBIDDEN).not.toContain(k);
      walk(v, `${path}.${k}`);
    }
  };
  walk(payload);
}

describe('voicePayloads — payloads tool_result sanitisés', () => {
  it('search_tickets → liste de cartes tickets, champs limités', () => {
    const payload = buildToolResultPayload('search_tickets', {
      total: 2,
      tickets: [
        { id: 64, titre: 'Perte connexion', statut: 'OPEN', priorite: 'P1', lieu: 'Siège', technicien: 'Aya Touré', creeLe: '2026-09-01', demandeur: 'jdoe@prosuma.ci', contenu: 'SECRET' },
        { id: 66, titre: 'Switch', statut: 'OPEN', priorite: 'P1', lieu: '', technicien: '', creeLe: '2026-09-02', demandeur: 'x@y.ci' },
      ],
    });
    expect(payload.kind).toBe('tickets');
    expect(payload.total).toBe(2);
    expect(payload.tickets).toHaveLength(2);
    expect(payload.tickets[0]).toEqual({ id: 64, titre: 'Perte connexion', statut: 'OPEN', priorite: 'P1', lieu: 'Siège', technicien: 'Aya Touré', creeLe: '2026-09-01' });
    expectNoForbidden(payload);
  });

  it('check_ticket → carte unique avec description (extrait) mais sans demandeur', () => {
    const payload = buildToolResultPayload('check_ticket', {
      ticket: { id: 71, titre: 'AD lent', description: 'Extrait', statut: 'OPEN', priorite: 'P1', categorie: 'Système', lieu: 'Siège', technicien: 'Jean Kouassi', equipe: 'Système', demandeur: 'secret@x.ci' },
      suivi: [{ contenu: 'privé' }],
      tempsTotal: 30,
    });
    expect(payload).toEqual({
      kind: 'ticket',
      ticket: { id: 71, titre: 'AD lent', description: 'Extrait', statut: 'OPEN', priorite: 'P1', categorie: 'Système', lieu: 'Siège', technicien: 'Jean Kouassi', equipe: 'Système' },
    });
    expectNoForbidden(payload);
  });

  it('create_ticket / update_ticket_status → carte de confirmation', () => {
    const created = buildToolResultPayload('create_ticket', { success: true, message: 'Ticket #200 créé', ticket: { id: 200, titre: 'T', statut: 'NEW', priorite: 'P3' } });
    expect(created).toEqual({ kind: 'action', action: 'created', ticket: { id: 200, titre: 'T', statut: 'NEW', priorite: 'P3' }, message: 'Ticket #200 créé' });

    const updated = buildToolResultPayload('update_ticket_status', { success: true, message: 'passé de NEW à OPEN', ticket: { id: 200, titre: 'T', statut: 'OPEN' } });
    expect(updated.kind).toBe('action');
    expect(updated.action).toBe('status_changed');
  });

  it('add_ticket_followup → rien tant que confirmation requise, ni en cas d\'erreur', () => {
    expect(buildToolResultPayload('add_ticket_followup', { needsConfirmation: true, message: 'Confirme ?' })).toBeNull();
    expect(buildToolResultPayload('add_ticket_followup', { success: false, error: 'Permission refusée' })).toBeNull();
    const ok = buildToolResultPayload('add_ticket_followup', { success: true, ticketId: 66, message: 'Suivi ajouté' });
    expect(ok).toEqual({ kind: 'action', action: 'followup', ticketId: 66, message: 'Suivi ajouté' });
  });

  it('get_ticket_count → agrégats + ventilation par statut', () => {
    const payload = buildToolResultPayload('get_ticket_count', {
      total: 81, ouverts: 45, enAttente: 0, resolus: 36, fermes: 20,
      NEW: 20, OPEN: 19, PLANNED: 6, PENDING: 0, WAITING_FOR_USER: 0, SOLVED: 16, CLOSED: 20,
    });
    expect(payload.kind).toBe('stats');
    expect(payload.stats).toEqual({ total: 81, ouverts: 45, enAttente: 0, resolus: 36, fermes: 20 });
    expect(payload.byStatus.find((s) => s.statut === 'NEW')).toEqual({ statut: 'NEW', nombre: 20 });
  });

  it('generate_report → agrégats + ventilation par priorité', () => {
    const payload = buildToolResultPayload('generate_report', {
      total: 81, ouverts: 45, resolus: 36, fermes: 20,
      parPriorite: [{ priorite: 'P1', nombre: 8 }],
      parStatut: [{ statut: 'OPEN', nombre: 19 }],
    });
    expect(payload.kind).toBe('stats');
    expect(payload.byPriority).toEqual([{ priorite: 'P1', nombre: 8 }]);
  });

  it('résultats en erreur, vides ou outils sans builder → aucun payload', () => {
    expect(buildToolResultPayload('search_tickets', { error: 'boom' })).toBeNull();
    expect(buildToolResultPayload('search_tickets', { total: 0, tickets: [] })).toBeNull();
    expect(buildToolResultPayload('create_ticket', { success: false, error: 'nope' })).toBeNull();
    expect(buildToolResultPayload('ask_assistant', { success: true, answer: 'texte' })).toBeNull();
    expect(buildToolResultPayload('unknown_tool', { ok: 1 })).toBeNull();
    expect(buildToolResultPayload('get_ticket_count', { total: 'nan' })).toBeNull();
  });
});

describe('toGeminiResponse — response doit être un objet (Struct proto)', () => {
  it('tableau dans response → enveloppé sous items (crash code 1007 sinon)', () => {
    // Bug réel : search_teams renvoie [{id, name…}] → Gemini fermait la session
    const out = toGeminiResponse({ id: 'fc1', name: 'search_teams', response: [{ id: 1, name: 'Réseau' }] });
    expect(out).toEqual({ id: 'fc1', name: 'search_teams', response: { items: [{ id: 1, name: 'Réseau' }] } });
    expect(typeof out.response).toBe('object');
    expect(Array.isArray(out.response)).toBe(false);
  });

  it('scalaire dans response → enveloppé sous value', () => {
    expect(toGeminiResponse({ id: '2', name: 'x', response: 42 }).response).toEqual({ value: 42 });
    expect(toGeminiResponse({ id: '3', name: 'x', response: 'txt' }).response).toEqual({ value: 'txt' });
    expect(toGeminiResponse({ id: '4', name: 'x', response: null }).response).toBeNull();
  });

  it('objet et entrées non-objets → pas de corruption inutile', () => {
    const obj = { id: '5', name: 'ok', response: { total: 3, tickets: [] } };
    expect(toGeminiResponse(obj)).toBe(obj);
    expect(toGeminiResponse(null)).toEqual({ response: { items: null } });
  });
});
