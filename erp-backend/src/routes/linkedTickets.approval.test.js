// GET /locations/:id/tickets et GET /categories/:id/tickets (liste + extraction) —
// les tickets en attente d'approbation (PENDING) ou rejetés (REJECTED) par la
// Hotline ne doivent jamais fuiter dans ces vues, même périmètre que la liste
// principale des tickets (buildTicketWhereClause exclut PENDING/REJECTED par défaut).
// Vérifie : la liste, le compteur `total` et les tickets passés à l'export.
jest.mock('../prismaClient', () => {
  const fixtures = {
    tickets: [
      { id: 1, title: 'Ticket actif', status: 'OPEN', locationId: 5, deletedAt: null, approvalStatus: 'NOT_REQUIRED', category: 'Réseau' },
      { id: 2, title: 'Ticket rejeté', status: 'OPEN', locationId: 5, deletedAt: null, approvalStatus: 'REJECTED', category: 'Réseau' },
      { id: 3, title: 'Ticket en attente', status: 'OPEN', locationId: 5, deletedAt: null, approvalStatus: 'PENDING', category: 'Réseau' },
      { id: 4, title: 'Ticket corbeille', status: 'OPEN', locationId: 5, deletedAt: new Date('2026-09-01'), approvalStatus: 'NOT_REQUIRED', category: 'Réseau' },
    ],
  };

  // Évaluateur restreint aux opérateurs construits par les handlers testés
  function matches(t, where = {}) {
    for (const [key, cond] of Object.entries(where)) {
      if (cond === null) {
        if (t[key] !== null && t[key] !== undefined) return false;
      } else if (typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
        if ('notIn' in cond && cond.notIn.includes(t[key])) return false;
        if ('in' in cond && !cond.in.includes(t[key])) return false;
        if ('equals' in cond && t[key] !== cond.equals) return false;
      } else if (t[key] !== cond) {
        return false;
      }
    }
    return true;
  }

  const filterTickets = ({ where } = {}) => fixtures.tickets.filter((t) => matches(t, where));

  return {
    __fixtures: fixtures,
    ticket: {
      findMany: jest.fn(async (args = {}) => filterTickets(args)),
      count: jest.fn(async (args = {}) => filterTickets(args).length),
      groupBy: jest.fn(async ({ by, where } = {}) => {
        const rows = new Map();
        for (const t of filterTickets({ where })) {
          const key = JSON.stringify(by.map((f) => t[f]));
          const bucket = rows.get(key) || { vals: by.map((f) => t[f]), n: 0 };
          bucket.n += 1;
          rows.set(key, bucket);
        }
        return [...rows.values()].map(({ vals, n }) => {
          const row = {};
          by.forEach((f, i) => { row[f] = vals[i]; });
          row._count = n;
          return row;
        });
      }),
    },
    location: {
      findUnique: jest.fn(async ({ where }) => (where.id === 5 ? { id: 5, name: 'Siège', completename: 'Siège' } : null)),
      findMany: jest.fn(async () => [{ id: 5 }]),
    },
    ticketCategory: {
      findMany: jest.fn(async () => [{ id: 10, name: 'Réseau', parentId: null }]),
    },
    incomingEmail: { groupBy: jest.fn(async () => []) },
    requesterLocation: {
      findMany: jest.fn(async () => []),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    user: { findMany: jest.fn(async () => []) },
  };
});
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
jest.mock('../services/ticketReportService', () => ({
  TICKET_EXPORT_SELECT: { id: true },
  sendTicketsExport: jest.fn(async (res) => { res.status(200).end(); }),
}));
jest.mock('../services/tableExportService', () => ({ sendTableExport: jest.fn(async () => {}) }));

const express = require('express');
const http = require('http');
const prisma = require('../prismaClient');
const locationRouter = require('./location.routes');
const categoriesRouter = require('./categories.routes');
const { sendTicketsExport } = require('../services/ticketReportService');

let server;
let base;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/locations', locationRouter);
  app.use('/categories', categoriesRouter);
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
  prisma.ticket.findMany.mockClear();
  prisma.ticket.count.mockClear();
  prisma.ticket.groupBy.mockClear();
  sendTicketsExport.mockClear();
});

const getJson = async (path) => {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
};

describe('Périmètre des tickets liés (lieux + catégories) — PENDING/REJECTED exclus', () => {
  it('GET /locations/:id/tickets ne renvoie ni rejetés ni en attente ni corbeille', async () => {
    const { status, body } = await getJson('/locations/5/tickets');

    expect(status).toBe(200);
    expect(body.items.map((t) => t.id)).toEqual([1]);
    expect(body.total).toBe(1);
  });

  it("GET /locations/:id/tickets/export n'exporte que les tickets du même périmètre", async () => {
    const res = await fetch(`${base}/locations/5/tickets/export?format=csv`);
    expect(res.status).toBe(200);

    const exported = sendTicketsExport.mock.calls[0][1];
    expect(exported.map((t) => t.id)).toEqual([1]);
  });

  it('GET /locations/:id/tickets accepte un approvalStatus explicite (vue dédiée possible)', async () => {
    const { body } = await getJson('/locations/5/tickets?approvalStatus=REJECTED');
    expect(body.items.map((t) => t.id)).toEqual([2]);
  });

  it('GET /categories/:id/tickets ne renvoie ni rejetés ni en attente ni corbeille', async () => {
    const { status, body } = await getJson('/categories/10/tickets');

    expect(status).toBe(200);
    expect(body.items.map((t) => t.id)).toEqual([1]);
    expect(body.total).toBe(1);
  });

  it("GET /categories/:id/tickets/export n'exporte que les tickets du même périmètre", async () => {
    const res = await fetch(`${base}/categories/10/tickets/export?format=csv`);
    expect(res.status).toBe(200);

    const exported = sendTicketsExport.mock.calls[0][1];
    expect(exported.map((t) => t.id)).toEqual([1]);
  });

  it('GET /categories/:id/tickets accepte un approvalStatus explicite (vue dédiée possible)', async () => {
    const { body } = await getJson('/categories/10/tickets?approvalStatus=REJECTED');
    expect(body.items.map((t) => t.id)).toEqual([2]);
  });

  it('GET /locations/counts ne compte ni rejetés ni en attente ni corbeille', async () => {
    const { status, body } = await getJson('/locations/counts');

    expect(status).toBe(200);
    expect(body).toEqual({ 5: 1 });
    const where = prisma.ticket.groupBy.mock.calls[0][0].where;
    expect(where.approvalStatus).toEqual({ notIn: ['PENDING', 'REJECTED'] });
  });

  it('GET /categories/counts ne compte ni rejetés ni en attente ni corbeille', async () => {
    const { status, body } = await getJson('/categories/counts');

    expect(status).toBe(200);
    expect(body).toEqual({ 10: 1 });
    const where = prisma.ticket.groupBy.mock.calls[0][0].where;
    expect(where.approvalStatus).toEqual({ notIn: ['PENDING', 'REJECTED'] });
  });
});
