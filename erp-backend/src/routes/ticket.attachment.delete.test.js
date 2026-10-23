// DELETE /tickets/:id/attachments/:attachmentId — retrait d'une pièce jointe :
//   1. suppression de l'enregistrement ET du fichier sur disque → 200,
//   2. pièce jointe inexistante → 404,
//   3. pièce jointe rattachée à un AUTRE ticket → 404 (pas de suppression croisée),
//   4. sans tickets.manage : assigné du ticket retirant SA propre PJ → 200,
//   5. assigné retirant la PJ d'un autre → 403,
//   6. auteur de la PJ mais non assigné → 403.
// Même montage HTTP réel que ticket.patch.technician.test.js (multer ne se joue pas hors (req, res)).
jest.mock('../prismaClient', () => {
  const state = { attachments: [], nextId: 1, ticketRow: null };
  return {
    __state: state,
    ticket: {
      findUnique: jest.fn(),
      findFirst: jest.fn(async () => state.ticketRow),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    ticketFieldCorrection: { create: jest.fn(async () => ({ id: 1 })) },
    user: { findUnique: jest.fn(async () => null) },
    systemSettings: { findUnique: jest.fn(async () => null) },
    ticketAttachment: {
      findFirst: jest.fn(async ({ where } = {}) =>
        state.attachments.find((a) => a.id === where.id && a.ticketId === where.ticketId) || null),
      delete: jest.fn(async ({ where }) => {
        const idx = state.attachments.findIndex((a) => a.id === where.id);
        if (idx >= 0) state.attachments.splice(idx, 1);
        return { id: where.id };
      }),
    },
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
  // Configurable par test : true = tickets.manage, false = contrainte assigné/auteur
  hasPermission: jest.fn(() => true),
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

const fs = require('fs');
const path = require('path');
const express = require('express');
const prisma = require('../prismaClient');
const { hasPermission } = require('../middleware/permissions');
const router = require('./ticket.routes');

const ATTACHMENTS_DIR = path.join(process.cwd(), 'uploads', 'ticket-attachments');

let server;
let base;

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
  // Nettoyage des fichiers créés par les tests (dossier uploads/ticket-attachments)
  for (const row of prisma.__state.attachments) {
    if (row.localFilepath) { try { fs.unlinkSync(path.join(process.cwd(), row.localFilepath)); } catch {} }
  }
  if (server.closeAllConnections) server.closeAllConnections();
  server.close(done);
});

function seedAttachment({ ticketId = 1, uploadedById = null } = {}) {
  fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
  const safeFilename = `test-del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const relPath = path.join('uploads', 'ticket-attachments', safeFilename);
  fs.writeFileSync(path.join(process.cwd(), relPath), Buffer.from('89504e47', 'hex'));
  const row = {
    id: prisma.__state.nextId++,
    ticketId,
    filename: 'photo.png',
    mimeType: 'image/png',
    localFilepath: relPath,
    source: 'MANUAL_UPLOAD',
    uploadedById,
    createdAt: new Date(),
  };
  prisma.__state.attachments.push(row);
  return row;
}

describe('DELETE /tickets/:id/attachments/:attachmentId', () => {
  beforeEach(() => {
    hasPermission.mockReturnValue(true);
    prisma.__state.ticketRow = null;
  });

  it("supprime l'enregistrement et le fichier sur disque → 200", async () => {
    const att = seedAttachment({ ticketId: 1 });
    const localPath = path.join(process.cwd(), att.localFilepath);
    expect(fs.existsSync(localPath)).toBe(true);

    const res = await fetch(`${base}/tickets/1/attachments/${att.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fs.existsSync(localPath)).toBe(false);
    expect(prisma.__state.attachments.some((a) => a.id === att.id)).toBe(false);
  });

  it('404 si la pièce jointe nexiste pas', async () => {
    const res = await fetch(`${base}/tickets/1/attachments/999999`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it("404 si la pièce jointe appartient à un autre ticket", async () => {
    const att = seedAttachment({ ticketId: 1 });
    const res = await fetch(`${base}/tickets/2/attachments/${att.id}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(prisma.__state.attachments.some((a) => a.id === att.id)).toBe(true);
  });

  it("200 si l'assigné retire une pièce jointe qu'il a jointe lui-même (sans tickets.manage)", async () => {
    hasPermission.mockReturnValue(false);
    // sub de authenticate = 1 : ticket assigné à l'utilisateur 1, PJ uploadée par lui
    prisma.__state.ticketRow = { id: 1 };
    const att = seedAttachment({ ticketId: 1, uploadedById: 1 });
    const res = await fetch(`${base}/tickets/1/attachments/${att.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(prisma.__state.attachments.some((a) => a.id === att.id)).toBe(false);
  });

  it("403 si l'assigné retire la pièce jointe d'un autre (sans tickets.manage)", async () => {
    hasPermission.mockReturnValue(false);
    prisma.__state.ticketRow = { id: 1 };
    const att = seedAttachment({ ticketId: 1, uploadedById: 42 });
    const res = await fetch(`${base}/tickets/1/attachments/${att.id}`, { method: 'DELETE' });
    expect(res.status).toBe(403);
    expect(prisma.__state.attachments.some((a) => a.id === att.id)).toBe(true);
  });

  it("403 si l'auteur de la pièce jointe n'est pas assigné au ticket (sans tickets.manage)", async () => {
    hasPermission.mockReturnValue(false);
    // ticket assigné à quelqu'un d'autre (ticketRow présent mais le WHERE assigné échoue
    // → findFirst retourne null dans ce mock : simule un ticket non assigné à l'utilisateur)
    prisma.__state.ticketRow = null;
    const att = seedAttachment({ ticketId: 1, uploadedById: 1 });
    const res = await fetch(`${base}/tickets/1/attachments/${att.id}`, { method: 'DELETE' });
    expect(res.status).toBe(403);
    expect(prisma.__state.attachments.some((a) => a.id === att.id)).toBe(true);
  });
});
