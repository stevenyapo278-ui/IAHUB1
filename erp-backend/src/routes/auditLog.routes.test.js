// Tests d'intégration de l'audit système : garde ADMIN, acteurs distincts
// et export CSV avec les filtres appliqués.
jest.mock('../prismaClient', () => ({
  auditLog: {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    groupBy: jest.fn().mockResolvedValue([]),
  },
}));
jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => next(),
}));

const prisma = require('../prismaClient');
const router = require('./auditLog.routes');

function getHandler(method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`Route ${method} ${path} introuvable`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function makeReq({ user, query = {} }) {
  return { user, query, params: {}, headers: {}, requestId: 'test-req', protocol: 'http', get: () => undefined };
}

function makeRes() {
  const res = { statusCode: 200, body: null, headers: {}, sent: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.body = payload; return res; });
  res.setHeader = jest.fn((key, value) => { res.headers[key] = value; });
  res.send = jest.fn((payload) => { res.sent = payload; return res; });
  return res;
}

describe('GET /audit-logs — audit système', () => {
  let listHandler;
  let actorsHandler;
  let exportHandler;

  beforeAll(() => {
    listHandler = getHandler('get', '/');
    actorsHandler = getHandler('get', '/actors');
    exportHandler = getHandler('get', '/export');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.auditLog.count.mockResolvedValue(0);
    prisma.auditLog.groupBy.mockResolvedValue([]);
  });

  test('un HOTLINE est refusé (403, ADMIN/SUPERADMIN seulement)', async () => {
    const res = makeRes();
    await listHandler(makeReq({ user: { role: 'HOTLINE' } }), res);
    expect(res.statusCode).toBe(403);
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  test('filtre action + date → where correspondant', async () => {
    const res = makeRes();
    await listHandler(makeReq({
      user: { role: 'SUPERADMIN' },
      query: { action: 'USER_CREATED', startDate: '2026-10-01' },
    }), res);

    expect(res.statusCode).toBe(200);
    const where = prisma.auditLog.findMany.mock.calls[0][0].where;
    expect(where.action).toBe('USER_CREATED');
    expect(where.createdAt.gte).toEqual(new Date('2026-10-01'));
  });

  test('/actors retourne les acteurs distincts sans les valeurs nulles', async () => {
    prisma.auditLog.groupBy.mockResolvedValue([
      { actorEmail: null, _count: { _all: 12 } },
      { actorEmail: 'super@prosuma.ci', _count: { _all: 30 } },
    ]);

    const res = makeRes();
    await actorsHandler(makeReq({ user: { role: 'ADMIN' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.actors).toEqual([{ actor: 'super@prosuma.ci', count: 30 }]);
  });

  test('/export CSV applique les mêmes filtres que la liste (take 10000)', async () => {
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: 1, action: 'USER_UPDATED', actorEmail: 'super@prosuma.ci',
        targetType: 'User', targetId: 7, targetLabel: 'Jean Kouassi',
        ipAddress: null, metadata: { changedFields: ['role'] },
        createdAt: new Date('2026-10-21T08:30:00Z'),
      },
    ]);

    const res = makeRes();
    await exportHandler(makeReq({
      user: { role: 'ADMIN' },
      query: { format: 'csv', action: 'USER_UPDATED', endDate: '2026-10-21' },
    }), res);

    const call = prisma.auditLog.findMany.mock.calls[0][0];
    expect(call.take).toBe(10000);
    expect(call.where.action).toBe('USER_UPDATED');
    expect(call.where.createdAt.lte.getHours()).toBe(23);
    expect(res.headers['Content-Disposition']).toMatch(/audit_systeme_\d{4}-\d{2}-\d{2}\.csv/);
    expect(res.sent).toMatch(/^\uFEFFdate;action;acteur;type_cible;ref_cible;cible;ip;detail/);
    expect(res.sent).toContain('Jean Kouassi');
    expect(res.sent).toContain('role');
  });

  test('/export sans format → XLSX (buffer binaire)', async () => {
    prisma.auditLog.findMany.mockResolvedValue([]);
    const res = makeRes();
    await exportHandler(makeReq({ user: { role: 'ADMIN' }, query: {} }), res);

    expect(res.headers['Content-Type']).toContain('spreadsheetml');
    expect(res.sent).toBeInstanceOf(Buffer);
  });
});
