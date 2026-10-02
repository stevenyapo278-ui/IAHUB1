// GET /problems — filtres et tri serveur (miroir du comportement de la vue Tickets) :
//   1. `status` accepte un statut unique, un groupe (OPEN_GROUP…) ou une liste CSV,
//      et reste validé contre ProblemStatus,
//   2. `assignedToId` / `requesterId` acceptent la valeur sentinelle 'none',
//   3. `dateFrom` / `dateTo` bornent createdAt (fin de journée incluse),
//   4. `sortBy` / `sortOrder` pilotent l'orderBy, avec whitelist (relations comprises),
//   5. la recherche couvre demandeur et assigné.
// Même montage HTTP réel que problem.create.test.js.
jest.mock('../prismaClient', () => ({
  problem: {
    findMany: jest.fn(async () => []),
    count: jest.fn(async () => 0),
    create: jest.fn(async ({ data }) => ({ id: 1, ...data })),
    findUnique: jest.fn(async () => null),
    update: jest.fn(async ({ data }) => ({ id: 1, ...data })),
  },
  problemEvent: { create: jest.fn(async () => ({ id: 1 })) },
  user: { findUnique: jest.fn(async ({ where }) => ({ id: where.id })) },
  team: { findUnique: jest.fn(async ({ where }) => ({ id: where.id })) },
}));
jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = { sub: 1, id: 1, email: 'admin@prosuma.ci', role: 'ADMIN' };
    next();
  },
}));
jest.mock('../middleware/permissions', () => ({
  requirePermission: () => (req, res, next) => next(),
}));
jest.mock('../services/auditLogService', () => ({ auditLog: jest.fn(async () => {}) }));

const express = require('express');
const prisma = require('../prismaClient');
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
  prisma.problem.findMany.mockClear();
  prisma.problem.count.mockClear();
});

const get = async (qs = '') => {
  const res = await fetch(`${base}/problems${qs}`);
  return { status: res.status, body: await res.json() };
};

const lastWhere = () => prisma.problem.findMany.mock.calls[0][0].where;
const lastOrderBy = () => prisma.problem.findMany.mock.calls[0][0].orderBy;

describe('GET /problems — filtres', () => {
  it("accepte un groupe de statuts (puce « Ouverts »)", async () => {
    const { status } = await get('?status=OPEN_GROUP');

    expect(status).toBe(200);
    expect(lastWhere().status).toEqual({ in: ['NEW', 'IN_PROGRESS', 'ASSIGNED', 'PLANNED', 'WAITING'] });
  });

  it('accepte une liste CSV de statuts', async () => {
    await get('?status=SOLVED,CLOSED');

    expect(lastWhere().status).toEqual({ in: ['SOLVED', 'CLOSED'] });
  });

  it("réduit un groupe à un statut unique quand il ne contient qu'une valeur valide", async () => {
    await get('?status=SOLVED');

    expect(lastWhere().status).toBe('SOLVED');
  });

  it("filtre « Non clôturés » avec le groupe NOT_CLOSED", async () => {
    const { status } = await get('?status=NOT_CLOSED');

    expect(status).toBe(200);
    expect(lastWhere().status).toEqual({
      in: ['NEW', 'IN_PROGRESS', 'ASSIGNED', 'PLANNED', 'WAITING', 'OBSERVED'],
    });
  });

  it('ignore un statut hors ProblemStatus sans filtrer pour autant', async () => {
    await get('?status=EN_ATTENTE');

    expect(lastWhere().status).toBeUndefined();
  });

  it("filtre les problèmes sans assigné avec assignedToId=none", async () => {
    await get('?assignedToId=none');

    expect(lastWhere().assignedToId).toBeNull();
  });

  it("filtre les problèmes sans demandeur avec requesterId=none", async () => {
    await get('?requesterId=none');

    expect(lastWhere().requesterId).toBeNull();
  });

  it("coerce l'identifiant du demandeur reçu en chaîne", async () => {
    await get('?requesterId=7');

    expect(lastWhere().requesterId).toBe(7);
  });

  it('ignore un identifiant non numérique au lieu de planter', async () => {
    await get('?requesterId=abc');

    expect(lastWhere().requesterId).toBeUndefined();
  });

  it('borne createdAt de dateFrom à la fin de journée de dateTo', async () => {
    await get('?dateFrom=2026-09-01&dateTo=2026-09-30');

    const cond = lastWhere().createdAt;
    expect(cond.gte).toBeInstanceOf(Date);
    expect(cond.lte).toBeInstanceOf(Date);
    expect(cond.lte.toISOString()).toBe('2026-09-30T23:59:59.999Z');
  });

  it('la recherche couvre le titre, le demandeur et assigné', async () => {
    await get('?search=impression');

    const or = lastWhere().OR;
    expect(or).toEqual(expect.arrayContaining([
      { title: { contains: 'impression', mode: 'insensitive' } },
      { requester: { fullName: { contains: 'impression', mode: 'insensitive' } } },
      { assignedTo: { fullName: { contains: 'impression', mode: 'insensitive' } } },
    ]));
  });
});

describe('GET /problems — tri serveur', () => {
  it('trie par défaut sur la date de création desc', async () => {
    await get();

    expect(lastOrderBy()).toEqual({ createdAt: 'desc' });
  });

  it("trie sur une colonne simple (clic d'en-tête)", async () => {
    await get('?sortBy=priority&sortOrder=asc');

    expect(lastOrderBy()).toEqual({ priority: 'asc' });
  });

  it('trie sur une relation (demandeur, assigné, équipe)', async () => {
    await get('?sortBy=requester&sortOrder=asc');

    expect(lastOrderBy()).toEqual({ requester: { fullName: 'asc' } });
  });

  it("refuse une colonne hors whitelist (retour au tri d'origine)", async () => {
    await get('?sortBy=passwordHash&sortOrder=asc');

    expect(lastOrderBy()).toEqual({ createdAt: 'desc' });
  });

  it('combine filtres et tri', async () => {
    await get('?status=OPEN_GROUP&assignedToId=none&sortBy=title&sortOrder=desc&page=2&limit=10');

    expect(lastWhere()).toEqual({ status: { in: ['NEW', 'IN_PROGRESS', 'ASSIGNED', 'PLANNED', 'WAITING'] }, assignedToId: null });
    expect(lastOrderBy()).toEqual({ title: 'desc' });
    const args = prisma.problem.findMany.mock.calls[0][0];
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
  });
});
