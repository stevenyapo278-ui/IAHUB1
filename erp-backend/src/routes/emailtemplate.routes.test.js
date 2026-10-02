// Routes /api/email-templates : consultation (fusion registre + surcharges + apercu
// rendu) et ecriture des surcharges. Prisma et systemSettings sont mocks — aucun
// serveur HTTP complet, les handlers sont appeles directement avec un res factice.
jest.mock('../prismaClient', () => ({
  emailTemplate: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  },
  permissionGroup: {
    findMany: jest.fn().mockResolvedValue([]),
  },
}));
jest.mock('../services/systemSettings', () => ({
  getSystemSettings: jest.fn().mockResolvedValue({}),
  resolveFrontendUrl: jest.fn().mockReturnValue('http://localhost:3000'),
  resolveBackendUrl: jest.fn().mockReturnValue('http://localhost:4000'),
  normalizeHost: jest.fn((h) => h),
}));

const router = require('./emailtemplate.routes');
const prisma = require('../prismaClient');
const { EMAIL_TEMPLATE_REGISTRY } = require('../services/emailTemplateRegistry');

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

const superadmin = { user: { sub: 'u1', role: 'SUPERADMIN' } };

beforeEach(() => jest.clearAllMocks());

describe('GET /api/email-templates', () => {
  it('est protege par authenticate au niveau du routeur', () => {
    const authLayers = router.stack.filter((l) => !l.route);
    expect(authLayers.some((l) => (l.handle.name || '').includes('authenticate'))).toBe(true);
  });

  it('retourne chaque template du registre avec apercu rendu et surcharge courante', async () => {
    prisma.emailTemplate.findMany.mockResolvedValue([
      { id: 1, key: 'assignment', subject: 'Bienvenue {ticketId}', message: null },
    ]);
    const handler = findRoute('get', '/').route.stack[0].handle;
    const res = makeRes();
    await handler({ ...superadmin }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveLength(Object.keys(EMAIL_TEMPLATE_REGISTRY).length);

    const assignment = res.body.find((t) => t.key === 'assignment');
    expect(assignment.isCustom).toBe(true);
    expect(assignment.subject).toBe('Bienvenue {ticketId}');
    expect(assignment.previewSubject).toBe('Bienvenue 999');
    expect(assignment.previewHtml).toContain('role="presentation"');
    expect(assignment.toggleKey).toBe('emailAssignmentEnabled');

    const sla = res.body.find((t) => t.key === 'sla_breach');
    expect(sla.isCustom).toBe(false);
    expect(sla.previewSubject).toBe('[SLA] Dépassement — Ticket #999 : Test template email');
  });

  it('replie sur des apercus vides si la lecture des sur echoue (best-effort)', async () => {
    prisma.emailTemplate.findMany.mockRejectedValue(new Error('db down'));
    const handler = findRoute('get', '/').route.stack[0].handle;
    const res = makeRes();
    await handler({ ...superadmin }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveLength(Object.keys(EMAIL_TEMPLATE_REGISTRY).length);
    expect(res.body.every((t) => t.isCustom === false)).toBe(true);
  });
});

describe('PUT /api/email-templates/:key', () => {
  const stack = () => findRoute('put', '/:key').route.stack;

  it('passe par requirePermission (automation.manage)', () => {
    expect(stack()[0].handle.toString()).toContain('hasPermission');
  });

  it('refuse un utilisateur sans la permission (403, handler jamais atteint)', async () => {
    const res = makeRes();
    const next = jest.fn();
    await stack()[0].handle({ user: { sub: 'u9', role: 'ADMIN' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(prisma.emailTemplate.upsert).not.toHaveBeenCalled();
  });

  it('404 pour une cle inconnue', async () => {
    const res = makeRes();
    await stack()[1].handle({ ...superadmin, params: { key: 'nope' }, body: {} }, res);
    expect(res.statusCode).toBe(404);
    expect(prisma.emailTemplate.upsert).not.toHaveBeenCalled();
  });

  it('400 si l\'objet depasse 300 caracteres', async () => {
    const res = makeRes();
    await stack()[1].handle({
      ...superadmin, params: { key: 'assignment' }, body: { subject: 'x'.repeat(301), message: '' },
    }, res);
    expect(res.statusCode).toBe(400);
    expect(prisma.emailTemplate.upsert).not.toHaveBeenCalled();
  });

  it('supprime la ligne quand sujet et message sont vides', async () => {
    prisma.emailTemplate.deleteMany.mockResolvedValue({ count: 1 });
    const res = makeRes();
    await stack()[1].handle({
      ...superadmin, params: { key: 'assignment' }, body: { subject: '  ', message: '' },
    }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ key: 'assignment', subject: null, message: null, isCustom: false });
    expect(prisma.emailTemplate.deleteMany).toHaveBeenCalledWith({ where: { key: 'assignment' } });
  });

  it('upsert la surcharge valide et repond isCustom', async () => {
    prisma.emailTemplate.upsert.mockResolvedValue({
      id: 1, key: 'assignment', subject: 'Nouvel objet {ticketId}', message: '<p>Contenu {subject}</p>',
    });
    const res = makeRes();
    await stack()[1].handle({
      ...superadmin, params: { key: 'assignment' },
      body: { subject: '  Nouvel objet {ticketId}  ', message: '<p>Contenu {subject}</p>' },
    }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.isCustom).toBe(true);
    expect(prisma.emailTemplate.upsert).toHaveBeenCalledWith({
      where: { key: 'assignment' },
      create: { key: 'assignment', subject: 'Nouvel objet {ticketId}', message: '<p>Contenu {subject}</p>' },
      update: { subject: 'Nouvel objet {ticketId}', message: '<p>Contenu {subject}</p>' },
    });
  });
});

describe('DELETE /api/email-templates/:key', () => {
  const stack = () => findRoute('delete', '/:key').route.stack;

  it('passe par requirePermission (automation.manage)', () => {
    expect(stack()[0].handle.toString()).toContain('hasPermission');
  });

  it('404 pour une cle inconnue', async () => {
    const res = makeRes();
    await stack()[1].handle({ ...superadmin, params: { key: 'nope' } }, res);
    expect(res.statusCode).toBe(404);
    expect(prisma.emailTemplate.deleteMany).not.toHaveBeenCalled();
  });

  it('supprime la surcharge (retour au defaut)', async () => {
    prisma.emailTemplate.deleteMany.mockResolvedValue({ count: 1 });
    const res = makeRes();
    await stack()[1].handle({ ...superadmin, params: { key: 'resolved' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ key: 'resolved', reset: true });
    expect(prisma.emailTemplate.deleteMany).toHaveBeenCalledWith({ where: { key: 'resolved' } });
  });
});
