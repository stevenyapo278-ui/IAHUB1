// Routes /api/graph : exploration en 3 niveaux (centre → catégories →
// éventail) sur le registre services/graphNodes.js. Prisma est mocké, les
// handlers sont appelés directement avec des req/res factices (auth posée au
// niveau routeur).

jest.mock('../prismaClient', () => ({
  user: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  location: { findUnique: jest.fn(), findMany: jest.fn() },
  ticket: { count: jest.fn(), groupBy: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  asset: { count: jest.fn(), findMany: jest.fn() },
  assetTicket: { count: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
  problem: { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  problemTicket: { count: jest.fn(), findMany: jest.fn() },
  problemLink: { count: jest.fn(), findMany: jest.fn() },
  ticketLink: { count: jest.fn(), findMany: jest.fn() },
  ticketCategory: { count: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
  team: { findUnique: jest.fn(), findMany: jest.fn() },
  userSkill: { count: jest.fn(), findMany: jest.fn() },
  skill: { findUnique: jest.fn(), findMany: jest.fn() },
  senderReputation: { count: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
}));
jest.mock('../services/aiTicketComparison', () => ({ callAI: jest.fn() }));

const router = require('./graph.routes');
const prisma = require('../prismaClient');
const { callAI } = require('../services/aiTicketComparison');
const cacheStore = require('../services/cacheStore');

function findRoute(method, path) {
  return router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    set(key, value) { this.headers[key] = value; return this; },
  };
}

// Dispatch complet des couches de la route (handler + middlewares type
// apiCache) : next() enchaîne, une réponse directe (cache HIT) arrête la
// chaîne. req.method/originalUrl sont renseignés pour que les middlewares
// construisent une clé de cache réaliste.
const call = async (method, path, req) => {
  const route = findRoute(method, path);
  expect(route).toBeTruthy();
  const res = makeRes();
  req.method = method.toUpperCase();
  req.originalUrl = `${path}?${JSON.stringify({ params: req.params, query: req.query || {} })}`;
  const stack = route.route.stack.map((l) => l.handle);
  let responded = false;
  const origJson = res.json.bind(res);
  res.json = (payload) => { responded = true; origJson(payload); return res; };
  for (let i = 0; i < stack.length && !responded; i += 1) {
    const fn = stack[i];
    if (fn.length >= 3) {
      // Couche middleware : avance sur next(), ou sur la réponse directe
      await new Promise((resolve, reject) => {
        const onNext = (err) => (err ? reject(err) : resolve());
        const jsonBefore = res.json;
        res.json = (payload) => { responded = true; jsonBefore(payload); resolve(); return res; };
        try { fn(req, res, onNext); } catch (e) { reject(e); }
      });
    } else {
      await fn(req, res);
    }
  }
  return res;
};

// reset complet : les queues mockResolvedValueOnce ne doivent jamais fuiter
// d'un test à l'autre (l'ordre des appels Prisma bouge avec le registre).
// Le cache mémoire est vidé lui aussi (sinon un HIT masquerait un nouveau mock).
beforeEach(() => {
  jest.resetAllMocks();
  cacheStore.clear();
});

describe('protection routeur', () => {
  it('authenticate + requirePermission en couches routeur', () => {
    const layers = router.stack.filter((l) => !l.route);
    expect(layers).toHaveLength(2);
    expect(layers[0].handle.name).toContain('authenticate');
    const res = makeRes();
    let nextCalled = false;
    layers[1].handle({}, res, () => { nextCalled = true; });
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Authentification requise' });
    expect(nextCalled).toBe(false);
  });
});

describe('GET /technicien/:id (registre)', () => {
  it('400 si id invalide', async () => {
    const res = await call('get', '/technicien/:id', { params: { id: 'abc' } });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Identifiant invalide' });
  });

  it('404 si technicien inconnu ou inactif', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const res = await call('get', '/technicien/:id', { params: { id: '999' } });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Technicien introuvable' });
  });

  it('centre + 8 catégories comptées (ordre du registre)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 3, fullName: 'Koffi', role: 'TECHNICIAN', isActive: true });
    prisma.ticket.count
      .mockResolvedValueOnce(14) // tickets ouverts
      .mockResolvedValueOnce(2); // SLA dépassés
    prisma.ticket.groupBy
      .mockResolvedValueOnce([{ locationId: 1 }, { locationId: 2 }, { locationId: 4 }]) // lieux
      .mockResolvedValueOnce([{ requesterId: 9 }]); // demandeurs
    prisma.asset.count.mockResolvedValueOnce(9);
    prisma.problem.count.mockResolvedValueOnce(3);
    prisma.userSkill.count.mockResolvedValueOnce(5);

    const res = await call('get', '/technicien/:id', { params: { id: '3' } });
    expect(res.statusCode).toBe(200);
    expect(res.body.center).toEqual({ type: 'technicien', id: 3, label: 'Koffi', sub: 'TECHNICIAN' });
    expect(res.body.categories).toEqual([
      { key: 'tickets', label: 'Tickets ouverts', count: 14 },
      { key: 'lieux', label: 'Lieux', count: 3 },
      { key: 'sla', label: 'SLA dépassé', count: 2 },
      { key: 'equipements', label: 'Équipements', count: 9 },
      { key: 'problemes', label: 'Problèmes', count: 3 },
      { key: 'demandeurs', label: 'Demandeurs', count: 1 },
      { key: 'equipe', label: 'Équipe', count: 0 },
      { key: 'competences', label: 'Compétences', count: 5 },
    ]);
  });
});

describe('GET /technicien/:id/:category (registre)', () => {
  it('400 catégorie inconnue (avant toute requête)', async () => {
    const res = await call('get', '/technicien/:id/:category', {
      params: { id: '3', category: 'nawak' },
      query: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Catégorie inconnue' });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('404 si technicien inexistant', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const res = await call('get', '/technicien/:id/:category', {
      params: { id: '42', category: 'tickets' },
      query: {},
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Technicien introuvable' });
  });

  it('tickets : items normalisés (ref, href, couleur de priorité)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 3, isActive: true });
    prisma.ticket.count.mockResolvedValue(14);
    prisma.ticket.findMany.mockResolvedValue([
      { id: 1204, title: 'PC ne démarre plus', priority: 'P1', status: 'OPEN', locationName: 'Plateau', slaResolutionDueAt: null, slaBreachedAt: null },
    ]);

    const res = await call('get', '/technicien/:id/:category', {
      params: { id: '3', category: 'tickets' },
      query: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(14);
    expect(res.body.items).toEqual([
      {
        kind: 'ticket', id: 1204, ref: '#1204', label: 'PC ne démarre plus',
        meta: 'Plateau', priority: 'P1', status: 'OPEN', href: '/tickets/1204',
        slaDueAt: null, slaBreached: false, jumps: [],
      },
    ]);
    // plafond d'éventail transmis à Prisma
    expect(prisma.ticket.findMany.mock.calls[0][0].take).toBe(8);
  });

  it('tickets : jumps vers le technicien assigné et le lieu (boucle infinie)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 3, isActive: true });
    prisma.ticket.count.mockResolvedValue(1);
    prisma.ticket.findMany.mockResolvedValue([
      {
        id: 1205, title: 'Imprimante bloquée', priority: 'P2', status: 'OPEN',
        locationId: 7, locationName: 'Plateau', slaResolutionDueAt: null, slaBreachedAt: null,
        assignedTo: { id: 3, fullName: 'Koffi' },
      },
    ]);

    const res = await call('get', '/technicien/:id/:category', {
      params: { id: '3', category: 'tickets' },
      query: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.items[0].jumps).toEqual([
      { center: 'technicien', id: 3, label: 'Koffi' },
      { center: 'lieu', id: 7, label: 'Plateau' },
    ]);
    // le select embarque assignedTo pour construire les sauts
    const select = prisma.ticket.findMany.mock.calls[0][0].select;
    expect(select.locationId).toBe(true);
    expect(select.assignedTo).toEqual({ select: { id: true, fullName: true } });
  });

  it('equipements : jumps vers le lieu et le technicien du dernier ticket', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 3, isActive: true });
    prisma.asset.count.mockResolvedValue(2);
    prisma.asset.findMany.mockResolvedValue([
      { id: 11, name: 'PC Portable', assetType: 'LAPTOP', serialNumber: 'SN1', inventoryNumber: null, status: 'IN_USE', locationId: 7 },
      { id: 12, name: 'Serveur', assetType: 'SERVER', serialNumber: null, inventoryNumber: 'INV2', status: 'IN_STOCK', locationId: null },
    ]);
    prisma.location.findMany.mockResolvedValue([{ id: 7, name: 'Plateau', completename: 'Abidjan > Plateau' }]);
    prisma.assetTicket.findMany.mockResolvedValue([
      { assetId: 11, ticket: { updatedAt: new Date('2026-01-02'), assignedTo: { id: 3, fullName: 'Koffi' } } },
      { assetId: 11, ticket: { updatedAt: new Date('2026-01-01'), assignedTo: { id: 5, fullName: 'Awa' } } },
      { assetId: 12, ticket: { updatedAt: new Date('2026-01-03'), assignedTo: { id: 5, fullName: 'Awa' } } },
    ]);

    const res = await call('get', '/technicien/:id/:category', {
      params: { id: '3', category: 'equipements' },
      query: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(2);
    // équipement 11 : lieu (completename) + technicien du ticket le plus récent (Koffi, pas Awa)
    expect(res.body.items[0].jumps).toEqual([
      { center: 'lieu', id: 7, label: 'Abidjan > Plateau' },
      { center: 'technicien', id: 3, label: 'Koffi' },
    ]);
    // équipement 12 : sans lieu, mais un saut technicien
    expect(res.body.items[1].jumps).toEqual([
      { center: 'technicien', id: 5, label: 'Awa' },
    ]);
    // select inclut locationId pour résoudre le saut lieu
    expect(prisma.asset.findMany.mock.calls[0][0].select.locationId).toBe(true);
  });

  it('lieux : recenter vers le centre « lieu »', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 3, isActive: true });
    prisma.ticket.groupBy
      .mockResolvedValueOnce([{ locationId: 7, _count: 5 }]) // groupBy lieux (avec take)
      .mockResolvedValueOnce([{ locationId: 7 }]); // groupBy distinct (total)
    prisma.location.findMany.mockResolvedValue([{ id: 7, name: 'Plateau', completename: null }]);

    const res = await call('get', '/technicien/:id/:category', {
      params: { id: '3', category: 'lieux' },
      query: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.items[0]).toEqual({
      kind: 'lieu', id: 7, label: 'Plateau', count: 5,
      recenter: { center: 'lieu', id: 7 },
    });
    expect(res.body.total).toBe(1);
  });

  it('all=1 lève le plafond (take=50)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 3, isActive: true });
    prisma.ticket.count.mockResolvedValue(0);
    prisma.ticket.findMany.mockResolvedValue([]);
    await call('get', '/technicien/:id/:category', {
      params: { id: '3', category: 'tickets' },
      query: { all: '1' },
    });
    expect(prisma.ticket.findMany.mock.calls[0][0].take).toBe(50);
  });
});

describe('centre « lieu » (registre)', () => {
  it('GET /lieu/:id : centre + 7 catégories comptées', async () => {
    prisma.location.findUnique.mockResolvedValue({ id: 5, name: 'Bâtiment A', completename: 'Siège > Bâtiment A' });
    prisma.location.findMany.mockResolvedValue([]); // sous-lieux : aucun enfant
    prisma.ticket.count.mockResolvedValueOnce(6).mockResolvedValueOnce(1);
    prisma.ticket.groupBy
      .mockResolvedValueOnce([{ assignedToId: 3 }, { assignedToId: 8 }]) // techniciens
      .mockResolvedValueOnce([]); // demandeurs
    prisma.asset.count.mockResolvedValueOnce(12);
    prisma.problem.count.mockResolvedValueOnce(0);

    const res = await call('get', '/lieu/:id', { params: { id: '5' } });
    expect(res.statusCode).toBe(200);
    expect(res.body.center.label).toBe('Siège > Bâtiment A');
    expect(res.body.categories.map((c) => c.key)).toEqual([
      'tickets', 'techniciens', 'sla', 'equipements', 'sous-lieux', 'problemes', 'demandeurs',
    ]);
    expect(res.body.categories.map((c) => c.count)).toEqual([6, 2, 1, 12, 0, 0, 0]);
  });

  it('GET /lieu/:id/techniciens : recenter vers le centre « technicien »', async () => {
    prisma.location.findUnique.mockResolvedValue({ id: 5 });
    prisma.ticket.groupBy
      .mockResolvedValueOnce([{ assignedToId: 8, _count: 4 }]) // groupBy techniciens
      .mockResolvedValueOnce([{ assignedToId: 8 }]); // distinct (total)
    prisma.user.findMany.mockResolvedValue([{ id: 8, fullName: 'Awa' }]);

    const res = await call('get', '/lieu/:id/:category', {
      params: { id: '5', category: 'techniciens' },
      query: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.items[0]).toEqual({
      kind: 'technicien', id: 8, label: 'Awa', count: 4,
      recenter: { center: 'technicien', id: 8 },
    });
  });

  it('GET /lieu/:id : 400 id invalide, 404 lieu inconnu', async () => {
    let res = await call('get', '/lieu/:id', { params: { id: 'x' } });
    expect(res.statusCode).toBe(400);
    prisma.location.findUnique.mockResolvedValue(null);
    res = await call('get', '/lieu/:id', { params: { id: '42' } });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Lieu introuvable' });
  });
});

describe('routes génériques /:kind/:id[/:category]', () => {
  it('kind inconnu → 400 « Type de nœud inconnu »', async () => {
    const res = await call('get', '/:kind/:id', { params: { kind: 'nawak', id: '1' } });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Type de nœud inconnu' });
  });

  it('kind à id string (origine) : centre + catégories', async () => {
    prisma.ticket.count.mockResolvedValue(5);
    prisma.ticket.groupBy.mockResolvedValue([{ assignedToId: 1 }]);

    const res = await call('get', '/:kind/:id', { params: { kind: 'origine', id: 'EMAIL' } });
    expect(res.statusCode).toBe(200);
    expect(res.body.center).toEqual({ type: 'origine', id: 'EMAIL', label: 'Email', sub: 'Origine' });
    expect(res.body.categories).toEqual([
      { key: 'tickets', label: 'Tickets ouverts', count: 5 },
      { key: 'techniciens', label: 'Techniciens', count: 1 },
    ]);
  });

  it('id invalide pour le kind → 400', async () => {
    const res = await call('get', '/:kind/:id', { params: { kind: 'origine', id: 'nawak' } });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Identifiant invalide' });
  });

  it('origine/:id/tickets : éléments + plafond', async () => {
    prisma.ticket.count.mockResolvedValue(1);
    prisma.ticket.findMany.mockResolvedValue([
      { id: 3, title: 'X', priority: 'P2', status: 'OPEN', locationName: 'Plateau', slaResolutionDueAt: null, slaBreachedAt: null },
    ]);

    const res = await call('get', '/:kind/:id/:category', {
      params: { kind: 'origine', id: 'EMAIL', category: 'tickets' },
      query: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].kind).toBe('ticket');
    expect(prisma.ticket.findMany.mock.calls[0][0].take).toBe(8);
  });

  it('catégorie inconnue → 400', async () => {
    const res = await call('get', '/:kind/:id/:category', {
      params: { kind: 'origine', id: 'EMAIL', category: 'nawak' },
      query: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Catégorie inconnue' });
  });

  it('centre ticket : 5 catégories (liens, acteurs, contexte, équipements, provenance)', async () => {
    prisma.ticket.findUnique.mockResolvedValue({
      id: 7, title: 'Imprimante en panne', status: 'OPEN', priority: 'P1',
      type: 'INCIDENT', origin: 'EMAIL', category: 'Imprimante',
      locationId: 3, locationName: 'Plateau', teamId: null, team: null,
      sourceEmail: 'client@acme.ci', requesterId: 5, secondaryRequesterId: null,
      requesterIds: [], assignedToId: 9, assignedTo: { id: 9, fullName: 'Awa' },
      assignees: [], observers: [],
      requester: { id: 5, fullName: 'Baba', email: 'baba@acme.ci' },
      secondaryRequester: null,
    });
    prisma.ticketLink.count.mockResolvedValue(1);
    prisma.problemTicket.count.mockResolvedValue(0);
    prisma.ticketCategory.findFirst.mockResolvedValue(null);
    prisma.assetTicket.count.mockResolvedValue(2);

    const res = await call('get', '/:kind/:id', { params: { kind: 'ticket', id: '7' } });
    expect(res.statusCode).toBe(200);
    expect(res.body.center).toEqual({
      type: 'ticket', id: 7, label: 'Imprimante en panne', sub: 'OPEN', ref: '#7',
    });
    expect(res.body.categories).toEqual([
      { key: 'liens', label: 'Liens & problèmes', count: 1 },
      { key: 'acteurs', label: 'Acteurs', count: 2 }, // assigné + demandeur
      { key: 'contexte', label: 'Contexte', count: 1 }, // lieu seulement (pas d'équipe ni de catégorie trouvée)
      { key: 'equipements', label: 'Équipements', count: 2 },
      { key: 'provenance', label: 'Provenance', count: 3 }, // email + origine + type
    ]);
  });
});

describe('GET /neighborhood (mode réseau de neurones)', () => {
  it('kind inconnu → 400', async () => {
    const res = await call('get', '/neighborhood/:kind/:id', {
      params: { kind: 'nawak', id: '1' },
      query: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Type de nœud inconnu' });
  });

  it('centre seul quand tout est vide (équipe sans membres ni tickets)', async () => {
    prisma.team.findUnique.mockResolvedValue({ id: 4, name: 'Support', groupEmail: null });
    prisma.user.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.ticket.count.mockResolvedValue(0);
    prisma.ticket.findMany.mockResolvedValue([]);
    prisma.ticket.groupBy.mockResolvedValue([]);
    prisma.problem.count.mockResolvedValue(0);
    prisma.problem.findMany.mockResolvedValue([]);
    prisma.asset.count.mockResolvedValue(0);
    prisma.asset.findMany.mockResolvedValue([]);

    const res = await call('get', '/neighborhood/:kind/:id', {
      params: { kind: 'equipe', id: '4' },
      query: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.center).toEqual({ kind: 'equipe', id: 4, label: 'Support', sub: 'Équipe' });
    expect(res.body.nodes).toHaveLength(1);
    expect(res.body.nodes[0].isCenter).toBe(true);
    expect(res.body.links).toEqual([]);
  });
});

describe('sélecteurs', () => {
  it('GET /techniciens : tri par tickets ouverts puis nom', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 1, fullName: 'Awa', role: 'TECHNICIAN' },
      { id: 2, fullName: 'Koffi', role: 'ADMIN' },
    ]);
    prisma.ticket.groupBy.mockResolvedValue([{ assignedToId: 2, _count: 7 }]);

    const res = await call('get', '/techniciens', {});
    expect(res.body).toEqual([
      { id: 2, fullName: 'Koffi', role: 'ADMIN', openCount: 7 },
      { id: 1, fullName: 'Awa', role: 'TECHNICIAN', openCount: 0 },
    ]);
  });

  it('GET /lieux : label = completename, zéro tickets autorisé', async () => {
    prisma.location.findMany.mockResolvedValue([
      { id: 1, name: 'A', completename: 'Siège > A' },
      { id: 2, name: 'B', completename: null },
    ]);
    prisma.ticket.groupBy.mockResolvedValue([{ locationId: 2, _count: 3 }]);

    const res = await call('get', '/lieux', {});
    expect(res.body).toEqual([
      { id: 2, name: 'B', completename: null, label: 'B', openCount: 3 },
      { id: 1, name: 'A', completename: 'Siège > A', label: 'Siège > A', openCount: 0 },
    ]);
  });
});

describe('GET /search (recherche traversante)', () => {
  // Les 2 requêtes user.findMany arrivent dans l'ordre : staff, puis demandeurs
  const mockEmptySearchExcept = (overrides = {}) => {
    prisma.user.findMany
      .mockResolvedValueOnce(overrides.staff || [])
      .mockResolvedValueOnce(overrides.requesters || []);
    prisma.location.findMany.mockResolvedValue(overrides.locations || []);
    prisma.asset.findMany.mockResolvedValue(overrides.assets || []);
    prisma.problem.findMany.mockResolvedValue(overrides.problems || []);
    prisma.team.findMany.mockResolvedValue(overrides.teams || []);
    prisma.ticketCategory.findMany.mockResolvedValue(overrides.categories || []);
    prisma.skill.findMany.mockResolvedValue(overrides.skills || []);
  };

  it('q < 2 caractères → vide', async () => {
    const res = await call('get', '/search', { query: { q: 'a' } });
    expect(res.body).toEqual({ matches: [] });
    expect(prisma.ticket.findMany).not.toHaveBeenCalled();
  });

  it('ticket assigné → path vers le technicien + catégorie tickets', async () => {
    prisma.ticket.findMany.mockResolvedValue([{
      id: 5, title: 'Imprimante en panne', priority: 'P2', status: 'OPEN',
      locationId: 2, locationName: 'Siège', assignedToId: 9, slaBreachedAt: null,
      assignedTo: { id: 9, fullName: 'Awa K.' },
    }]);
    mockEmptySearchExcept();

    const res = await call('get', '/search', { query: { q: 'imprimante' } });
    expect(res.statusCode).toBe(200);
    expect(res.body.matches).toHaveLength(1);
    expect(res.body.matches[0].path).toEqual({
      center: { type: 'technicien', id: 9, label: 'Awa K.' },
      category: 'tickets',
    });
  });

  it('ticket avec SLA dépassé → catégorie sla ; sans assigné → centre lieu', async () => {
    prisma.ticket.findMany.mockResolvedValue([{
      id: 7, title: 'Panne réseau', priority: 'P1', status: 'OPEN',
      locationId: 3, locationName: 'Annexe', assignedToId: null, slaBreachedAt: new Date(),
      assignedTo: null,
    }]);
    mockEmptySearchExcept({ locations: [{ id: 3, name: 'Annexe', completename: 'Siège > Annexe' }] });

    const res = await call('get', '/search', { query: { q: 'réseau' } });
    expect(res.body.matches[0].path).toEqual({
      center: { type: 'lieu', id: 3, label: 'Annexe' },
      category: 'sla',
    });
  });

  it('nouveaux kinds : problème, équipe, catégorie, compétence, demandeur', async () => {
    prisma.ticket.findMany.mockResolvedValue([]);
    mockEmptySearchExcept({
      requesters: [{ id: 21, fullName: 'Baba', email: 'baba@acme.ci', role: 'REQUESTER' }],
      problems: [{ id: 12, title: 'Imprimante en panne', status: 'IN_PROGRESS', priority: 'P1' }],
      teams: [{ id: 4, name: 'Support', groupEmail: 'support@prosuma.ci' }],
      categories: [{ id: 9, name: 'Réseau' }],
      skills: [{ id: 6, name: 'GLPI', category: 'Outils' }],
    });

    const res = await call('get', '/search', { query: { q: 'imprimante' } });
    expect(res.statusCode).toBe(200);
    const byKind = Object.fromEntries(res.body.matches.map((m) => [m.kind, m]));
    expect(byKind.probleme.path).toEqual({
      center: { type: 'probleme', id: 12, label: 'Imprimante en panne' },
      category: 'tickets',
    });
    expect(byKind.probleme.meta).toBe('En cours');
    expect(byKind.equipe.path.category).toBe('membres');
    expect(byKind.categorie.path.category).toBe('tickets');
    expect(byKind.skill.path.category).toBe('techniciens');
    expect(byKind.demandeur.path).toEqual({
      center: { type: 'demandeur', id: 21, label: 'Baba' },
      category: 'tickets',
    });
  });
});

describe('pair (intersection 2 centres)', () => {
  it('types identiques ou id invalide → 400', async () => {
    let res = await call('get', '/pair/:type1/:id1/:type2/:id2', {
      params: { type1: 'technicien', id1: '1', type2: 'technicien', id2: '2' },
    });
    expect(res.statusCode).toBe(400);
    res = await call('get', '/pair/:type1/:id1/:type2/:id2', {
      params: { type1: 'lieu', id1: 'x', type2: 'technicien', id2: '2' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('croisement technicien × lieu → 2 centres + 4 catégories comptées', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 1, fullName: 'Awa', role: 'TECHNICIAN', isActive: true });
    prisma.location.findUnique.mockResolvedValue({ id: 8, name: 'S', completename: 'Siège' });
    prisma.ticket.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    prisma.asset.count.mockResolvedValueOnce(2);
    prisma.ticket.groupBy.mockResolvedValueOnce([{ assignedToId: 1 }, { assignedToId: 4 }]);

    const res = await call('get', '/pair/:type1/:id1/:type2/:id2', {
      params: { type1: 'technicien', id1: '1', type2: 'lieu', id2: '8' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.center).toEqual({ type: 'technicien', id: 1, label: 'Awa', sub: 'TECHNICIAN' });
    expect(res.body.pin).toEqual({ type: 'lieu', id: 8, label: 'Siège', sub: 'Lieu' });
    expect(res.body.categories.map((c) => c.count)).toEqual([3, 1, 2, 2]);
  });

  it('enfant tickets → where croisé (assigné + lieu) + items normalisés', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 1, fullName: 'Awa', role: 'TECHNICIAN', isActive: true });
    prisma.location.findUnique.mockResolvedValue({ id: 8, name: 'S', completename: 'Siège' });
    prisma.ticket.count.mockResolvedValue(1);
    prisma.ticket.findMany.mockResolvedValue([{
      id: 11, title: 'Ticket ici', priority: 'P1', status: 'OPEN',
      locationName: 'Siège', slaResolutionDueAt: null, slaBreachedAt: null,
    }]);

    const res = await call('get', '/pair/:type1/:id1/:type2/:id2/:category', {
      params: { type1: 'lieu', id1: '8', type2: 'technicien', id2: '1', category: 'tickets' },
      query: {},
    });
    expect(res.statusCode).toBe(200);
    const findArgs = prisma.ticket.findMany.mock.calls[0][0];
    expect(findArgs.where.assignedToId).toBe(1);
    expect(findArgs.where.locationId).toBe(8);
    expect(res.body.items[0].ref).toBe('#11');
  });

  it('catégorie inconnue → 400', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 1, isActive: true, fullName: 'A' });
    prisma.location.findUnique.mockResolvedValue({ id: 8 });
    const res = await call('get', '/pair/:type1/:id1/:type2/:id2/:category', {
      params: { type1: 'technicien', id1: '1', type2: 'lieu', id2: '8', category: 'nawak' },
      query: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /summarize (synthèse IA)', () => {
  const baseBody = { center: { type: 'technicien', id: 1, label: 'Awa' } };

  it('centre invalide → 400', async () => {
    const res = await call('post', '/summarize', { body: { center: { type: 'technicien', id: 'abc' } }, user: { sub: 1 } });
    expect(res.statusCode).toBe(400);
  });

  it('résume le contexte via l’IA', async () => {
    callAI.mockResolvedValue('Situation tendue. → Recommandation : réaffecter.');
    prisma.ticket.findMany.mockResolvedValue([{
      id: 3, title: 'X', priority: 'P1', status: 'OPEN', slaBreachedAt: null, slaResolutionDueAt: null,
    }]);
    prisma.ticket.count.mockResolvedValueOnce(1).mockResolvedValueOnce(5); // [sla, ouverts]

    const res = await call('post', '/summarize', { body: baseBody, user: { sub: 42 } });
    expect(res.statusCode).toBe(200);
    expect(res.body.summary).toContain('Recommandation');
    expect(callAI).toHaveBeenCalledTimes(1);
    // le prompt embarque bien les compteurs du contexte
    expect(callAI.mock.calls[0][0]).toContain('"ticketsOuverts":5');
  });

  it('anti-spam : 2e appel du même utilisateur → 429', async () => {
    const res = await call('post', '/summarize', { body: baseBody, user: { sub: 42 } });
    expect(res.statusCode).toBe(429);
  });

  it('IA absente → 503', async () => {
    callAI.mockRejectedValue(new Error('Aucun provider IA actif configuré'));
    prisma.ticket.findMany.mockResolvedValue([]);
    prisma.ticket.count.mockResolvedValue(0);
    const res = await call('post', '/summarize', { body: { center: { type: 'lieu', id: 8 } }, user: { sub: 77 } });
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toContain('provider');
  });
});
