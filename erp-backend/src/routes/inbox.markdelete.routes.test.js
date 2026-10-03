// Routes PATCH/DELETE /api/inbox/:id — actions du menu contextuel (spam, suppression).
// Prisma est mock : les handlers sont appelés directement avec des req/res factices.
jest.mock('../prismaClient', () => ({
  incomingEmail: { findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
  ticket: { findMany: jest.fn().mockResolvedValue([]) },
  ticketAttachment: { updateMany: jest.fn() },
}));

const router = require('./inbox.routes');
const prisma = require('../prismaClient');

function findRoute(method, path) {
  return router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const admin = { user: { sub: 7, role: 'ADMIN', sub_id: 7 }, app: { get: () => null } };

beforeEach(() => jest.clearAllMocks());

describe('PATCH /inbox/:id', () => {
  it('marque un email en SPAM et synchronise aiIsSpam', async () => {
    prisma.incomingEmail.findFirst.mockResolvedValue({ id: 3, status: 'DONE' });
    prisma.incomingEmail.update.mockResolvedValue({ id: 3, status: 'SPAM', aiIsSpam: true });

    const res = makeRes();
    await findRoute('patch', '/:id').route.stack[findRoute('patch', '/:id').route.stack.length - 1].handle(
      { ...admin, params: { id: '3' }, body: { status: 'SPAM', aiIsSpam: true } },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(prisma.incomingEmail.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: expect.objectContaining({ status: 'SPAM', aiIsSpam: true }),
    });
    expect(res.body.status).toBe('SPAM');
  });

  it('404 si l\'email n\'existe pas (aucune écriture)', async () => {
    prisma.incomingEmail.findFirst.mockResolvedValue(null);
    const res = makeRes();
    await findRoute('patch', '/:id').route.stack[findRoute('patch', '/:id').route.stack.length - 1].handle(
      { ...admin, params: { id: '404' }, body: { status: 'SPAM' } },
      res
    );

    expect(res.statusCode).toBe(404);
    expect(prisma.incomingEmail.update).not.toHaveBeenCalled();
  });

  it('400 sur un statut hors liste blanche', async () => {
    const res = makeRes();
    await findRoute('patch', '/:id').route.stack[findRoute('patch', '/:id').route.stack.length - 1].handle(
      { ...admin, params: { id: '3' }, body: { status: 'HACKED' } },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(prisma.incomingEmail.update).not.toHaveBeenCalled();
  });

  it('400 si le corps ne contient aucune modification', async () => {
    const res = makeRes();
    await findRoute('patch', '/:id').route.stack[findRoute('patch', '/:id').route.stack.length - 1].handle(
      { ...admin, params: { id: '3' }, body: {} },
      res
    );

    expect(res.statusCode).toBe(400);
  });

  it('400 si l\'id n\'est pas un entier', async () => {
    const res = makeRes();
    await findRoute('patch', '/:id').route.stack[findRoute('patch', '/:id').route.stack.length - 1].handle(
      { ...admin, params: { id: 'abc' }, body: { status: 'SPAM' } },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(prisma.incomingEmail.findFirst).not.toHaveBeenCalled();
  });
});

describe('DELETE /inbox/:id', () => {
  it('supprime l\'email existant et renvoie ok', async () => {
    prisma.incomingEmail.findFirst.mockResolvedValue({ id: 8, subject: 'Spam marketing' });
    prisma.incomingEmail.delete.mockResolvedValue({ id: 8 });

    const res = makeRes();
    await findRoute('delete', '/:id').route.stack[findRoute('delete', '/:id').route.stack.length - 1].handle(
      { ...admin, params: { id: '8' }, body: {} },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, id: 8 });
    expect(prisma.incomingEmail.delete).toHaveBeenCalledWith({ where: { id: 8 } });
  });

  it('404 si l\'email n\'existe pas (rien n\'est supprimé)', async () => {
    prisma.incomingEmail.findFirst.mockResolvedValue(null);
    const res = makeRes();
    await findRoute('delete', '/:id').route.stack[findRoute('delete', '/:id').route.stack.length - 1].handle(
      { ...admin, params: { id: '9' }, body: {} },
      res
    );

    expect(res.statusCode).toBe(404);
    expect(prisma.incomingEmail.delete).not.toHaveBeenCalled();
  });

  it('400 sur un id non entier', async () => {
    const res = makeRes();
    await findRoute('delete', '/:id').route.stack[findRoute('delete', '/:id').route.stack.length - 1].handle(
      { ...admin, params: { id: 'zz' }, body: {} },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(prisma.incomingEmail.delete).not.toHaveBeenCalled();
  });
});
