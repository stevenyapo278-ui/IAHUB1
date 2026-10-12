// Alignement problèmes ↔ tickets + conversion ticket → problème :
//   1. scoping demandeur sur la liste (where.AND) et le détail (404),
//   2. filtrage des suivis privés pour les non-staff,
//   3. plafond par rôle PATCH/DELETE (technicien = statut seul, équipe, actif),
//   4. transitions de statut validées (matrice PROBLEM_TRANSITIONS),
//   5. conversion : transposition des suivis, lien ticket↔problème,
//      keepTicketOpen=false ferme le ticket, 409 si déjà lié.
jest.mock('../prismaClient', () => {
  const state = { ticket: null, linkedProblemId: null };
  const tx = {
    problem: {
      create: jest.fn(async ({ data }) => ({ id: 42, updatedAt: new Date(), ...data })),
    },
    problemFollowup: { createMany: jest.fn(async () => ({ count: 0 })) },
    problemTicket: {
      upsert: jest.fn(async ({ create }) => ({ id: 1, ...create })),
    },
    problemEvent: { create: jest.fn(async () => ({ id: 1 })) },
    ticket: { update: jest.fn(async ({ data }) => ({ id: state.ticket?.id, ...data })) },
  };
  return {
    __state: state,
    __tx: tx,
    problem: {
      findUnique: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      update: jest.fn(async ({ data }) => ({ id: 1, ...data })),
      delete: jest.fn(async () => ({ id: 1 })),
    },
    problemFollowup: { findMany: jest.fn(async () => []) },
    problemTicket: {
      findFirst: jest.fn(async () => (state.linkedProblemId ? { problemId: state.linkedProblemId, ticketId: 1 } : null)),
      upsert: tx.problemTicket.upsert,
    },
    problemEvent: { create: jest.fn(async () => ({ id: 1 })) },
    problemAttachment: { delete: jest.fn(async () => ({ id: 1 })) },
    ticket: {
      findUnique: jest.fn(async () => state.ticket),
      update: jest.fn(async ({ data }) => ({ id: state.ticket?.id, ...data })),
    },
    followup: { create: jest.fn(async ({ data }) => ({ id: 1, ...data })) },
    user: { findUnique: jest.fn(async ({ where }) => (where.id === 7 ? { id: 7 } : null)) },
    team: { findUnique: jest.fn(async ({ where }) => (where.id === 3 ? { id: 3 } : null)) },
    $transaction: jest.fn(async (fn) => fn(tx)),
  };
});
// Utilisateur courant paramétrable par test (préfixe mockUser requis par jest.mock)
let mockUser = { sub: 1, id: 1, email: 'admin@prosuma.ci', role: 'ADMIN', teamId: null };
jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = mockUser;
    next();
  },
}));
jest.mock('../middleware/permissions', () => ({
  requirePermission: () => (req, res, next) => next(),
  hasPermission: jest.fn(async () => true),
}));
jest.mock('../services/auditLogService', () => ({ auditLog: jest.fn(async () => {}) }));
jest.mock('../services/ticketEvent', () => ({ logEvent: jest.fn(async () => {}) }));

const express = require('express');
const prisma = require('../prismaClient');
const { logEvent } = require('../services/ticketEvent');
const router = require('./problem.routes');

let server;
let base;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/problems', router);
  server = app.listen(0, () => {
    base = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});

afterAll((done) => {
  if (server.closeAllConnections) server.closeAllConnections();
  server.close(done);
});

beforeEach(() => {
  mockUser = { sub: 1, id: 1, email: 'admin@prosuma.ci', role: 'ADMIN', teamId: null };
  prisma.__state.ticket = null;
  prisma.__state.linkedProblemId = null;
  jest.clearAllMocks();
});

