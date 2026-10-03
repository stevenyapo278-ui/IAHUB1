// Notes personnelles du rail flottant : scoping strict ownerId (une note d'autrui
// = 404, sans fuite), validation des bornes et plafond de notes. Prisma est mocké,
// les handlers sont invoqués directement avec un req utilisateur connecté.
jest.mock('../prismaClient', () => ({
  userNote: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  },
}));

const router = require('./notes.routes');
const prisma = require('../prismaClient');

function findRoute(method, path) {
  return router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
}

function handler(method, path) {
  return findRoute(method, path).route.stack[0].handle;
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const me = { user: { sub: 7, role: 'TECHNICIAN', email: 'tech@x.ci' } };

beforeEach(() => jest.clearAllMocks());

describe('GET /api/notes', () => {
  it('est protégé par authenticate au niveau du routeur', () => {
    const layers = router.stack.filter((l) => !l.route);
    expect(layers.some((l) => (l.handle.name || '').includes('authenticate'))).toBe(true);
  });

  it('liste uniquement mes notes, plus récentes en premier', async () => {
    const notes = [{ id: 1, title: 'A', content: 'x', createdAt: 'd', updatedAt: 'd' }];
    prisma.userNote.findMany.mockResolvedValue(notes);
    const res = makeRes();
    await handler('get', '/')({ ...me }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(notes);
    expect(prisma.userNote.findMany).toHaveBeenCalledWith({
      where: { ownerId: 7 },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: { id: true, title: true, content: true, createdAt: true, updatedAt: true },
    });
  });
});

describe('POST /api/notes', () => {
  it('crée une note appartenant à l\'utilisateur connecté (titre trimé)', async () => {
    prisma.userNote.count.mockResolvedValue(0);
    prisma.userNote.create.mockResolvedValue({ id: 10, ownerId: 7, title: 'Ma note', content: 'Texte' });
    const res = makeRes();
    await handler('post', '/')({ ...me, body: { title: '  Ma note  ', content: 'Texte' } }, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.id).toBe(10);
    expect(prisma.userNote.create).toHaveBeenCalledWith({
      data: { ownerId: 7, title: 'Ma note', content: 'Texte' },
    });
  });

  it('400 si le titre dépasse 120 caractères', async () => {
    const res = makeRes();
    await handler('post', '/')({ ...me, body: { title: 'x'.repeat(121) } }, res);
    expect(res.statusCode).toBe(400);
    expect(prisma.userNote.create).not.toHaveBeenCalled();
  });

  it('400 si le contenu dépasse 10000 caractères', async () => {
    const res = makeRes();
    await handler('post', '/')({ ...me, body: { content: 'x'.repeat(10001) } }, res);
    expect(res.statusCode).toBe(400);
    expect(prisma.userNote.create).not.toHaveBeenCalled();
  });

  it('400 quand la limite de 200 notes est atteinte', async () => {
    prisma.userNote.count.mockResolvedValue(200);
    const res = makeRes();
    await handler('post', '/')({ ...me, body: { title: 'une de trop' } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('200');
    expect(prisma.userNote.create).not.toHaveBeenCalled();
  });
});

describe('PUT /api/notes/:id', () => {
  it('400 si l\'identifiant n\'est pas entier', async () => {
    const res = makeRes();
    await handler('put', '/:id')({ ...me, params: { id: 'abc' }, body: { title: 'x' } }, res);
    expect(res.statusCode).toBe(400);
    expect(prisma.userNote.updateMany).not.toHaveBeenCalled();
  });

  it('404 si la note n\'appartient pas à l\'utilisateur (ou n\'existe pas)', async () => {
    prisma.userNote.updateMany.mockResolvedValue({ count: 0 });
    const res = makeRes();
    await handler('put', '/:id')({ ...me, params: { id: '999' }, body: { title: 'hack' } }, res);

    expect(res.statusCode).toBe(404);
    expect(prisma.userNote.updateMany).toHaveBeenCalledWith({
      where: { id: 999, ownerId: 7 },
      data: { title: 'hack' },
    });
  });

  it('met à jour ma note et renvoie l\'état frais', async () => {
    prisma.userNote.updateMany.mockResolvedValue({ count: 1 });
    prisma.userNote.findFirst.mockResolvedValue({ id: 5, ownerId: 7, title: 'OK', content: 'c' });
    const res = makeRes();
    await handler('put', '/:id')({ ...me, params: { id: '5' }, body: { title: 'OK', content: 'c' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.title).toBe('OK');
  });

  it('400 sans aucun champ à mettre à jour', async () => {
    const res = makeRes();
    await handler('put', '/:id')({ ...me, params: { id: '5' }, body: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(prisma.userNote.updateMany).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/notes/:id', () => {
  it('404 sur une note qui n\'est pas la mienne', async () => {
    prisma.userNote.deleteMany.mockResolvedValue({ count: 0 });
    const res = makeRes();
    await handler('delete', '/:id')({ ...me, params: { id: '42' } }, res);
    expect(res.statusCode).toBe(404);
    expect(prisma.userNote.deleteMany).toHaveBeenCalledWith({ where: { id: 42, ownerId: 7 } });
  });

  it('supprime ma note', async () => {
    prisma.userNote.deleteMany.mockResolvedValue({ count: 1 });
    const res = makeRes();
    await handler('delete', '/:id')({ ...me, params: { id: '42' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ id: 42, deleted: true });
  });
});
