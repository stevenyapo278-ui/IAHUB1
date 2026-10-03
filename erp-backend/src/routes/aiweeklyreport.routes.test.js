// Routes /api/ai-weekly-reports : ordre de routage (/stats avant /:id), configuration,
// gardes d'approbation/rejet et création atomique des règles. Prisma et le scheduler
// sont mocks — les handlers sont appelés directement avec un res factice.
jest.mock('../prismaClient', () => {
  const prisma = {
    triageRule: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    aiWeeklyPatternReport: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    emailAccount: { findMany: jest.fn() },
    team: { findMany: jest.fn() },
    systemSettings: { findUnique: jest.fn(), upsert: jest.fn() },
    ticketFieldCorrection: { count: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
    ticket: { count: jest.fn(), findMany: jest.fn() },
  };
  prisma.$transaction = jest.fn(async (fn) => fn(prisma));
  return prisma;
});
jest.mock('../services/aiWeeklyReportScheduler', () => ({
  generateWeeklyReport: jest.fn(),
  maybeGenerateWeeklyReport: jest.fn(),
}));

const router = require('./aiweeklyreport.routes');
const prisma = require('../prismaClient');
const { generateWeeklyReport } = require('../services/aiWeeklyReportScheduler');

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

const admin = { user: { sub: 7, role: 'ADMIN' } };

beforeEach(() => jest.clearAllMocks());

describe('protection & ordre de routage', () => {
  it('applique authenticate et requirePermission au niveau du routeur', async () => {
    const layers = router.stack.filter((l) => !l.route);
    expect(layers).toHaveLength(2);
    expect(layers[0].handle.name).toContain('authenticate');
    // requirePermission retourne un middleware anonyme : on vérifie son comportement
    // (rejet 401 sans user, next jamais appelé).
    const res = makeRes();
    let nextCalled = false;
    await layers[1].handle({}, res, () => { nextCalled = true; });
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Authentification requise' });
    expect(nextCalled).toBe(false);
  });

  it('déclare /stats et /settings AVANT /:id (sinon /stats est avalée par /:id)', () => {
    const idx = (p) => router.stack.findIndex((l) => l.route && l.route.path === p);
    expect(idx('/stats')).toBeGreaterThan(-1);
    expect(idx('/settings')).toBeGreaterThan(-1);
    expect(idx('/:id')).toBeGreaterThan(-1);
    expect(idx('/stats')).toBeLessThan(idx('/:id'));
    expect(idx('/settings')).toBeLessThan(idx('/:id'));
    expect(idx('/')).toBeLessThan(idx('/:id'));
    expect(idx('/generate')).toBeLessThan(idx('/:id/approve'));
  });
});

describe('GET /stats', () => {
  it('retourne les KPI, la tendance hebdo et le taux d\'approbation', async () => {
    prisma.ticketFieldCorrection.count.mockResolvedValueOnce(42).mockResolvedValueOnce(11);
    prisma.triageRule.count.mockResolvedValueOnce(5).mockResolvedValueOnce(9);
    prisma.aiWeeklyPatternReport.count
      .mockResolvedValueOnce(3) // APPROVED
      .mockResolvedValueOnce(2) // PENDING
      .mockResolvedValueOnce(1); // REJECTED
    prisma.ticketFieldCorrection.findMany
      .mockResolvedValueOnce([]) // recentCorrections
      .mockResolvedValueOnce([]); // trendCorrections
    prisma.ticketFieldCorrection.groupBy.mockResolvedValue([
      { fieldName: 'category', _count: { fieldName: 7 } },
    ]);

    const res = makeRes();
    await findRoute('get', '/stats').route.stack[0].handle(admin, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.totalCorrections).toBe(42);
    expect(res.body.corrections30d).toBe(11);
    expect(res.body.activeRules).toBe(5);
    expect(res.body.totalRules).toBe(9);
    expect(res.body.approvedReports).toBe(3);
    expect(res.body.pendingReports).toBe(2);
    expect(res.body.rejectedReports).toBe(1);
    expect(res.body.approvalRate).toBe(75); // 3 / (3+1)
    expect(res.body.correctionsByField).toEqual([{ field: 'category', count: 7 }]);
    expect(res.body.weeklyTrend).toHaveLength(8);
    expect(res.body.weeklyTrend.every((w) => typeof w.count === 'number')).toBe(true);
    expect(res.body).not.toHaveProperty('accuracyRate');
  });

  it('approvalRate est null quand aucun rapport n\'a été tranché', async () => {
    prisma.ticketFieldCorrection.count.mockResolvedValue(0);
    prisma.triageRule.count.mockResolvedValue(0);
    prisma.aiWeeklyPatternReport.count.mockResolvedValue(0);
    prisma.ticketFieldCorrection.findMany.mockResolvedValue([]);
    prisma.ticketFieldCorrection.groupBy.mockResolvedValue([]);

    const res = makeRes();
    await findRoute('get', '/stats').route.stack[0].handle(admin, res);

    expect(res.body.approvalRate).toBeNull();
  });
});

describe('GET & PATCH /settings', () => {
  it('GET retourne les clés de configuration', async () => {
    prisma.systemSettings.findUnique.mockResolvedValue({
      aiWeeklyAutoEnabled: true,
      aiWeeklyDay: 1,
      aiWeeklyHour: 7,
      aiWeeklyMinOccurrences: 3,
      aiWeeklyDomainThreshold: 5,
      aiWeeklyConfidenceThreshold: 0.5,
      aiWeeklyWindowDays: 7,
    });
    const res = makeRes();
    await findRoute('get', '/settings').route.stack[0].handle(admin, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.aiWeeklyMinOccurrences).toBe(3);
  });

  it('PATCH valide les bornes et n\'arrondit pas la confiance (float)', async () => {
    prisma.systemSettings.upsert.mockResolvedValue({
      aiWeeklyAutoEnabled: false,
      aiWeeklyDay: 0,
      aiWeeklyHour: 23,
      aiWeeklyMinOccurrences: 4,
      aiWeeklyDomainThreshold: 6,
      aiWeeklyConfidenceThreshold: 0.55,
      aiWeeklyWindowDays: 14,
    });
    const res = makeRes();
    await findRoute('patch', '/settings').route.stack[0].handle(
      { ...admin, body: { aiWeeklyAutoEnabled: false, aiWeeklyConfidenceThreshold: 0.55, aiWeeklyMinOccurrences: 4 } },
      res
    );

    expect(res.statusCode).toBe(200);
    const data = prisma.systemSettings.upsert.mock.calls[0][0].update;
    expect(data.aiWeeklyConfidenceThreshold).toBe(0.55);
    expect(data.aiWeeklyMinOccurrences).toBe(4);
    expect(data.aiWeeklyAutoEnabled).toBe(false);
  });

  it('PATCH rejette une valeur hors bornes (400)', async () => {
    const res = makeRes();
    await findRoute('patch', '/settings').route.stack[0].handle(
      { ...admin, body: { aiWeeklyDay: 9 } },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(prisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('PATCH rejette un body sans clé valide (400)', async () => {
    const res = makeRes();
    await findRoute('patch', '/settings').route.stack[0].handle({ ...admin, body: {} }, res);
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /generate', () => {
  it('renvoie 201 avec le rapport créé', async () => {
    generateWeeklyReport.mockResolvedValue({ created: true, report: { id: 10 } });
    const res = makeRes();
    await findRoute('post', '/generate').route.stack[0].handle(admin, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.id).toBe(10);
  });

  it('signale un doublon de fenêtre sans erreur (200)', async () => {
    generateWeeklyReport.mockResolvedValue({ created: false, reason: 'duplicate', report: { id: 8 } });
    const res = makeRes();
    await findRoute('post', '/generate').route.stack[0].handle(admin, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toMatch(/existe déjà/);
    expect(res.body.report.id).toBe(8);
  });

  it('signale une fenêtre vide (200)', async () => {
    generateWeeklyReport.mockResolvedValue({ created: false, reason: 'empty' });
    const res = makeRes();
    await findRoute('post', '/generate').route.stack[0].handle(admin, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toMatch(/Aucune nouvelle correction/);
  });
});

describe('POST /:id/approve', () => {
  const ruleProposed = {
    label: 'Ajustement automatique category (Matériel → VPN)',
    matchField: 'subject_or_body',
    matchType: 'contains',
    matchValue: 'Problème VPN impossible à connecter',
    fieldName: 'category',
    suggestedValue: 'VPN',
    category: 'VPN',
    confidence: 0.8,
  };

  function mockReport(status = 'PENDING', rules = [ruleProposed]) {
    prisma.aiWeeklyPatternReport.findUnique.mockResolvedValue({
      id: 5,
      status,
      proposedRules: rules,
    });
    prisma.aiWeeklyPatternReport.update.mockResolvedValue({ id: 5, status: 'APPROVED' });
    prisma.aiWeeklyPatternReport.findUnique
      .mockResolvedValueOnce({ id: 5, status, proposedRules: rules }) // lecture initiale
      .mockResolvedValueOnce({ id: 5, status: 'APPROVED', reviewNote: 'ok' }); // relecture
    prisma.emailAccount.findMany.mockResolvedValue([{ emailAddress: 'support@prosuma.ci', username: null }]);
    prisma.triageRule.create.mockResolvedValue({ id: 1 });
  }

  it('404 si le rapport n\'existe pas', async () => {
    prisma.aiWeeklyPatternReport.findUnique.mockResolvedValue(null);
    const res = makeRes();
    await findRoute('post', '/:id/approve').route.stack[0].handle({ ...admin, params: { id: '5' }, body: {} }, res);
    expect(res.statusCode).toBe(404);
  });

  it('409 si le rapport n\'est plus PENDING (anti-doublon)', async () => {
    prisma.aiWeeklyPatternReport.findUnique.mockResolvedValue({ id: 5, status: 'APPROVED', proposedRules: [] });
    const res = makeRes();
    await findRoute('post', '/:id/approve').route.stack[0].handle({ ...admin, params: { id: '5' }, body: {} }, res);

    expect(res.statusCode).toBe(409);
    expect(prisma.triageRule.create).not.toHaveBeenCalled();
    expect(prisma.aiWeeklyPatternReport.update).not.toHaveBeenCalled();
  });

  it('crée les règles (avec résolution teamId → teamName) puis approuve', async () => {
    mockReport('PENDING', [
      ruleProposed,
      {
        label: 'Ajustement automatique teamId (null → 3)',
        matchField: 'subject_or_body',
        matchType: 'contains',
        matchValue: 'Imprimante bloquée étage 4',
        fieldName: 'teamId',
        suggestedValue: '3',
        confidence: 0.9,
      },
      {
        label: 'Anti-spam domaine interne',
        matchField: 'domain',
        matchType: 'equals',
        matchValue: 'prosuma.ci',
        isSpam: true,
        confidence: 0.9,
      },
    ]);
    prisma.team.findMany.mockResolvedValue([{ id: 3, name: 'Infrastructure' }]);

    const res = makeRes();
    await findRoute('post', '/:id/approve').route.stack[0].handle({ ...admin, params: { id: '5' }, body: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.createdRulesCount).toBe(2); // la règle domaine interne est ignorée
    expect(res.body.skippedInternalDomainCount).toBe(1);
    expect(prisma.triageRule.create).toHaveBeenCalledTimes(2);
    // Le label devient lisible et la team est résolue par nom
    expect(prisma.triageRule.create.mock.calls[1][0].data.teamName).toBe('Infrastructure');
    expect(prisma.triageRule.create.mock.calls[0][0].data.label).toContain('« Problème VPN impossible à connecter »');
    expect(prisma.aiWeeklyPatternReport.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 5 },
      data: expect.objectContaining({ status: 'APPROVED', reviewedById: 7 }),
    }));
  });

  it('ne crée rien quand aucune règle n\'est exploitable', async () => {
    mockReport('PENDING', [{ label: 'sans matchValue', matchField: 'subject' }]);
    const res = makeRes();
    await findRoute('post', '/:id/approve').route.stack[0].handle({ ...admin, params: { id: '5' }, body: {} }, res);

    expect(res.body.createdRulesCount).toBe(0);
    expect(prisma.triageRule.create).not.toHaveBeenCalled();
    expect(prisma.aiWeeklyPatternReport.update).toHaveBeenCalled(); // rapport quand même tranché
  });
});

describe('POST /:id/reject', () => {
  it('404 si le rapport n\'existe pas', async () => {
    prisma.aiWeeklyPatternReport.findUnique.mockResolvedValue(null);
    const res = makeRes();
    await findRoute('post', '/:id/reject').route.stack[0].handle({ ...admin, params: { id: '9' }, body: {} }, res);
    expect(res.statusCode).toBe(404);
  });

  it('409 si le rapport est déjà APPROVED', async () => {
    prisma.aiWeeklyPatternReport.findUnique.mockResolvedValue({ id: 9, status: 'APPROVED' });
    const res = makeRes();
    await findRoute('post', '/:id/reject').route.stack[0].handle({ ...admin, params: { id: '9' }, body: {} }, res);
    expect(res.statusCode).toBe(409);
    expect(prisma.aiWeeklyPatternReport.update).not.toHaveBeenCalled();
  });

  it('rejette un rapport PENDING et note le rejet', async () => {
    prisma.aiWeeklyPatternReport.findUnique.mockResolvedValue({ id: 9, status: 'PENDING' });
    prisma.aiWeeklyPatternReport.update.mockResolvedValue({ id: 9, status: 'REJECTED' });
    const res = makeRes();
    await findRoute('post', '/:id/reject').route.stack[0].handle({ ...admin, params: { id: '9' }, body: { note: 'Bruit' } }, res);

    expect(res.statusCode).toBe(200);
    expect(prisma.aiWeeklyPatternReport.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REJECTED', reviewNote: 'Bruit' }),
    }));
  });
});

describe('GET /:id', () => {
  it('400 sur un identifiant non entier (neuf jamais Number(NaN) en base)', async () => {
    const res = makeRes();
    await findRoute('get', '/:id').route.stack[0].handle({ ...admin, params: { id: 'stats' } }, res);
    expect(res.statusCode).toBe(400);
    expect(prisma.aiWeeklyPatternReport.findUnique).not.toHaveBeenCalled();
  });

  it('404 si le rapport n\'existe pas', async () => {
    prisma.aiWeeklyPatternReport.findUnique.mockResolvedValue(null);
    const res = makeRes();
    await findRoute('get', '/:id').route.stack[0].handle({ ...admin, params: { id: '12' } }, res);
    expect(res.statusCode).toBe(404);
  });
});