const get = async (path) => {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json().catch(() => null) };
};
const patch = async (path, payload) => {
  const res = await fetch(`${base}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const del = async (path) => {
  const res = await fetch(`${base}${path}`, { method: 'DELETE' });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const post = async (path, payload) => {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

describe('Scoping demandeur (miroir tickets)', () => {
  it('limite la liste aux problèmes demandés ou observés', async () => {
    mockUser = { sub: 9, email: 'req@x.ci', role: 'REQUESTER' };
    const { status } = await get('/problems');
    expect(status).toBe(200);
    const { where } = prisma.problem.findMany.mock.calls[0][0];
    expect(where.AND).toEqual([
      { OR: [{ requesterId: 9 }, { observers: { some: { id: 9 } } }] },
    ]);
    // Le compteur doit recevoir le même where (pagination cohérente)
    expect(prisma.problem.count.mock.calls[0][0].where).toEqual(where);
  });

  it("n'applique pas de scoping à un ADMIN", async () => {
    mockUser = { sub: 1, email: 'admin@x.ci', role: 'ADMIN' };
    await get('/problems');
    const { where } = prisma.problem.findMany.mock.calls[0][0];
    expect(where.AND).toBeUndefined();
  });

  it('retourne 404 à un demandeur sur le détail d’un problème étranger', async () => {
    mockUser = { sub: 9, email: 'req@x.ci', role: 'REQUESTER' };
    prisma.problem.findUnique.mockResolvedValueOnce({
      id: 1, requesterId: 5, status: 'NEW', observers: [],
    });
    const { status } = await get('/problems/1');
    expect(status).toBe(404);
  });

  it("accepte un demandeur observateur du problème", async () => {
    mockUser = { sub: 9, email: 'req@x.ci', role: 'REQUESTER' };
    prisma.problem.findUnique.mockResolvedValueOnce({
      id: 1, requesterId: 5, status: 'NEW', observers: [{ id: 9, fullName: 'Moi' }],
    });
    const { status, body } = await get('/problems/1');
    expect(status).toBe(200);
    expect(body.id).toBe(1);
  });
});

describe('Filtrage des suivis privés (isPrivate)', () => {
  it('masque les suivis privés au détail pour un demandeur', async () => {
    mockUser = { sub: 9, email: 'req@x.ci', role: 'REQUESTER' };
    prisma.problem.findUnique.mockResolvedValueOnce({
      id: 1, requesterId: 9, status: 'NEW', observers: [],
      followups: [
        { id: 1, content: 'public', isPrivate: false, author: {} },
        { id: 2, content: 'privé', isPrivate: true, author: {} },
      ],
    });
    const { status, body } = await get('/problems/1');
    expect(status).toBe(200);
    expect(body.followups).toHaveLength(1);
    expect(body.followups[0].content).toBe('public');
  });

  it('conserve les suivis privés pour un HOTLINE (staff)', async () => {
    mockUser = { sub: 2, email: 'hl@x.ci', role: 'HOTLINE' };
    prisma.problem.findUnique.mockResolvedValueOnce({
      id: 1, requesterId: 9, status: 'NEW', observers: [],
      followups: [
        { id: 1, content: 'public', isPrivate: false, author: {} },
        { id: 2, content: 'privé', isPrivate: true, author: {} },
      ],
    });
    const { body } = await get('/problems/1');
    expect(body.followups).toHaveLength(2);
  });

  it('filtre isPrivate sur la liste des suivis pour un demandeur', async () => {
    mockUser = { sub: 9, email: 'req@x.ci', role: 'REQUESTER' };
    prisma.problemFollowup.findMany.mockResolvedValueOnce([
      { id: 1, content: 'public', isPrivate: false },
      { id: 2, content: 'privé', isPrivate: true },
    ]);
    const { status, body } = await get('/problems/1/followups');
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].content).toBe('public');
  });
});

describe('Plafond par rôle PATCH (technicien = statut seul)', () => {
  beforeEach(() => {
    // Problème actif de l'équipe du technicien (id=3)
    prisma.problem.findUnique.mockImplementation(async ({ where, select }) => {
      if (select) return { status: 'IN_PROGRESS', teamId: 3 };
      return { id: where.id, title: 'Pb', status: 'IN_PROGRESS', priority: 'P3', teamId: 3, assignedToId: null, requesterId: 9 };
    });
  });

  it('refuse tout champ autre que le statut', async () => {
    mockUser = { sub: 7, email: 'tech@x.ci', role: 'TECHNICIAN', teamId: 3 };
    const { status, body } = await patch('/problems/1', { title: 'Hors statut' });
    expect(status).toBe(403);
    expect(JSON.stringify(body)).toMatch(/statut/i);
    expect(prisma.problem.update).not.toHaveBeenCalled();
  });

  it("autorise le statut seul sur un problème de son équipe actif", async () => {
    mockUser = { sub: 7, email: 'tech@x.ci', role: 'TECHNICIAN', teamId: 3 };
    const { status } = await patch('/problems/1', { status: 'ASSIGNED' });
    expect(status).toBe(200);
    expect(prisma.problem.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'ASSIGNED' } }));
  });

  it("refuse le statut sur un problème hors de son équipe", async () => {
    mockUser = { sub: 7, email: 'tech@x.ci', role: 'TECHNICIAN', teamId: 8 };
    const { status } = await patch('/problems/1', { status: 'ASSIGNED' });
    expect(status).toBe(403);
    expect(prisma.problem.update).not.toHaveBeenCalled();
  });

  it('refuse toute modification sur un problème résolu ou fermé', async () => {
    prisma.problem.findUnique.mockImplementation(async ({ where, select }) => {
      if (select) return { status: 'CLOSED', teamId: 3 };
      return { id: where.id, status: 'CLOSED', teamId: 3 };
    });
    mockUser = { sub: 7, email: 'tech@x.ci', role: 'TECHNICIAN', teamId: 3 };
    const { status } = await patch('/problems/1', { status: 'IN_PROGRESS' });
    expect(status).toBe(403);
    expect(JSON.stringify({ status })).toMatch(/403/);
  });
});

describe('PATCH validations statut (matrice de transitions)', () => {
  it('refuse une valeur de statut inconnue', async () => {
    prisma.problem.findUnique.mockResolvedValue({ id: 1, status: 'NEW', teamId: null });
    const { status, body } = await patch('/problems/1', { status: 'WAT' });
    expect(status).toBe(400);
    expect(JSON.stringify(body)).toMatch(/Statut invalide/);
  });

  it('refuse une transition illégale (CLOSED → WAITING)', async () => {
    prisma.problem.findUnique.mockResolvedValue({ id: 1, status: 'CLOSED', teamId: null });
    const { status, body } = await patch('/problems/1', { status: 'WAITING' });
    expect(status).toBe(400);
    expect(JSON.stringify(body)).toMatch(/Transition de statut invalide/);
    expect(prisma.problem.update).not.toHaveBeenCalled();
  });

  it('accepte une transition légale (CLOSED → IN_PROGRESS)', async () => {
    prisma.problem.findUnique.mockResolvedValue({ id: 1, status: 'CLOSED', teamId: null });
    const { status } = await patch('/problems/1', { status: 'IN_PROGRESS' });
    expect(status).toBe(200);
  });

  it("refuse un champ inconnu (anti mass-assignment)", async () => {
    prisma.problem.findUnique.mockResolvedValue({ id: 1, status: 'NEW', teamId: null });
    const { status, body } = await patch('/problems/1', { evilField: 1 });
    expect(status).toBe(400);
    expect(JSON.stringify(body)).toMatch(/Champ non autorisé/);
    expect(prisma.problem.update).not.toHaveBeenCalled();
  });
});

describe('DELETE plafond par rôle', () => {
  beforeEach(() => {
    prisma.problem.findUnique.mockResolvedValue({ id: 1, title: 'Pb', _count: { tickets: 0 } });
  });

  it('refuse la suppression à un technicien', async () => {
    mockUser = { sub: 7, email: 'tech@x.ci', role: 'TECHNICIAN', teamId: 3 };
    const { status } = await del('/problems/1');
    expect(status).toBe(403);
    expect(prisma.problem.delete).not.toHaveBeenCalled();
  });

  it('refuse la suppression à un demandeur', async () => {
    mockUser = { sub: 9, email: 'req@x.ci', role: 'REQUESTER' };
    const { status } = await del('/problems/1');
    expect(status).toBe(403);
  });

  it('autorise la suppression à un ADMIN', async () => {
    mockUser = { sub: 1, email: 'admin@x.ci', role: 'ADMIN' };
    const { status } = await del('/problems/1');
    expect(status).toBe(204);
    expect(prisma.problem.delete).toHaveBeenCalled();
  });
});

describe('Conversion ticket → problème', () => {
  const makeTicket = () => ({
    id: 1,
    title: 'Imprimante bloquée',
    content: '<p>Description initiale</p>',
    status: 'OPEN',
    priority: 'P2',
    urgency: 'HIGH',
    impact: 'MEDIUM',
    category: 'Matériel',
    locationId: null,
    locationName: 'SIÈGE',
    dueDate: null,
    requesterId: 4,
    requesterIds: [9, 4],
    assignedToId: 7,
    teamId: 3,
    deletedAt: null,
    assignees: [{ id: 7 }],
    observers: [{ id: 12 }],
    followups: [
      { id: 11, authorId: 9, content: '<p>Ouvert</p>', isPrivate: false, createdAt: new Date('2026-01-01T10:00:00Z') },
      { id: 12, authorId: 7, content: '<p>Diagnostic</p>', isPrivate: true, createdAt: new Date('2026-01-02T10:00:00Z') },
    ],
  });

  it('transpose les suivis, lie le ticket et garde le ticket ouvert par défaut', async () => {
    prisma.__state.ticket = makeTicket();
    const { status, body } = await post('/problems/from-ticket/1');

    expect(status).toBe(201);
    expect(body.ticketClosed).toBe(false);

    // Problème créé avec champs copiés + premier demandeur de requesterIds
    const created = prisma.__tx.problem.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      title: 'Imprimante bloquée',
      description: '<p>Description initiale</p>',
      status: 'NEW',
      priority: 'P2',
      urgency: 'HIGH',
      impact: 'MEDIUM',
      category: 'Matériel',
      requesterId: 9,
      assignedToId: 7,
      teamId: 3,
    });

    // Suivis transposés : auteur, contenu, visibilité, date d'origine
    const fus = prisma.__tx.problemFollowup.createMany.mock.calls[0][0].data;
    expect(fus).toHaveLength(2);
    expect(fus[0]).toMatchObject({ problemId: 42, authorId: 9, content: '<p>Ouvert</p>', isPrivate: false });
    expect(fus[1]).toMatchObject({ authorId: 7, content: '<p>Diagnostic</p>', isPrivate: true });
    expect(fus[1].createdAt).toEqual(new Date('2026-01-02T10:00:00Z'));

    // Lien ticket ↔ problème
    expect(prisma.__tx.problemTicket.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { problemId: 42, ticketId: 1 } })
    );
    // Ticket non fermé
    expect(prisma.__tx.ticket.update).not.toHaveBeenCalled();
    // Événement + trace fil ticket
    expect(prisma.__tx.problemEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'CREATED', payload: expect.objectContaining({ fromTicketId: 1 }) }) })
    );
    expect(prisma.followup.create).toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(1, 'CONVERTED_TO_PROBLEM', expect.any(String), { problemId: 42 });
  });

  it('ferme le ticket quand keepTicketOpen=false', async () => {
    prisma.__state.ticket = makeTicket();
    const { status, body } = await post('/problems/from-ticket/1', { keepTicketOpen: false });

    expect(status).toBe(201);
    expect(body.ticketClosed).toBe(true);
    expect(prisma.__tx.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CLOSED' }) })
    );
    expect(logEvent).toHaveBeenCalledWith(1, 'CONVERTED_TO_PROBLEM_CLOSED', expect.any(String), { problemId: 42 });
  });

  it('retourne 404 si le ticket est introuvable', async () => {
    prisma.__state.ticket = null;
    const { status } = await post('/problems/from-ticket/999');
    expect(status).toBe(404);
    expect(prisma.__tx.problem.create).not.toHaveBeenCalled();
  });

  it('retourne 409 si le ticket est déjà lié à un problème', async () => {
    prisma.__state.ticket = makeTicket();
    prisma.__state.linkedProblemId = 5;
    const { status, body } = await post('/problems/from-ticket/1');
    expect(status).toBe(409);
    expect(JSON.stringify(body)).toMatch(/déjà lié/);
    expect(prisma.__tx.problem.create).not.toHaveBeenCalled();
  });

  it("refuse la conversion à un technicien (plafond par rôle)", async () => {
    mockUser = { sub: 7, email: 'tech@x.ci', role: 'TECHNICIAN', teamId: 3 };
    prisma.__state.ticket = makeTicket();
    const { status } = await post('/problems/from-ticket/1');
    expect(status).toBe(403);
    expect(prisma.__tx.problem.create).not.toHaveBeenCalled();
  });

  it('tombe sur requesterId simple quand requesterIds est vide', async () => {
    prisma.__state.ticket = { ...makeTicket(), requesterIds: [], requesterId: 4 };
    await post('/problems/from-ticket/1');
    const created = prisma.__tx.problem.create.mock.calls[0][0].data;
    expect(created.requesterId).toBe(4);
  });
});
