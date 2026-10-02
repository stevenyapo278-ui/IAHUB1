// POST /tickets — rattachement de la conversation email (création depuis l'Inbox) :
//   1. sourceEmailId + outlookConversationId → outlookConversationId / sourceEmail /
//      sourceSubject posés sur le Ticket, IncomingEmail.erpTicketId mis à jour et
//      TicketMessage INBOUND créé avec les identifiants Outlook : les priorités 1
//      (conversationId) et 2 (internetMessageId) de findExistingTicket retrouvent
//      alors CE ticket quand le demandeur répond — sinon chaque relance du fil
//      créait un nouveau ticket,
//   2. création manuelle sans email source → aucun rattachement (non-régression),
//   3. sourceEmailId invalide → 201 sans planter, aucun lien.
// Même montage HTTP réel que ticket.patch.technician.test.js.
jest.mock('../prismaClient', () => ({
  ticket: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  ticketCategory: { findUnique: jest.fn(async () => null) },
  team: { findUnique: jest.fn(async () => null) },
  user: { findUnique: jest.fn(async () => null) },
  incomingEmail: { findUnique: jest.fn(), update: jest.fn(async ({ data }) => ({ id: 42, ...data })) },
  ticketMessage: { create: jest.fn(async ({ data }) => ({ id: 100, ...data })) },
  ticketAttachment: { create: jest.fn(async ({ data }) => ({ id: 1, ...data })) },
  systemSettings: { findUnique: jest.fn(async () => null) },
  ticketFieldCorrection: { create: jest.fn(async () => ({ id: 1 })) },
}));
jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = { sub: 2, id: 2, email: 'admin@prosuma.ci', fullName: 'Admin', role: 'ADMIN' };
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
  saveTicketEmbedding: jest.fn(async () => {}),
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
const prisma = require('../prismaClient');
const router = require('./ticket.routes');

let server;
let base;

const SOURCE_EMAIL = {
  id: 42,
  graphMessageId: 'graph-abc',
  internetMessageId: '<internet-abc@mail.gmail.com>',
  conversationId: 'AAMkAGI2N3Q4',
  inReplyTo: '<parent@mail>',
  fromEmail: 'hussein.fakih@prosuma.ci',
  fromName: 'Houssein Fakih',
  subject: 'URGENT URGENT - Dépannage imprimante Mle Layya FAKHRY',
  bodyPreview: 'Bonsoir, l\'imprimante HP présente un bourrage papier.',
  bodyHtml: '<p>Bonsoir</p>',
  receivedAt: new Date('2026-10-02T15:01:00Z'),
  aiSummary: 'Demande de dépannage imprimante',
  ccRecipients: ['layya.fakhry@prosuma.ci'],
  status: 'PENDING',
  isNewTicket: true,
};

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
  prisma.ticket.create.mockReset();
  prisma.ticket.findUnique.mockReset();
  prisma.ticket.update.mockReset();
  prisma.incomingEmail.findUnique.mockReset();
  prisma.incomingEmail.update.mockReset();
  prisma.ticketMessage.create.mockReset();

  prisma.ticket.create.mockImplementation(async ({ data }) => ({
    id: 7,
    status: data.status || 'NEW',
    approvalStatus: data.approvalStatus || 'APPROVED',
    assignedToId: data.assignedToId || null,
    requesterId: data.requesterId || null,
    category: data.category || null,
    title: data.title,
    priority: data.priority || 'P3',
    ...data,
  }));
  prisma.ticket.findUnique.mockImplementation(async ({ where }) => ({
    id: where.id,
    status: 'NEW',
    approvalStatus: 'APPROVED',
    assignedToId: null,
    requesterId: 2,
    category: null,
    title: 'URGENT URGENT - DÉPANNAGE IMPRIMANTE',
    priority: 'P3',
  }));
});

