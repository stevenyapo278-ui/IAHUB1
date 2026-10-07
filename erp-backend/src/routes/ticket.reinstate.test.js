// POST /tickets/:id/reinstate — réintégration d'un ticket rejeté :
//   1. REJECTED → repasse en PENDING, rouvre en OPEN, vide approvalNote/approuvé par,
//      restaure les brouillons IA tués par le rejet, journalise et relance le SLA,
//   2. un ticket non rejeté → 409, un ticket inexistant → 404,
//   3. un TECHNICIAN reste bloqué (rejet et réintégration de même niveau).
jest.mock('../prismaClient', () => ({
  ticket: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  ticketFieldCorrection: { create: jest.fn(async () => ({ id: 1 })) },
  aiEmailDraft: { updateMany: jest.fn(async () => ({ count: 1 })) },
  followup: { create: jest.fn(async () => ({ id: 1 })) },
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
jest.mock('../services/senderReputation', () => ({ recordDecision: jest.fn(async () => {}) }));

const express = require('express');
const prisma = require('../prismaClient');
const { applySla } = require('../services/slaService');
const { logEvent } = require('../services/ticketEvent');
const { auditLog } = require('../services/auditLogService');
const { emitTicketUpdated } = require('../utils/socket');
const router = require('./ticket.routes');

const ADMIN = { sub: 2, id: 2, email: 'admin@prosuma.ci', fullName: 'Admin', role: 'ADMIN', teamId: 10 };
const TECHNICIAN = { sub: 1, id: 1, email: 'tech@prosuma.ci', fullName: 'Tech', role: 'TECHNICIAN', teamId: 10 };

let server;
let base;

function setTicket(overrides = {}) {
  const ticket = {
    id: 1,
    title: 'Demande refusée',
    status: 'CLOSED',
    approvalStatus: 'REJECTED',
    approvalNote: 'Hors périmètre',
    approvedById: 2,
    approvedAt: new Date('2026-10-06T09:00:00Z'),
    closedAt: new Date('2026-10-06T09:00:00Z'),
    sourceEmail: null,
    ...overrides,
  };
  prisma.ticket.findUnique.mockImplementation(async () => ({ ...ticket }));
  prisma.ticket.update.mockImplementation(async ({ data }) => ({ ...ticket, ...data }));
  return ticket;
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
  mockCurrentUser = { ...ADMIN };
  jest.clearAllMocks();
  prisma.ticket.findUnique.mockReset();
  prisma.ticket.update.mockReset();
  setTicket();
});

const reinstate = async (id, user) => {
  if (user) mockCurrentUser = user;
  const res = await fetch(`${base}/tickets/${id}/reinstate`, { method: 'POST' });
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
};

describe('POST /tickets/:id/reinstate — réintégration', () => {
  test('ticket rejeté → PENDING + réouvert en OPEN, journalisé, brouillons restaurés, SLA relancé', async () => {
    const { status, body } = await reinstate(1);

    expect(status).toBe(200);
    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        approvalStatus: 'PENDING',
        approvedById: null,
        approvedAt: null,
        approvalNote: null,
        status: 'OPEN',
        closedAt: null,
      },
    });
    expect(body.approvalStatus).toBe('PENDING');
    expect(body.status).toBe('OPEN');
    expect(body.approvalNote).toBeNull();

    expect(logEvent).toHaveBeenCalledWith(1, 'REOPENED', 'admin@prosuma.ci', { via: 'reintegration' });
    expect(auditLog).toHaveBeenCalledWith('TICKET_REINSTATED', expect.objectContaining({ targetId: 1 }));
    expect(emitTicketUpdated).toHaveBeenCalledWith(expect.objectContaining({ approvalStatus: 'PENDING' }), { approvalStatus: 'PENDING' });

    // Brouillons tués par le rejet (motif « … ticket #1 : … ») remis en attente
    expect(prisma.aiEmailDraft.updateMany).toHaveBeenCalledWith({
      where: { ticketId: 1, status: 'REJECTED', reviewNote: { contains: 'ticket #1' } },
      data: { status: 'PENDING', reviewedById: null, reviewedAt: null, reviewNote: null, sentAt: null },
    });

    // Suivi public + SLA suspendu (PENDING = pas d'échéance)
    expect(prisma.followup.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ticketId: 1, content: expect.stringContaining('réintégré') }),
    }));
    expect(applySla).toHaveBeenCalledWith(expect.objectContaining({ approvalStatus: 'PENDING' }));
  });

  test('ticket non rejeté → 409, rien n’est écrit', async () => {
    setTicket({ approvalStatus: 'APPROVED', status: 'OPEN' });

    const { status } = await reinstate(1);

    expect(status).toBe(409);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
    expect(applySla).not.toHaveBeenCalled();
  });

  test('ticket inexistant → 404', async () => {
    prisma.ticket.findUnique.mockImplementation(async () => null);

    const { status } = await reinstate(999);

    expect(status).toBe(404);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  test('un technicien ne peut pas réintégrer (403)', async () => {
    const { status } = await reinstate(1, TECHNICIAN);

    expect(status).toBe(403);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });
});
