// PATCH /problems/:id — multi-assignation et observateurs + PATCH/DELETE des suivis :
//   1. assigneeIds remplace la liste (ids inconnus refusés en 400, pas de FK violée),
//   2. assignedToId suit le premier assigné quand non fourni,
//   3. observerIds remplace la liste avec validation des ids,
//   4. un suivi n'est éditable/supprimable que par son auteur ou un ADMIN.
jest.mock('../prismaClient', () => {
  const db = {
    problems: [{ id: 1, title: 'Problème réseau', status: 'NEW', priority: 'P3', assignedToId: null }],
    followups: [{ id: 10, problemId: 1, authorId: 7, content: '<p>Initial</p>', isPrivate: false }],
    users: [{ id: 3, fullName: 'Tech Un' }, { id: 5, fullName: 'Tech Deux' }, { id: 7, fullName: 'Auteur Suivi' }],
  };
  const prisma = {
    problem: {
      findUnique: jest.fn(async ({ where }) => db.problems.find((p) => p.id === where.id) || null),
      update: jest.fn(async ({ where, data }) => {
        const p = db.problems.find((x) => x.id === where.id);
        Object.assign(p, data);
        return { ...p, assignees: [], observers: [] };
      }),
    },
    problemFollowup: {
      findFirst: jest.fn(async ({ where }) => db.followups.find((f) => f.id === where.id && f.problemId === where.problemId) || null),
      update: jest.fn(async ({ where, data }) => {
        const f = db.followups.find((x) => x.id === where.id);
        Object.assign(f, data);
        return { ...f, author: { id: f.authorId, fullName: 'Auteur Suivi' } };
      }),
      delete: jest.fn(async ({ where }) => {
        const idx = db.followups.findIndex((x) => x.id === where.id);
        if (idx < 0) throw new Error('not found');
        return db.followups.splice(idx, 1)[0];
      }),
    },
    problemEvent: { create: jest.fn(async () => ({ id: 1 })) },
    user: {
      findUnique: jest.fn(async ({ where }) => db.users.find((u) => u.id === where.id) || null),
      findMany: jest.fn(async ({ where }) => db.users.filter((u) => where.id.in.includes(u.id))),
    },
    team: { findUnique: jest.fn(async () => null) },
  };
  prisma.__db = db;
  return prisma;
});

// Utilisateur courant paramétrable par test (préfixe mockUser requis par jest.mock)
let mockUser = { sub: 1, id: 1, email: 'admin@prosuma.ci', role: 'ADMIN' };
jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = mockUser;
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

const patchJson = async (path, payload) => {
  const res = await fetch(`${base}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
};
const del = async (path) => {
  const res = await fetch(`${base}${path}`, { method: 'DELETE' });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

describe('PATCH /problems/:id — multi-assignation et observateurs', () => {
  it('remplace les assignés et synchronise assignedToId sur le premier', async () => {
    const { status, body } = await patchJson('/problems/1', { assigneeIds: [3, 5] });

    expect(status).toBe(200);
    expect(prisma.problem.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        assignees: { set: [{ id: 3 }, { id: 5 }] },
        assignedToId: 3,
      }),
    }));
    expect(body.assignedToId).toBe(3);
  });

  it("refuse en 400 un assigné inexistant (pas d'erreur FK 500)", async () => {
    const { status, body } = await patchJson('/problems/1', { assigneeIds: [3, 999] });

    expect(status).toBe(400);
    expect(body.error).toMatch(/introuvable/);
  });

  it('remplace les observateurs avec validation des ids', async () => {
    const { status } = await patchJson('/problems/1', { observerIds: [5, 7] });

    expect(status).toBe(200);
    expect(prisma.problem.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ observers: { set: [{ id: 5 }, { id: 7 }] } }),
    }));
  });
});

describe('PATCH/DELETE /problems/:id/followups/:followupId — droits', () => {
  it("l'auteur peut modifier son suivi (updatedAt renseigné)", async () => {
    mockUser = { sub: 7, id: 7, email: 'auteur@prosuma.ci', role: 'HOTLINE' };
    const { status, body } = await patchJson('/problems/1/followups/10', { content: '<p>Corrigé</p>' });

    expect(status).toBe(200);
    expect(body.followup.content).toBe('<p>Corrigé</p>');
    expect(body.followup.updatedAt).toBeTruthy();
    const evt = prisma.problemEvent.create.mock.calls.at(-1)[0].data;
    expect(evt.type).toBe('FOLLOWUP_EDITED');
  });

  it("un non-auteur non admin est refusé en 403", async () => {
    mockUser = { sub: 3, id: 3, email: 'tech@prosuma.ci', role: 'HOTLINE' };
    const { status, body } = await patchJson('/problems/1/followups/10', { content: '<p>Hack</p>' });

    expect(status).toBe(403);
    expect(body.error).toMatch(/propres commentaires/);
  });

  it('un ADMIN peut supprimer le suivi d’un autre', async () => {
    mockUser = { sub: 1, id: 1, email: 'admin@prosuma.ci', role: 'ADMIN' };
    const { status } = await del('/problems/1/followups/10');

    expect(status).toBe(200);
    expect(prisma.problemFollowup.delete).toHaveBeenCalledWith({ where: { id: 10 } });
  });
});
