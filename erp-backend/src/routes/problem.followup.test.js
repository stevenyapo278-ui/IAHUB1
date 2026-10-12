// Suivi d'un problème « comme dans les tickets » :
//   1. un suivi accepte les images collées (FormData + marqueurs <!--IMAGE_n-->),
//   2. le contenu est sanitisé et les fichiers écrits sur disque puis référencés,
//   3. upload / téléchargement / suppression de pièces jointes,
//   4. les extensions dangereuses sont refusées.
// Même montage HTTP réel que problem.create.test.js (multer ne se joue pas hors (req, res)).
jest.mock('../prismaClient', () => {
  const state = {
    attachments: [],
    nextId: 1,
    problem: {
      id: 1, title: 'Problème réseau', description: 'desc', status: 'NEW',
      assignedToId: null, teamId: null, requesterId: 9,
      assignees: [], observers: [],
    },
  };
  return {
    __state: state,
    problem: {
      findUnique: jest.fn(async ({ where, include } = {}) => {
        if (where.id !== 1) return null;
        if (include && include.attachments) return { ...state.problem, attachments: [...state.attachments] };
        return { ...state.problem };
      }),
      findFirst: jest.fn(async ({ where } = {}) => {
        if (where.id !== 1) return null;
        const assigneeId = where && where.assignees && where.assignees.some && where.assignees.some.id;
        if (assigneeId !== undefined && state.problem.assignees.includes(assigneeId)) return { id: 1 };
        const observerId = where && where.observers && where.observers.some && where.observers.some.id;
        if (observerId !== undefined && state.problem.observers.includes(observerId)) return { id: 1 };
        return null;
      }),
    },
    problemAttachment: {
      create: jest.fn(async ({ data }) => {
        const row = { id: state.nextId++, createdAt: new Date(), ...data };
        state.attachments.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where } = {}) => state.attachments.find((a) => a.id === where.id && a.problemId === where.problemId) || null),
      delete: jest.fn(async ({ where }) => {
        const idx = state.attachments.findIndex((a) => a.id === where.id);
        if (idx >= 0) state.attachments.splice(idx, 1);
        return { id: where.id };
      }),
    },
    problemFollowup: { create: jest.fn(async ({ data }) => ({ id: 99, updatedAt: null, ...data })) },
    problemEvent: { create: jest.fn(async () => ({ id: 1 })) },
  };
});
// Utilisateur courant paramétrable par test (préfixe mockUser requis par jest.mock)
let mockUser = { sub: 1, id: 1, email: 'admin@prosuma.ci', role: 'ADMIN' };
jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = mockUser;
    next();
  },
}));
// hasPermission paramétrable : true = détient problems.manage (ancien comportement)
let mockHasPermission = true;
jest.mock('../middleware/permissions', () => ({
  requirePermission: () => (req, res, next) => next(),
  hasPermission: jest.fn(async () => mockHasPermission),
}));
jest.mock('../services/auditLogService', () => ({ auditLog: jest.fn(async () => {}) }));

const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const prisma = require('../prismaClient');
const router = require('./problem.routes');

const ATTACHMENTS_DIR = path.join(process.cwd(), 'uploads', 'problem-attachments');

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
  // Nettoyage des fichiers créés par les tests (dossier uploads/problem-attachments)
  for (const row of prisma.__state.attachments) {
    if (row.localFilepath) { try { fs.unlinkSync(path.join(process.cwd(), row.localFilepath)); } catch {} }
  }
  if (server.closeAllConnections) server.closeAllConnections();
  server.close(done);
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000037', 'hex');

async function postFollowup({ content, files = [] }) {
  const fd = new FormData();
  if (content !== undefined) fd.append('content', content);
  for (const f of files) fd.append('images', new Blob([f.buffer], { type: f.type }), f.name);
  const res = await fetch(`${base}/problems/1/followups`, { method: 'POST', body: fd });
  return { status: res.status, body: await res.json() };
}

