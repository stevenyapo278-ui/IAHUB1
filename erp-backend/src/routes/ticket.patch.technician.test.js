// PATCH /tickets/:id — plafond par RÔLE TECHNICIAN (allowTechnicianStatusOnly) :
//   1. ticket de SON ÉQUIPE + { status } → 200 (seul champ autorisé),
//   2. ticket de SON ÉQUIPE + un autre champ → 403,
//   3. ticket hors équipe (même assigné) → 403 (lecture seule),
//   4. ticket résolu/fermé → 403 même avec { status },
//   5. transition de statut invalide → 400 (non-régression),
//   6. ADMIN + whitelist complète → 200 (non-régression).
jest.mock('../prismaClient', () => ({
  ticket: {
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  ticketFieldCorrection: { create: jest.fn(async () => ({ id: 1 })) },
  user: { findUnique: jest.fn(async () => null) },
  systemSettings: { findUnique: jest.fn(async () => null) },
}));

let mockCurrentUser;
jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = mockCurrentUser;
    next();
  },
}));

jest.mock('../middleware/permissions', () => ({
  requirePermission: () => (req, res, next) => next(),
}));

jest.mock('../utils/socket', () => ({
  emitTicketCreated: jest.fn(),
  emitTicketUpdated: jest.fn(),
  emitTicketAssigned: jest.fn(),
}));

jest.mock('../services/emailSender', () => ({
  notifyMajorIncidentResolved: jest.fn(async () => {}),
  sendTicketStatusNotification: jest.fn(async () => {}),
  sendResolvedNotificationEmail: jest.fn(async () => {}),
  sendTicketCreationNotification: jest.fn(async () => {}),
  sendAcknowledgement: jest.fn(async () => {}),
  sendAssignmentNotificationEmail: jest.fn(async () => {}),
  sendEmail: jest.fn(async () => {}),
}));

jest.mock('../services/slaService', () => ({
  applySla: jest.fn(async () => {}),
  recordFirstResponse: jest.fn(async () => {}),
}));

jest.mock('../services/similarIncidentDetector', () => ({
  updateSimilarityIndexStatus: jest.fn(async () => {}),
  refreshTicketEmbedding: jest.fn(async () => {}),
}));

jest.mock('../services/skillLearningService', () => ({
  learnFromResolution: jest.fn(async () => {}),
}));

jest.mock('../services/ticketQueryService', () => ({
  isRequesterOnly: () => false,
  buildTicketWhereClause: () => ({}),
}));

jest.mock('../services/auditLogService', () => ({ auditLog: jest.fn(async () => {}) }));
jest.mock('../services/ticketEvent', () => ({ logEvent: jest.fn(async () => {}) }));

const express = require('express');
const http = require('http');
const prisma = require('../prismaClient');
const router = require('./ticket.routes');

let server;
let base;
let ticketState;

const TEAM_TECHNICIAN = { sub: 1, id: 1, email: 'tech@prosuma.ci', fullName: 'Tech', role: 'TECHNICIAN', teamId: 10 };
const ADMIN = { sub: 2, id: 2, email: 'admin@prosuma.ci', fullName: 'Admin', role: 'ADMIN', teamId: 10 };

function setTicket(overrides = {}) {
  ticketState = {
    id: 1,
    status: 'NEW',
    teamId: 10,
    assignedToId: 1,
    title: 'PROBLEME RESEAU',
    content: '<p>Souci</p>',
    priority: 'P3',
    category: 'Réseau',
    type: 'INCIDENT',
    urgency: 'LOW',
    impact: 'LOW',
    source: 'EMAIL',
    externalId: null,
    requesterId: 5,
    requesterIds: [5],
    sourceName: 'Jean',
    sourceEmail: 'jean@client.ci',
    isMajorIncident: false,
    impactedSites: [],
    observers: [],
    dueDate: null,
    locationId: null,
    approvalStatus: null,
    ...overrides,
  };
  prisma.ticket.findUnique.mockImplementation(async () => ({ ...ticketState }));
  prisma.ticket.update.mockImplementation(async ({ where, data }) => ({ ...ticketState, ...data }));
}

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/tickets', router);
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
  mockCurrentUser = { ...TEAM_TECHNICIAN };
  prisma.ticket.findUnique.mockReset();
  prisma.ticket.update.mockReset();
  prisma.ticketFieldCorrection.create.mockClear();
  setTicket();
});

const patch = async (id, payload) => {
  const res = await fetch(`${base}/tickets/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
};

describe("PATCH /tickets/:id — plafond TECHNICIAN", () => {
  test('ticket de son équipe : { status } accepté (200)', async () => {
    const res = await patch(1, { status: 'OPEN' });
    expect(res.status).toBe(200);
    expect(prisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'OPEN' }) })
    );
  });

  test('ticket de son équipe : un champ autre que status → 403, aucune écriture', async () => {
    for (const payload of [{ priority: 'P1' }, { title: 'AUTRE TITRE' }, { teamId: 99 }, { assignedToId: 7 }, { requesterId: 8 }, { approvalStatus: 'PENDING' }]) {
      const res = await patch(1, payload);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Un technicien ne peut modifier que le statut des tickets de son équipe.');
    }
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  test('ticket hors équipe (même assigné) → 403 lecture seule', async () => {
    setTicket({ teamId: 99, assignedToId: TEAM_TECHNICIAN.sub });
    const res = await patch(1, { status: 'OPEN' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/lecture seule/);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  test('ticket hors équipe et non assigné → 403', async () => {
    setTicket({ teamId: 99, assignedToId: null });
    const res = await patch(1, { status: 'OPEN' });
    expect(res.status).toBe(403);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  test('ticket résolu/fermé → 403 même avec { status }', async () => {
    for (const status of ['SOLVED', 'CLOSED']) {
      setTicket({ status });
      const res = await patch(1, { status: 'CLOSED' });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/résolu ou fermé/);
    }
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  test('transition de statut invalide → 400 (non-régression)', async () => {
    setTicket({ status: 'NEW' });
    const res = await patch(1, { status: 'PLANNED' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Transition invalide/);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  test('technicien sans équipe sur le ticket → 403', async () => {
    mockCurrentUser = { ...TEAM_TECHNICIAN, teamId: null };
    setTicket({ teamId: 10 });
    const res = await patch(1, { status: 'OPEN' });
    expect(res.status).toBe(403);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });
});

describe("PATCH /tickets/:id — hors plafond (non-régression)", () => {
  test('ADMIN : whitelist complète acceptée (200)', async () => {
    mockCurrentUser = { ...ADMIN };
    const res = await patch(1, {
      title: 'NOUVEAU TITRE',
      priority: 'P1',
      category: 'Matériel',
      teamId: 11,
      assignedToId: 7,
      requesterId: 6,
      status: 'OPEN',
    });
    expect(res.status).toBe(200);
    expect(prisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ priority: 'P1', teamId: 11, assignedToId: 7, status: 'OPEN' }),
      })
    );
  });

  test('ADMIN : champ hors whitelist → 400', async () => {
    mockCurrentUser = { ...ADMIN };
    const res = await patch(1, { glpiTicketId: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Champ non autorisé/);
  });
});
