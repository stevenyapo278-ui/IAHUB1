// Tests d'intégration du journal d'activité (GET /logs) : garde de rôle,
// filtre par date, liste des acteurs et export CSV avec les filtres appliqués.
jest.mock('../prismaClient', () => ({
  ticketEvent: {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    groupBy: jest.fn().mockResolvedValue([]),
  },
}));
jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => next(),
}));

const prisma = require('../prismaClient');
const router = require('./logs.routes');

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

describe('GET /logs — journal d\'activité', () => {
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
    prisma.ticketEvent.findMany.mockResolvedValue([]);
    prisma.ticketEvent.count.mockResolvedValue(0);
    prisma.ticketEvent.groupBy.mockResolvedValue([]);
  });

  test('un demandeur est refusé (403)', async () => {
    const res = makeRes();
    await listHandler(makeReq({ user: { role: 'REQUESTER' } }), res);
    expect(res.statusCode).toBe(403);
    expect(prisma.ticketEvent.findMany).not.toHaveBeenCalled();
  });

  test('filtre par date → createdAt gte/lte (fin de journée inclusive)', async () => {
    const res = makeRes();
    await listHandler(makeReq({
      user: { role: 'ADMIN' },
      query: { startDate: '2026-10-01', endDate: '2026-10-15' },
    }), res);

    expect(res.statusCode).toBe(200);
    const where = prisma.ticketEvent.findMany.mock.calls[0][0].where;
    expect(where.createdAt.gte).toEqual(new Date('2026-10-01'));
    expect(where.createdAt.lte.getHours()).toBe(23);
    expect(where.createdAt.lte.getMinutes()).toBe(59);
    expect(where.createdAt.lte.getDate()).toBe(15);
  });

  test('filtre catégorie → where.type in la famille', async () => {
    const res = makeRes();
    await listHandler(makeReq({ user: { role: 'TECHNICIAN' }, query: { category: 'EMAILS' } }), res);

    const where = prisma.ticketEvent.findMany.mock.calls[0][0].where;
    expect(where.type.in).toEqual(['EMAIL_RECEIVED', 'EMAIL_SENT']);
  });

  test('/actors retourne les acteurs distincts triés par fréquence', async () => {
    prisma.ticketEvent.groupBy.mockResolvedValue([
      { actor: 'SYSTEM', _count: { _all: 42 } },
      { actor: 'admin@prosuma.ci', _count: { _all: 7 } },
    ]);

    const res = makeRes();
    await actorsHandler(makeReq({ user: { role: 'ADMIN' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.actors).toEqual([
      { actor: 'SYSTEM', count: 42 },
      { actor: 'admin@prosuma.ci', count: 7 },
    ]);
  });

  test('/export CSV applique les mêmes filtres que la liste (take 10000)', async () => {
    prisma.ticketEvent.findMany.mockResolvedValue([
      { id: 1, type: 'CREATED', actor: 'SYSTEM', payload: null, createdAt: new Date('2026-10-20T10:00:00Z'), ticket: { id: 42, title: 'Panne caisse' } },
    ]);

    const res = makeRes();
    await exportHandler(makeReq({
      user: { role: 'ADMIN' },
      query: { format: 'csv', category: 'TICKETS', startDate: '2026-10-01' },
    }), res);

    const call = prisma.ticketEvent.findMany.mock.calls[0][0];
    expect(call.take).toBe(10000);
    expect(call.where.type.in).toBeDefined(); // famille TICKETS appliquée
    expect(call.where.createdAt.gte).toEqual(new Date('2026-10-01'));
    expect(res.headers['Content-Disposition']).toMatch(/journal_activite_\d{4}-\d{2}-\d{2}\.csv/);
    // UTF-8 BOM + en-têtes + ligne contenant le ticket
    expect(res.sent).toMatch(/^\uFEFFdate;type;acteur;ticket;titre;detail/);
    expect(res.sent).toContain('Panne caisse');
  });

  test('/export sans format → XLSX (buffer binaire)', async () => {
    prisma.ticketEvent.findMany.mockResolvedValue([]);
    const res = makeRes();
    await exportHandler(makeReq({ user: { role: 'ADMIN' }, query: {} }), res);

    expect(res.headers['Content-Type']).toContain('spreadsheetml');
    expect(res.sent).toBeInstanceOf(Buffer);
  });
});