async function postJson(pathname, payload) {
  const res = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

// Réinitialise l'utilisateur et le problème avant chaque test (états mutables).
beforeEach(() => {
  mockUser = { sub: 1, id: 1, email: 'admin@prosuma.ci', role: 'ADMIN' };
  mockHasPermission = true;
  Object.assign(prisma.__state.problem, {
    status: 'NEW',
    assignedToId: null,
    teamId: null,
    requesterId: 9,
    assignees: [],
    observers: [],
  });
});

describe('POST /problems/:id/followups — suivi avec captures', () => {
  it('accepte un suivi JSON simple (compatibilité existante)', async () => {
    const res = await fetch(`${base}/problems/1/followups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Suivi texte simple' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.content).toBe('Suivi texte simple');
    expect(body.authorId).toBe(1);
  });

  it("remplace le marqueur d'image par une balise <img> et crée la pièce jointe", async () => {
    const { status, body } = await postFollowup({
      content: 'Capture du bug <!--IMAGE_0-->',
      files: [{ name: 'capture.png', type: 'image/png', buffer: PNG }],
    });

    expect(status).toBe(201);
    expect(body.content).toMatch(/<img src="\/uploads\/problem-attachments\/[^"]+" alt="image jointe" \/>/);
    expect(body.content).not.toMatch(/<!--IMAGE_/);
    expect(body.attachments).toHaveLength(1);

    const row = prisma.__state.attachments.find((a) => a.id === body.attachments[0].id);
    expect(row.filename).toBe('capture.png');
    expect(fs.existsSync(path.join(process.cwd(), row.localFilepath))).toBe(true);
  });

  it('refuse une extension dangereuse sans rien écrire', async () => {
    const before = prisma.__state.attachments.length;
    const { status, body } = await postFollowup({
      content: 'Tentative <!--IMAGE_0-->',
      files: [{ name: 'malware.exe', type: 'application/octet-stream', buffer: Buffer.from('MZ') }],
    });

    expect(status).toBe(400);
    expect(JSON.stringify(body)).toMatch(/dangereuse refusée/);
    expect(prisma.__state.attachments).toHaveLength(before);
  });

  it('refuse un suivi vide', async () => {
    const { status } = await postFollowup({ content: '   ' });
    expect(status).toBe(400);
  });

  it('refuse le suivi sur un problème inexistant et libère les fichiers', async () => {
    const fd = new FormData();
    fd.append('content', 'Inexistant <!--IMAGE_0-->');
    fd.append('images', new Blob([PNG], { type: 'image/png' }), 'x.png');
    const before = fs.readdirSync(ATTACHMENTS_DIR).length;
    const res = await fetch(`${base}/problems/999/followups`, { method: 'POST', body: fd });

    expect(res.status).toBe(404);
    expect(fs.readdirSync(ATTACHMENTS_DIR).length).toBe(before);
  });
});

// Droits de suivi — miroir de POST /tickets/:id/followups : un technicien
// assigné (direct ou multi) ou de l'équipe peut commenter, un ADMIN sans
// problems.manage reste refusé (ancien comportement requirePermission conservé).
describe('POST /problems/:id/followups — droits (miroir tickets)', () => {
  it('un technicien assigné directement peut ajouter un suivi', async () => {
    mockUser = { sub: 42, id: 42, email: 'tech@prosuma.ci', role: 'TECHNICIAN', teamId: 7 };
    mockHasPermission = false;
    prisma.__state.problem.assignedToId = 42;

    const { status } = await postJson('/problems/1/followups', { content: 'Suivi du technicien' });
    expect(status).toBe(201);
  });

  it('un technicien multi-assigné peut ajouter un suivi', async () => {
    mockUser = { sub: 43, id: 43, email: 'tech2@prosuma.ci', role: 'TECHNICIAN', teamId: 7 };
    mockHasPermission = false;
    prisma.__state.problem.assignees = [43];

    const { status } = await postJson('/problems/1/followups', { content: 'Suivi multi-assigné' });
    expect(status).toBe(201);
  });

  it("un technicien de l'équipe du problème peut ajouter un suivi", async () => {
    mockUser = { sub: 44, id: 44, email: 'tech3@prosuma.ci', role: 'TECHNICIAN', teamId: 7 };
    mockHasPermission = false;
    prisma.__state.problem.teamId = 7;

    const { status } = await postJson('/problems/1/followups', { content: "Suivi de l'équipe" });
    expect(status).toBe(201);
  });

  it('un technicien non assigné est refusé en 403', async () => {
    mockUser = { sub: 45, id: 45, email: 'tech4@prosuma.ci', role: 'TECHNICIAN', teamId: 7 };
    mockHasPermission = false;
    prisma.__state.problem.teamId = 8;

    const { status, body } = await postJson('/problems/1/followups', { content: 'Indu' });
    expect(status).toBe(403);
    expect(body.error).toMatch(/assignés ou qui appartiennent/);
  });

  it('un technicien assigné ne peut pas commenter un problème résolu', async () => {
    mockUser = { sub: 42, id: 42, email: 'tech@prosuma.ci', role: 'TECHNICIAN', teamId: 7 };
    mockHasPermission = false;
    prisma.__state.problem.assignedToId = 42;
    prisma.__state.problem.status = 'SOLVED';

    const { status, body } = await postJson('/problems/1/followups', { content: 'Trop tard' });
    expect(status).toBe(403);
    expect(body.error).toMatch(/résolu ou fermé/);
  });

  it('un ADMIN sans problems.manage reste refusé en 403', async () => {
    mockUser = { sub: 2, id: 2, email: 'admin2@prosuma.ci', role: 'ADMIN' };
    mockHasPermission = false;

    const { status, body } = await postJson('/problems/1/followups', { content: 'Sans droit' });
    expect(status).toBe(403);
    expect(body.error).toBe('Accès refusé');
  });

  it('le demandeur peut commenter son propre problème', async () => {
    mockUser = { sub: 9, id: 9, email: 'demandeur@prosuma.ci', role: 'REQUESTER' };
    mockHasPermission = false;

    const { status } = await postJson('/problems/1/followups', { content: 'Question du demandeur' });
    expect(status).toBe(201);
  });

  it("un demandeur étranger non observateur reçoit 404 (pas d'existence fuitée)", async () => {
    mockUser = { sub: 10, id: 10, email: 'autre@prosuma.ci', role: 'REQUESTER' };
    mockHasPermission = false;

    const { status } = await postJson('/problems/1/followups', { content: 'Intrus' });
    expect(status).toBe(404);
  });

  it("un observateur peut commenter (miroir des tickets)", async () => {
    mockUser = { sub: 10, id: 10, email: 'observateur@prosuma.ci', role: 'REQUESTER' };
    mockHasPermission = false;
    prisma.__state.problem.observers = [10];

    const { status } = await postJson('/problems/1/followups', { content: 'Vu et approuvé' });
    expect(status).toBe(201);
  });
});

describe('Pièces jointes du problème', () => {
  it("upload, téléchargement puis suppression d'un fichier", async () => {
    const fd = new FormData();
    fd.append('files', new Blob([PNG], { type: 'image/png' }), 'photo.png');
    const up = await fetch(`${base}/problems/1/attachments`, { method: 'POST', body: fd });
    expect(up.status).toBe(201);
    const { attachments } = await up.json();
    // l'état du mock partagé conserve la capture du test précédent
    const att = attachments.find((a) => a.filename === 'photo.png');
    expect(att).toBeTruthy();

    const file = await fetch(`${base}/problems/1/attachments/${att.id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toContain('image/png');
    const localPath = path.join(process.cwd(), att.localFilepath);
    expect(fs.existsSync(localPath)).toBe(true);

    const del = await fetch(`${base}/problems/1/attachments/${att.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(fs.existsSync(localPath)).toBe(false);
    expect(prisma.__state.attachments.some((a) => a.id === att.id)).toBe(false);
  });

  it('400 si aucun fichier fourni', async () => {
    const fd = new FormData();
    fd.append('files', new Blob([PNG], { type: 'image/png' }), 'vide.png');
    // champ vide : multer n'enregistre rien → on simule l'absence de fichier
    const res = await fetch(`${base}/problems/1/attachments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'rien=1',
    });
    expect(res.status).toBe(400);
  });
});
