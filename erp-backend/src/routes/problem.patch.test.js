// PATCH /problems/:id — assignation :
//   1. les identifiants envoyés par un <select> (chaînes) sont coercés en entiers,
//   2. un identifiant inexistant est refusé en 400 (au lieu d'une FK violée → 500),
//   3. le désassignement (null) reste possible,
//   4. un changement d'assignation produit un événement ASSIGNED.
// Même montage HTTP réel que problem.create.test.js.
jest.mock('../prismaClient', () => ({
  problem: {
    findUnique: jest.fn(async ({ where }) => (where.id === 1
      ? { id: 1, title: 'Problème réseau', status: 'NEW', priority: 'P3', assignedToId: null }
      : null)),
    update: jest.fn(async ({ data }) => ({ id: 1, title: 'Problème réseau', ...data })),
  },
  problemEvent: { create: jest.fn(async () => ({ id: 1 })) },
  user: { findUnique: jest.fn(async ({ where }) => (where.id === 7 ? { id: 7 } : null)) },
  team: { findUnique: jest.fn(async ({ where }) => (where.id === 3 ? { id: 3 } : null)) },
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
const http = require('http');
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
  prisma.problem.update.mockClear();
  prisma.problemEvent.create.mockClear();
  prisma.user.findUnique.mockClear();
  prisma.team.findUnique.mockClear();
});

const patch = async (id, payload) => {
  const res = await fetch(`${base}/problems/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
};

describe('PATCH /problems/:id — assignation', () => {
  it("coerce l'identifiant chaîne d'un select et enregistre l'assignation", async () => {
    const { status, body } = await patch(1, { assignedToId: '7' });

    expect(status).toBe(200);
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7 } }));
    expect(prisma.problem.update).toHaveBeenCalledWith(expect.objectContaining({ data: { assignedToId: 7 } }));
    expect(body.assignedToId).toBe(7);
    const evt = prisma.problemEvent.create.mock.calls[0][0].data;
    expect(evt.type).toBe('ASSIGNED');
    expect(evt.payload).toEqual({ from: null, to: 7 });
  });

  it("refuse un utilisateur inexistant sans rien mettre à jour", async () => {
    const { status, body } = await patch(1, { assignedToId: 999 });

    expect(status).toBe(400);
    expect(JSON.stringify(body)).toMatch(/Utilisateur introuvable/);
    expect(prisma.problem.update).not.toHaveBeenCalled();
    expect(prisma.problemEvent.create).not.toHaveBeenCalled();
  });

  it("refuse une équipe inexistante sans rien mettre à jour", async () => {
    const { status, body } = await patch(1, { teamId: 999 });

    expect(status).toBe(400);
    expect(JSON.stringify(body)).toMatch(/Équipe introuvable/);
    expect(prisma.problem.update).not.toHaveBeenCalled();
  });

  it("refuse un identifiant non numérique", async () => {
    const { status } = await patch(1, { teamId: 'abc' });

    expect(status).toBe(400);
    expect(prisma.problem.update).not.toHaveBeenCalled();
  });

  it("accepte la désassignation par null", async () => {
    const { status } = await patch(1, { assignedToId: null });

    expect(status).toBe(200);
    expect(prisma.problem.update).toHaveBeenCalledWith(expect.objectContaining({ data: { assignedToId: null } }));
  });

  it("renvoie 404 pour un problème inexistant", async () => {
    const { status } = await patch(404, { assignedToId: 7 });

    expect(status).toBe(404);
    expect(prisma.problem.update).not.toHaveBeenCalled();
  });
});
