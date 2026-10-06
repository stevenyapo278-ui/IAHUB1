// GET/POST /api/approvals/:token — décider de la validation hiérarchique depuis
// le lien public envoyé par e-mail au supérieur (sans compte, token opaque).
// Prisma et le service de décision sont mockés : on teste ici la résolution du
// token, les gardes (404/409) et le passage de décision.

jest.mock('../prismaClient', () => ({
  ticketApproval: { findUnique: jest.fn() },
}));
jest.mock('../services/hierarchicalApproval', () => ({
  decideApproval: jest.fn(),
}));

const router = require('./approvals.routes');
const prisma = require('../prismaClient');
const { decideApproval } = require('../services/hierarchicalApproval');

function findRoute(method, path) {
  return router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const call = async (method, path, req) => {
  const route = findRoute(method, path);
  expect(route).toBeTruthy();
  const res = makeRes();
  req.method = method.toUpperCase();
  await route.route.stack[0].handle(req, res);
  return res;
};

const PENDING_RECORD = {
  id: 1, token: 'tok-abc', ticketId: 42, formId: 4,
  managerEmail: 'boss@x.ci', cc: ['a@x.ci'], status: 'PENDING',
  decidedAt: null, decisionComment: null,
  ticket: {
    id: 42, title: 'DEMANDE CYRUS', content: '<p>Contenu</p>', status: 'NEW',
    priority: 'P3', approvalStatus: 'PENDING', createdAt: new Date('2026-10-06'),
    requester: { fullName: 'Aimee Toho' },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.ticketApproval.findUnique.mockResolvedValue(PENDING_RECORD);
});

describe('protection routeur', () => {
  it('aucune couche authenticate sur le routeur (public par token)', () => {
    const layers = router.stack.filter((l) => !l.route);
    expect(layers).toHaveLength(0);
  });
});

describe('GET /:token', () => {
  it('récapitulatif de la demande pour la page publique', async () => {
    const res = await call('get', '/:token', { params: { token: 'tok-abc' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      token: 'tok-abc', status: 'PENDING', managerEmail: 'boss@x.ci',
      decisionComment: null,
    });
    expect(res.body.ticket).toMatchObject({
      id: 42, title: 'DEMANDE CYRUS', approvalStatus: 'PENDING', requesterName: 'Aimee Toho',
    });
    expect(res.body.cc).toEqual(['a@x.ci']);
  });

  it('token inconnu → 404', async () => {
    prisma.ticketApproval.findUnique.mockResolvedValue(null);
    const res = await call('get', '/:token', { params: { token: 'inconnu' } });
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toContain('introuvable');
  });
});

describe('POST /:token/approve', () => {
  it('décision transmise au service (ticket APPROVED)', async () => {
    decideApproval.mockResolvedValue({ id: 42, approvalStatus: 'APPROVED' });
    const res = await call('post', '/:token/approve', {
      params: { token: 'tok-abc' }, body: { comment: 'OK' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'APPROVED', ticketId: 42 });
    expect(decideApproval).toHaveBeenCalledWith({
      record: PENDING_RECORD, decision: 'APPROVED', comment: 'OK', actorEmail: 'boss@x.ci',
    });
  });

  it('déjà décidé → 409 avec la décision existante', async () => {
    prisma.ticketApproval.findUnique.mockResolvedValue({
      ...PENDING_RECORD, status: 'REJECTED', decidedAt: new Date('2026-10-06'), decisionComment: 'Non',
    });
    const res = await call('post', '/:token/approve', { params: { token: 'tok-abc' }, body: {} });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ status: 'REJECTED' });
    expect(decideApproval).not.toHaveBeenCalled();
  });

  it('refus sans commentaire → 400 propagé par le service', async () => {
    const err = new Error('Une raison de refus est obligatoire.');
    err.status = 400;
    decideApproval.mockRejectedValue(err);
    const res = await call('post', '/:token/reject', { params: { token: 'tok-abc' }, body: {} });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('raison de refus');
  });

  it('token inconnu → 404, aucune décision', async () => {
    prisma.ticketApproval.findUnique.mockResolvedValue(null);
    const res = await call('post', '/:token/approve', { params: { token: 'x' }, body: {} });
    expect(res.statusCode).toBe(404);
    expect(decideApproval).not.toHaveBeenCalled();
  });
});

describe('POST /:token/reject', () => {
  it('refus validé → transmis REJECTED', async () => {
    decideApproval.mockResolvedValue({ id: 42, approvalStatus: 'REJECTED', status: 'CLOSED' });
    const res = await call('post', '/:token/reject', {
      params: { token: 'tok-abc' }, body: { comment: 'Hors périmètre' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'REJECTED', ticketId: 42, ticketStatus: 'CLOSED' });
    expect(decideApproval).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'REJECTED', comment: 'Hors périmètre',
    }));
  });
});
