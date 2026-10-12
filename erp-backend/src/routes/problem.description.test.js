// Description d'un problème « comme dans les tickets » :
//   1. PATCH /problems/:id sanitisise la description (balises dangereuses
//      retirées, images /uploads conservées — l'affichage s'y appuie),
//   2. POST /problems/:id/content-images téléverse les images collées dans la
//      description et renvoie leur URL relative (miroir content-images tickets),
//   3. POST /problems accepte le multipart de création (marqueurs <!--IMAGE_n-->
//      remplacés par les <img>, validation AVANT création),
//   4. extensions dangereuses refusées / problème introuvable → fichiers libérés,
//   5. un technicien ne peut pas téléverser (plafond rôle : statut seul).
// Même montage HTTP réel que problem.create.test.js (multer ne se joue pas hors (req, res)).
jest.mock('../prismaClient', () => {
  const state = { attachments: [], nextId: 1 };
  return {
    __state: state,
    problem: {
      findUnique: jest.fn(async ({ where }) => (where.id === 1
        ? { id: 1, title: 'Problème réseau', description: 'desc', status: 'NEW', priority: 'P3' }
        : null)),
      create: jest.fn(async ({ data }) => ({ id: 1, ...data })),
      update: jest.fn(async ({ data }) => ({ id: 1, title: 'Problème réseau', description: 'desc', ...data })),
    },
    problemAttachment: {
      create: jest.fn(async ({ data }) => {
        const row = { id: state.nextId++, createdAt: new Date(), ...data };
        state.attachments.push(row);
        return row;
      }),
    },
    problemEvent: { create: jest.fn(async () => ({ id: 1 })) },
    user: { findUnique: jest.fn(async () => null) },
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
jest.mock('../middleware/permissions', () => ({
  requirePermission: () => (req, res, next) => next(),
  hasPermission: jest.fn(async () => true),
}));
jest.mock('../services/auditLogService', () => ({ auditLog: jest.fn(async () => {}) }));

const fs = require('fs');
const path = require('path');
const express = require('express');
const prisma = require('../prismaClient');
const router = require('./problem.routes');

const ATTACHMENTS_DIR = path.join(process.cwd(), 'uploads', 'problem-attachments');
const createdFiles = [];

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
  for (const file of createdFiles) { try { fs.unlinkSync(file); } catch {} }
  if (server.closeAllConnections) server.closeAllConnections();
  server.close(done);
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000037', 'hex');

// Contenu unique par test : les suites tournent en parallèle dans le même
// dossier, on identifie donc nos fichiers par leur contenu et non par un compte.
function uniqueBuffer(tag) {
  return Buffer.from(`unique-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function filesWithContent(buf) {
  return fs.readdirSync(ATTACHMENTS_DIR).filter((name) => {
    try { return fs.readFileSync(path.join(ATTACHMENTS_DIR, name)).equals(buf); } catch { return false; }
  });
}

async function patchDescription(description) {
  const res = await fetch(`${base}/problems/1`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
  return { status: res.status, body: await res.json() };
}

async function postContentImages({ id = 1, files = [] } = {}) {
  const fd = new FormData();
  for (const f of files) fd.append('images', new Blob([f.buffer], { type: f.type }), f.name);
  const res = await fetch(`${base}/problems/${id}/content-images`, { method: 'POST', body: fd });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  mockUser = { sub: 1, id: 1, email: 'admin@prosuma.ci', role: 'ADMIN' };
  prisma.problem.create.mockClear();
  prisma.problem.update.mockClear();
  prisma.problemEvent.create.mockClear();
});

async function postCreate({ fields = {}, files = [], json = null } = {}) {
  if (json) {
    const res = await fetch(`${base}/problems`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(json),
    });
    return { status: res.status, body: await res.json() };
  }
  const fd = new FormData();
  Object.entries(fields).forEach(([key, value]) => fd.append(key, value));
  for (const f of files) fd.append('images', new Blob([f.buffer], { type: f.type }), f.name);
  const res = await fetch(`${base}/problems`, { method: 'POST', body: fd });
  return { status: res.status, body: await res.json() };
}

describe('PATCH /problems/:id — description', () => {
  it('conserve les images /uploads et retire les balises dangereuses', async () => {
    const { status, body } = await patchDescription(
      '<p>Bonjour<script>alert(1)</script><img src="/uploads/ticket-attachments/1788969547798-4jz17m.png" alt="image collée" /></p>'
    );

    expect(status).toBe(200);
    const saved = prisma.problem.update.mock.calls[0][0].data.description;
    // L'image inline d'origine doit survivre : c'est elle qui ne s'affichait pas
    expect(saved).toContain('<img src="/uploads/ticket-attachments/1788969547798-4jz17m.png"');
    expect(saved).not.toContain('<script');
    expect(body.description).toBe(saved);
  });

  it("retire les attributs d'événement et les protocoles dangereux", async () => {
    const { status } = await patchDescription('<p onclick="evil()">clic</p><a href="javascript:alert(1)">x</a>');

    expect(status).toBe(200);
    const saved = prisma.problem.update.mock.calls[0][0].data.description;
    expect(saved).not.toContain('onclick');
    expect(saved).not.toContain('javascript:');
  });
});

describe('POST /problems — création avec images collées', () => {
  it("remplace les marqueurs d'image par des <img> et crée les pièces jointes", async () => {
    const { status, body } = await postCreate({
      fields: { title: 'Problème réseau', description: 'Capture du bug\n\n<!--IMAGE_0-->' },
      files: [{ name: 'capture.png', type: 'image/png', buffer: PNG }],
    });

    expect(status).toBe(201);
    expect(body.description).toMatch(/<img src="\/uploads\/problem-attachments\/[^"]+" alt="image jointe" \/>/);
    expect(body.description).not.toMatch(/<!--IMAGE_/);

    const row = prisma.__state.attachments.find((a) => a.problemId === 1 && a.filename === 'capture.png');
    expect(row).toBeDefined();
    const localFile = path.join(process.cwd(), row.localFilepath);
    createdFiles.push(localFile);
    expect(fs.existsSync(localFile)).toBe(true);
  });

  it('conserve la création JSON sans image et sanitisise la description', async () => {
    const { status, body } = await postCreate({
      json: { title: 'Simple', description: '<p>OK<script>evil()</script></p>' },
    });

    expect(status).toBe(201);
    expect(body.description).toContain('<p>OK</p>');
    expect(body.description).not.toContain('<script');
    expect(prisma.problem.create).toHaveBeenCalledTimes(1);
  });

  it('refuse une extension dangereuse sans rien créer', async () => {
    const content = uniqueBuffer('create-exe');
    const { status, body } = await postCreate({
      fields: { title: 'Tentative', description: 'Capture <!--IMAGE_0-->' },
      files: [{ name: 'malware.exe', type: 'application/octet-stream', buffer: content }],
    });

    expect(status).toBe(400);
    expect(JSON.stringify(body)).toMatch(/dangereuse refusée/);
    expect(prisma.problem.create).not.toHaveBeenCalled();
    expect(filesWithContent(content)).toHaveLength(0);
  });

  it('libère les fichiers quand la validation échoue (description manquante)', async () => {
    const content = uniqueBuffer('create-nodesc');
    const { status } = await postCreate({
      fields: { title: 'Sans description' },
      files: [{ name: 'x.png', type: 'image/png', buffer: content }],
    });

    expect(status).toBe(400);
    expect(prisma.problem.create).not.toHaveBeenCalled();
    expect(filesWithContent(content)).toHaveLength(0);
  });
});

describe('POST /problems/:id/content-images — images de la description', () => {
  it("téléverse l'image collée et renvoie son URL relative", async () => {
    const { status, body } = await postContentImages({
      files: [{ name: 'capture.png', type: 'image/png', buffer: PNG }],
    });

    expect(status).toBe(200);
    expect(body.images).toHaveLength(1);
    expect(body.images[0].url).toMatch(/^\/uploads\/problem-attachments\/.+\.png$/);
    expect(body.images[0].filename).toBe('capture.png');

    const localFile = path.join(process.cwd(), body.images[0].url.replace(/^\//, ''));
    createdFiles.push(localFile);
    expect(fs.existsSync(localFile)).toBe(true);
  });

  it('accepte plusieurs images en une seule requête', async () => {
    const { status, body } = await postContentImages({
      files: [
        { name: 'a.png', type: 'image/png', buffer: PNG },
        { name: 'b.png', type: 'image/png', buffer: PNG },
      ],
    });

    expect(status).toBe(200);
    expect(body.images).toHaveLength(2);
    for (const img of body.images) {
      const localFile = path.join(process.cwd(), img.url.replace(/^\//, ''));
      createdFiles.push(localFile);
      expect(fs.existsSync(localFile)).toBe(true);
    }
  });

  it('refuse une extension dangereuse sans rien écrire', async () => {
    const content = uniqueBuffer('exe');
    const { status, body } = await postContentImages({
      files: [{ name: 'malware.exe', type: 'application/octet-stream', buffer: content }],
    });

    expect(status).toBe(400);
    expect(JSON.stringify(body)).toMatch(/dangereuse refusée/);
    expect(filesWithContent(content)).toHaveLength(0);
  });

  it('refuse une requête sans image', async () => {
    const { status } = await postContentImages({ files: [] });
    expect(status).toBe(400);
  });

  it('refuse le téléversement sur un problème introuvable et libère les fichiers', async () => {
    const content = uniqueBuffer('missing');
    const { status } = await postContentImages({
      id: 999,
      files: [{ name: 'x.png', type: 'image/png', buffer: content }],
    });

    expect(status).toBe(404);
    expect(filesWithContent(content)).toHaveLength(0);
  });

  it('refuse un technicien (plafond rôle : statut seul) avant tout écriture', async () => {
    mockUser = { sub: 42, id: 42, email: 'tech@prosuma.ci', role: 'TECHNICIAN', teamId: 7 };
    const content = uniqueBuffer('tech');
    const { status } = await postContentImages({
      files: [{ name: 'x.png', type: 'image/png', buffer: content }],
    });

    expect(status).toBe(403);
    expect(filesWithContent(content)).toHaveLength(0);
  });
});
