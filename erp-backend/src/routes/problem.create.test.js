// POST /problems — reprise de données (ex. export GLPI) :
//   1. `status` est validé (liste ProblemStatus) et transmis à Prisma,
//   2. `createdAt` est accepté uniquement pour un ADMIN/SUPERADMIN (antidatage),
//   3. sans ces champs, la création reste identique à avant (NEW, daté du jour).
// Test en HTTP réel (sans dépendance supertest) : les validateurs express-validator
// ne sont pas jouables directement hors du couple (req, res).
jest.mock('../prismaClient', () => ({
  problem: {
    create: jest.fn(async ({ data }) => ({ id: 42, ...data })),
    findUnique: jest.fn(async () => null),
  },
  problemEvent: { create: jest.fn(async () => ({ id: 1 })) },
}));
jest.mock('../middleware/auth', () => {
  const state = { role: 'ADMIN' };
  return {
    authenticate: (req, res, next) => {
      req.user = { sub: 1, id: 1, email: 'admin@prosuma.ci', role: state.role };
      next();
    },
    __setRole: (role) => { state.role = role; },
  };
});
jest.mock('../middleware/permissions', () => ({
  requirePermission: () => (req, res, next) => next(),
}));
jest.mock('../services/auditLogService', () => ({ auditLog: jest.fn(async () => {}) }));

const express = require('express');
const http = require('http');
const prisma = require('../prismaClient');
const { __setRole } = require('../middleware/auth');
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
  // fetch() (undici) garde des connexions en keep-alive : sans ça, server.close() n'aboutit pas
  if (server.closeAllConnections) server.closeAllConnections();
  server.close(done);
});
beforeEach(() => {
  prisma.problem.create.mockClear();
  __setRole('ADMIN');
});

const post = async (payload) => {
  const res = await fetch(`${base}/problems`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
};

const BASE_PAYLOAD = { title: 'Problème réseau boutique', description: 'Vérification des interconnexions.' };

describe('POST /problems — reprise de données (import GLPI)', () => {
  it("accepte un statut initial et une date d'ouverture antidatée", async () => {
    const { status, body } = await post({
      ...BASE_PAYLOAD,
      status: 'WAITING',
      priority: 'P2',
      category: 'Incident > Réseau',
      createdAt: '2024-10-11T10:55:00.000Z',
    });

    expect(status).toBe(201);
    expect(prisma.problem.create).toHaveBeenCalledTimes(1);
    const data = prisma.problem.create.mock.calls[0][0].data;
    expect(data.status).toBe('WAITING');
    expect(data.priority).toBe('P2');
    expect(data.category).toBe('Incident > Réseau');
    expect(data.createdAt).toBeInstanceOf(Date);
    expect(data.createdAt.toISOString()).toBe('2024-10-11T10:55:00.000Z');
    expect(body.id).toBe(42);
  });

  it('refuse un statut hors ProblemStatus sans rien créer', async () => {
    const { status, body } = await post({ ...BASE_PAYLOAD, status: 'EN_ATTENTE' });

    expect(status).toBe(400);
    expect(JSON.stringify(body)).toMatch(/Statut invalide/);
    expect(prisma.problem.create).not.toHaveBeenCalled();
  });

  it("refuse une date de création non ISO 8601", async () => {
    const { status, body } = await post({ ...BASE_PAYLOAD, createdAt: '11/10/2024' });

    expect(status).toBe(400);
    expect(JSON.stringify(body)).toMatch(/Date de création invalide/);
    expect(prisma.problem.create).not.toHaveBeenCalled();
  });

  it("interdit l'antidatage à un HOTLINE (403)", async () => {
    __setRole('HOTLINE');
    const { status } = await post({ ...BASE_PAYLOAD, createdAt: '2024-10-11T10:55:00.000Z' });

    expect(status).toBe(403);
    expect(prisma.problem.create).not.toHaveBeenCalled();
  });

  it('conserve le comportement historique sans status ni createdAt (NEW, daté du jour)', async () => {
    const { status } = await post(BASE_PAYLOAD);

    expect(status).toBe(201);
    const data = prisma.problem.create.mock.calls[0][0].data;
    expect(data.status).toBe('NEW');
    expect(data.createdAt).toBeUndefined();
    expect(data.priority).toBe('P3');
  });

  it('date solvedAt/closedAt quand la création porte un statut résolu', async () => {
    await post({ ...BASE_PAYLOAD, status: 'SOLVED' });
    const data = prisma.problem.create.mock.calls[0][0].data;
    expect(data.solvedAt).toBeInstanceOf(Date);
    expect(data.closedAt).toBeUndefined();
  });
});
