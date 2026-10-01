// DELETE /locations/:id + POST /locations/:id/reassign — migration des tickets avant suppression :
//   1. un lieu avec des tickets (même sans demandeur) refuse la suppression (409) avec les
//      deux compteurs, pour que l'UI ouvre le modal de migration au lieu d'orpheliner les tickets ;
//   2. un lieu sans rattachement est supprimé (204) ;
//   3. la réassignation migre les tickets vers le lieu cible en mettant à jour locationId ET
//      locationName denormalisé (sinon les tickets garderaient le libellé de l'ancien lieu).
// Même montage HTTP réel que problem.patch.test.js.
jest.mock('../prismaClient', () => ({
  location: { findUnique: jest.fn(), delete: jest.fn() },
  ticket: { count: jest.fn(), updateMany: jest.fn() },
  requesterLocation: { findMany: jest.fn(), upsert: jest.fn(), delete: jest.fn() },
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
const router = require('./location.routes');

let server;
let base;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/locations', router);
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
  prisma.location.findUnique.mockReset();
  prisma.location.delete.mockReset();
  prisma.ticket.count.mockReset();
  prisma.ticket.updateMany.mockReset();
  prisma.requesterLocation.findMany.mockReset();
  prisma.requesterLocation.upsert.mockReset();
  prisma.requesterLocation.delete.mockReset();
  prisma.location.delete.mockResolvedValue({ id: 1 });
  prisma.ticket.updateMany.mockResolvedValue({ count: 0 });
  prisma.ticket.count.mockResolvedValue(0);
  prisma.requesterLocation.findMany.mockResolvedValue([]);
});

const remove = async (id) => {
  const res = await fetch(`${base}/locations/${id}`, { method: 'DELETE' });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

const reassign = async (id, targetLocationId) => {
  const res = await fetch(`${base}/locations/${id}/reassign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetLocationId }),
  });
  return { status: res.status, body: await res.json() };
};

describe('DELETE /locations/:id — garde-fou tickets/demandeurs', () => {
  it("refuse la suppression d'un lieu avec des tickets (même sans demandeur) et renvoie les deux compteurs", async () => {
    prisma.location.findUnique.mockResolvedValue({
      id: 1, name: 'Ancien dépôt', completename: 'Siège > Ancien dépôt',
      _count: { requesterLinks: 0 },
    });
    prisma.ticket.count.mockResolvedValue(12);

    const { status, body } = await remove(1);

    expect(status).toBe(409);
    expect(body.ticketCount).toBe(12);
    expect(body.requesterCount).toBe(0);
    expect(body.error).toMatch(/12 ticket\(s\)/);
    expect(body.error).toMatch(/Migrez-les/);
    expect(prisma.location.delete).not.toHaveBeenCalled();
  });

  it('refuse encore la suppression quand seul des demandeurs sont associés (comportement conservé)', async () => {
    prisma.location.findUnique.mockResolvedValue({
      id: 1, name: 'Ancien dépôt', completename: null,
      _count: { requesterLinks: 3 },
    });
    prisma.ticket.count.mockResolvedValue(0);

    const { status, body } = await remove(1);

    expect(status).toBe(409);
    expect(body.requesterCount).toBe(3);
    expect(body.ticketCount).toBe(0);
    expect(prisma.location.delete).not.toHaveBeenCalled();
  });

  it('supprime un lieu sans aucun rattachement (204)', async () => {
    prisma.location.findUnique.mockResolvedValue({
      id: 1, name: 'Lieu vide', completename: null,
      _count: { requesterLinks: 0 },
    });
    prisma.ticket.count.mockResolvedValue(0);

    const { status } = await remove(1);

    expect(status).toBe(204);
    expect(prisma.location.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('renvoie 404 pour un lieu inexistant', async () => {
    prisma.location.findUnique.mockResolvedValue(null);
    const { status } = await remove(999);
    expect(status).toBe(404);
  });
});

describe('POST /locations/:id/reassign — migration des tickets', () => {
  it('migre les tickets vers le lieu cible avec locationId ET locationName mis à jour', async () => {
    prisma.location.findUnique.mockImplementation(({ where }) => Promise.resolve(
      where.id === 1
        ? { id: 1, name: 'Ancien dépôt', completename: 'Siège > Ancien dépôt' }
        : { id: 2, name: 'Nouveau dépôt', completename: 'Siège > Nouveau dépôt' },
    ));
    prisma.requesterLocation.findMany.mockResolvedValue([]);
    prisma.ticket.updateMany.mockResolvedValue({ count: 7 });

    const { status, body } = await reassign(1, 2);

    expect(status).toBe(200);
    expect(body.ticketsUpdated).toBe(7);
    expect(body.target).toBe('Nouveau dépôt');
    expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
      where: { locationId: 1 },
      // locationName = name du cible (convention locationDetector : name || completename)
      data: { locationId: 2, locationName: 'Nouveau dépôt' },
    });
  });

  it('migre les demandeurs du lieu source vers le cible (fusion si déjà présent)', async () => {
    prisma.location.findUnique.mockImplementation(({ where }) => Promise.resolve(
      where.id === 1
        ? { id: 1, name: 'Ancien dépôt', completename: null }
        : { id: 2, name: 'Nouveau dépôt', completename: null },
    ));
    prisma.requesterLocation.findMany.mockResolvedValue([
      { id: 10, email: 'client@x.ci', assignmentCount: 4, lastUsedAt: new Date('2026-09-01') },
    ]);
    prisma.requesterLocation.upsert.mockResolvedValue({ id: 20 });
    prisma.requesterLocation.delete.mockResolvedValue({ id: 10 });
    prisma.ticket.updateMany.mockResolvedValue({ count: 0 });

    const { status, body } = await reassign(1, 2);

    expect(status).toBe(200);
    expect(body.moved).toBe(1);
    expect(prisma.requesterLocation.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { email_locationId: { email: 'client@x.ci', locationId: 2 } },
    }));
    expect(prisma.requesterLocation.delete).toHaveBeenCalledWith({ where: { id: 10 } });
  });

  it('refuse un lieu cible identique ou manquant (400)', async () => {
    const { status, body } = await reassign(1, 1);
    expect(status).toBe(400);
    expect(body.error).toMatch(/invalide/i);
  });

  it('refuse un lieu cible introuvable (404)', async () => {
    prisma.location.findUnique.mockImplementation(({ where }) => Promise.resolve(
      where.id === 1 ? { id: 1, name: 'Ancien dépôt', completename: null } : null,
    ));
    const { status } = await reassign(1, 42);
    expect(status).toBe(404);
  });
});