const post = async (payload) => {
  const res = await fetch(`${base}/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
};

describe('POST /tickets — rattachement conversation email', () => {
  it("pose l'identifiant de conversation et les métadonnées de la source sur le ticket", async () => {
    prisma.incomingEmail.findUnique.mockResolvedValue(SOURCE_EMAIL);

    const { status, body } = await post({
      title: 'URGENT URGENT - Dépannage imprimante',
      content: '<p>Bonsoir, bourrage papier.</p>',
      source: 'Email',
      sourceEmailId: 42,
      outlookConversationId: 'AAMkAGI2N3Q4',
    });

    expect(status).toBe(201);
    expect(body.id).toBe(7);

    const created = prisma.ticket.create.mock.calls[0][0].data;
    expect(created.outlookConversationId).toBe('AAMkAGI2N3Q4');
    expect(created.sourceEmail).toBe(SOURCE_EMAIL.fromEmail);
    expect(created.sourceName).toBe(SOURCE_EMAIL.fromName);
    expect(created.sourceSubject).toBe(SOURCE_EMAIL.subject);
  });

  it("lie l'IncomingEmail au ticket et crée le message initial avec les identifiants Outlook", async () => {
    prisma.incomingEmail.findUnique.mockResolvedValue(SOURCE_EMAIL);

    await post({
      title: 'URGENT URGENT - Dépannage imprimante',
      content: '<p>Bonsoir</p>',
      sourceEmailId: 42,
    });

    expect(prisma.incomingEmail.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { status: 'DONE', erpTicketId: 7, isNewTicket: false },
    });

    // Priorité 2 de findExistingTicket : le TicketMessage porte internetMessageId,
    // inReplyTo et conversationId — c'est ce qui rattache la réponse suivante.
    const msg = prisma.ticketMessage.create.mock.calls[0][0].data;
    expect(msg.ticketId).toBe(7);
    expect(msg.direction).toBe('INBOUND');
    expect(msg.sender).toBe(SOURCE_EMAIL.fromEmail);
    expect(msg.internetMessageId).toBe(SOURCE_EMAIL.internetMessageId);
    expect(msg.inReplyTo).toBe(SOURCE_EMAIL.inReplyTo);
    expect(msg.conversationId).toBe(SOURCE_EMAIL.conversationId);
    expect(msg.outlookMessageId).toBe(SOURCE_EMAIL.graphMessageId);
  });

  it("retombe sur conversationId de l'email source si outlookConversationId n'est pas envoyé", async () => {
    prisma.incomingEmail.findUnique.mockResolvedValue(SOURCE_EMAIL);

    await post({ title: 'RE: suite du fil', content: '<p>ok</p>', sourceEmailId: 42 });

    const created = prisma.ticket.create.mock.calls[0][0].data;
    expect(created.outlookConversationId).toBe(SOURCE_EMAIL.conversationId);
  });

  it("création manuelle sans email source : aucun rattachement (non-régression)", async () => {
    const { status } = await post({ title: 'Demande de compte', content: '<p>Merci</p>' });

    expect(status).toBe(201);
    expect(prisma.incomingEmail.findUnique).not.toHaveBeenCalled();
    expect(prisma.incomingEmail.update).not.toHaveBeenCalled();
    expect(prisma.ticketMessage.create).not.toHaveBeenCalled();
    const created = prisma.ticket.create.mock.calls[0][0].data;
    expect(created.outlookConversationId).toBeUndefined();
    expect(created.sourceEmail).toBeUndefined();
  });

  it("sourceEmailId invalide : 201 sans planter et sans lien", async () => {
    const { status } = await post({ title: 'Test', content: '<p>x</p>', sourceEmailId: 'abc' });

    expect(status).toBe(201);
    expect(prisma.incomingEmail.findUnique).not.toHaveBeenCalled();
    expect(prisma.ticketMessage.create).not.toHaveBeenCalled();
  });

  it("email source introuvable : le ticket est quand même créé", async () => {
    prisma.incomingEmail.findUnique.mockResolvedValue(null);

    const { status, body } = await post({
      title: 'Test',
      content: '<p>x</p>',
      sourceEmailId: 999,
      outlookConversationId: 'AAMkDEAD',
    });

    expect(status).toBe(201);
    expect(body.id).toBe(7);
    expect(prisma.incomingEmail.update).not.toHaveBeenCalled();
    expect(prisma.ticketMessage.create).not.toHaveBeenCalled();
    const created = prisma.ticket.create.mock.calls[0][0].data;
    expect(created.outlookConversationId).toBe('AAMkDEAD');
  });
});
