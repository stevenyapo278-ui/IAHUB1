// GET /locations/:id — fiche de détail d'un lieu ouverte depuis la vue Tickets :
//   1. renvoie le lieu + ses compteurs (tickets vivants, dont actifs, demandeurs, actifs) ;
//   2. 404 si le lieu n'existe pas, 400 si l'id n'est pas un entier ;
//   3. les routes littérales à un segment (/requesters, /counts…) restent
//      prioritaires — la route :id est déclarée après elles dans le fichier.
// Même montage HTTP réel que location.delete.migrate.test.js.
jest.mock('../prismaClient', () => ({
  location: { findUnique: jest.fn(), findMany: jest.fn() },
  ticket: { groupBy: jest.fn() },
  requesterLocation: { findMany: jest.fn() },
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
  prisma.location.findMany.mockReset();
  prisma.ticket.groupBy.mockReset();
  prisma.requesterLocation.findMany.mockReset();
  prisma.ticket.groupBy.mockResolvedValue([]);
  prisma.requesterLocation.findMany.mockResolvedValue([]);
});

const get = async (path) => {
  const res = await fetch(`${base}/locations${path}`);
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

describe('GET /locations/:id — fiche de détail', () => {
  it('renvoie le lieu complet avec ses compteurs', async () => {
    prisma.location.findUnique.mockResolvedValue({
      id: 7, name: 'Bâtiment A', completename: 'Siège > Bâtiment A',
      isCustom: false, isActive: true, town: 'Abidjan', country: 'CI',
      building: 'A', room: '201', tag: 'Technique',
      createdAt: new Date('2026-01-15T10:00:00Z'),
      _count: { requesterLinks: 4, assets: 2 },
    });
    prisma.ticket.groupBy.mockResolvedValue([
      { status: 'NEW', _count: 3 },
      { status: 'SOLVED', _count: 5 },
      { status: 'CLOSED', _count: 1 },
    ]);

    const { status, body } = await get('/7');

    expect(status).toBe(200);
    expect(body.name).toBe('Bâtiment A');
    expect(body.requesterCount).toBe(4);
    expect(body.assetCount).toBe(2);
    expect(body.ticketCount).toBe(9);
    // Actifs = hors SOLVED/CLOSED → NEW(3) seulement
    expect(body.openTicketCount).toBe(3);
  });

  it('applique la même exclusion d’approbation que la vue Tickets', async () => {
    prisma.location.findUnique.mockResolvedValue({
      id: 7, name: 'A', _count: { requesterLinks: 0, assets: 0 },
    });
    prisma.ticket.groupBy.mockResolvedValue([]);

    await get('/7');

    expect(prisma.ticket.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ['status'],
      where: expect.objectContaining({
        deletedAt: null,
        locationId: 7,
        // PENDING/REJECTED exclus par défaut (applyDefaultApprovalExclusion)
        approvalStatus: { notIn: ['PENDING', 'REJECTED'] },
      }),
    }));
  });

  it('renvoie 404 pour un lieu inexistant', async () => {
    prisma.location.findUnique.mockResolvedValue(null);
    const { status, body } = await get('/999');
    expect(status).toBe(404);
    expect(body.error).toMatch(/introuvable/i);
  });

  it('renvoie 400 pour un id non entier', async () => {
    const { status } = await get('/abc');
    expect(status).toBe(400);
    expect(prisma.location.findUnique).not.toHaveBeenCalled();
  });
});

describe('GET /locations/:id — priorité des routes littérales', () => {
  it('GET /requesters reste la liste des expéditeurs (pas le lieu "requesters")', async () => {
    prisma.requesterLocation.findMany.mockResolvedValue([
      { id: 11, email: 'client@x.ci', locationId: 3 },
    ]);

    const { status, body } = await get('/requesters');

    expect(status).toBe(200);
    expect(body).toEqual([{ id: 11, email: 'client@x.ci', locationId: 3 }]);
    expect(prisma.location.findUnique).not.toHaveBeenCalled();
  });
});
