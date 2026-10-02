// GET /dashboard/stats — les widgets du tableau de bord doivent compter EXACTEMENT comme
// la vue tickets :
//   1. la corbeille (deletedAt renseigné) n'est jamais comptée (bug réel : widget 46 vs badge 45),
//   2. « ouverts » suit la définition OPEN_GROUP du badge « Ouverts » (inclut WAITING_FOR_USER),
//   3. les tickets en attente d'approbation ou rejetés restent exclus.
jest.mock('../prismaClient', () => {
  // Mini-base en mémoire : le where Prisma du handler est évalué sur ces fixtures.
  const db = { tickets: [] };
  const isEq = (a, b) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);

  // Évaluation restreinte aux opérateurs réellement utilisés par les handlers testés
  function matches(t, where = {}) {
    for (const [key, cond] of Object.entries(where)) {
      if (key === 'OR') {
        if (!Array.isArray(cond) || !cond.some((c) => matches(t, c))) return false;
        continue;
      }
      if (key === 'AND') {
        if (!Array.isArray(cond) || !cond.every((c) => matches(t, c))) return false;
        continue;
      }
      const val = t[key];
      if (cond === null) {
        if (val !== null && val !== undefined) return false;
      } else if (cond instanceof Date) {
        if (!isEq(val, cond)) return false;
      } else if (typeof cond === 'object' && !Array.isArray(cond)) {
        if ('notIn' in cond && cond.notIn.includes(val)) return false;
        if ('in' in cond && !cond.in.includes(val)) return false;
        if ('not' in cond && (cond.not === null ? val !== null && val !== undefined : isEq(val, cond.not))) return false;
        if ('gte' in cond && !(val >= cond.gte)) return false;
        if ('lte' in cond && !(val <= cond.lte)) return false;
      } else if (!isEq(val, cond)) {
        return false;
      }
    }
    return true;
  }

  return {
    __db: db,
    ticket: {
      count: jest.fn(async ({ where } = {}) => db.tickets.filter((t) => matches(t, where)).length),
      groupBy: jest.fn(async ({ by, where } = {}) => {
        const rows = new Map();
        for (const t of db.tickets.filter((x) => matches(x, where))) {
          const key = JSON.stringify(by.map((f) => t[f]));
          const bucket = rows.get(key) || { vals: by.map((f) => t[f]), n: 0 };
          bucket.n += 1;
          rows.set(key, bucket);
        }
        return [...rows.values()].map(({ vals, n }) => {
          const row = {};
          by.forEach((f, i) => { row[f] = vals[i]; });
          row._count = n;
          return row;
        });
      }),
      findMany: jest.fn(async ({ where, take } = {}) => {
        const rows = db.tickets.filter((t) => matches(t, where));
        return typeof take === 'number' ? rows.slice(0, take) : rows;
      }),
    },
    team: {
      findMany: jest.fn(async ({ where } = {}) =>
        (where?.id?.in || []).map((id) => ({ id, name: `Équipe ${id}` })),
      ),
    },
    user: { findMany: jest.fn(async () => [{ id: 1, fullName: 'Tech', email: 'tech@t.ci' }]) },
    ticketTimeEntry: { groupBy: jest.fn(async () => []) },
    aiEmailDraft: { count: jest.fn(async () => 0) },
    incomingEmail: { count: jest.fn(async () => 0) },
    emailAccount: { aggregate: jest.fn(async () => ({ _max: { lastSyncAt: null } })) },
    ticketEvent: { groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
    senderReputation: { count: jest.fn(async () => 0) },
    $queryRaw: jest.fn(async () => []),
    $queryRawUnsafe: jest.fn(async () => []),
  };
});

jest.mock('../middleware/auth', () => ({ authenticate: (_req, _res, next) => next() }));
// hasPermission → false : le bloc « santé des intégrations » de /pulse est ignoré ici
// (couvert par dashboard.pulse.test.js), donc pas de mock prisma apiConfig/systemSettings.
jest.mock('../middleware/permissions', () => ({
  requirePermission: () => (_req, _res, next) => next(),
  hasPermission: jest.fn(async () => false),
}));
jest.mock('../services/pdfReportService', () => ({ generateReport: jest.fn() }));
jest.mock('../utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const prisma = require('../prismaClient');
const { __db: db } = require('../prismaClient');
const router = require('./dashboard.routes');

function getHandler(method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`Route ${method} ${path} introuvable`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function makeReq({ user = { sub: 1, role: 'SUPERADMIN' }, query = {} } = {}) {
  return { user, query, headers: {}, requestId: 'test-req' };
}

function makeRes() {
  const res = { statusCode: 200, body: null, headers: {}, sent: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.body = payload; return res; });
  res.setHeader = jest.fn((k, v) => { res.headers[k] = v; });
  res.send = jest.fn((payload) => { res.sent = payload; return res; });
  return res;
}

const t = (over = {}) => ({
  status: 'OPEN',
  priority: 'P2',
  teamId: null,
  category: null,
  approvalStatus: 'APPROVED',
  deletedAt: null,
  aiProcessed: false,
  createdAt: new Date('2026-09-01'),
  ...over,
});

describe('GET /dashboard/stats — compteurs alignés sur la vue tickets', () => {
  beforeEach(() => {
    db.tickets.length = 0;
    jest.clearAllMocks();
  });

  it('n\'en compte aucun ticket de la corbeille (bug 46 vs 45)', async () => {
    db.tickets.push(
      t({ id: 1 }),
      t({ id: 2 }),
      t({ id: 3, deletedAt: new Date('2026-09-20') }), // ouvert mais en corbeille
    );

    const res = makeRes();
    await getHandler('get', '/stats')(makeReq(), res);

    expect(res.body.total).toBe(2);
    expect(res.body.open).toBe(2); // 3e ticket (corbeille) exclu
  });

  it('« ouverts » suit OPEN_GROUP : inclut WAITING_FOR_USER', async () => {
    db.tickets.push(
      t({ id: 1, status: 'NEW' }),
      t({ id: 2, status: 'PENDING' }),
      t({ id: 3, status: 'WAITING_FOR_USER' }),
      t({ id: 4, status: 'SOLVED' }),
    );

    const res = makeRes();
    await getHandler('get', '/stats')(makeReq(), res);

    expect(res.body.open).toBe(3);
  });

  it('exclut toujours les tickets en attente d\'approbation ou rejetés', async () => {
    db.tickets.push(
      t({ id: 1 }),
      t({ id: 2, approvalStatus: 'PENDING' }),
      t({ id: 3, approvalStatus: 'REJECTED' }),
    );

    const res = makeRes();
    await getHandler('get', '/stats')(makeReq(), res);

    expect(res.body.total).toBe(1);
    expect(res.body.open).toBe(1);
  });

  it('passe bien deletedAt: null à TOUTES les agrégations (byStatus/byTeam/…)', async () => {
    db.tickets.push(t({ id: 1 }), t({ id: 2, deletedAt: new Date() }));

    const res = makeRes();
    await getHandler('get', '/stats')(makeReq(), res);

    expect(prisma.ticket.groupBy).toHaveBeenCalled();
    for (const call of prisma.ticket.groupBy.mock.calls) {
      expect(call[0].where.deletedAt).toBeNull();
    }
    const countWheres = prisma.ticket.count.mock.calls.map((c) => c[0].where);
    expect(countWheres.length).toBeGreaterThanOrEqual(2);
    for (const w of countWheres) {
      expect(w.deletedAt).toBeNull();
    }
    expect(res.body.byStatus).toEqual([{ status: 'OPEN', count: 1 }]);
  });
});

// ── Étape 2 : balayage complet — AUCUN endpoint du dashboard ne doit compter la corbeille ──
describe('Tous les endpoints dashboard excluent la corbeille', () => {
  const ENDPOINTS = [
    '/stats',
    '/pulse',
    '/workload-by-team',
    '/pending-approvals',
    '/reply-suggestions-count',
    '/recent-activity',
    '/technician-performance',
    '/technician-stats',
    '/activity-trend',
    '/report',
    '/sla-analytics',
    '/closure-stats',
    '/ticket-heatmap',
    '/ticket-evolution',
  ];

  beforeEach(() => {
    db.tickets.length = 0;
    jest.clearAllMocks();
  });

  it('chaque requête ticket passe deletedAt: null (invariant)', async () => {
    db.tickets.push(t({ id: 1 }), t({ id: 2, deletedAt: new Date() }));

    for (const path of ENDPOINTS) {
      const res = makeRes();
      await getHandler('get', path)(makeReq({ query: {} }), res);
      expect(res.statusCode).toBe(200);
    }

    for (const call of prisma.ticket.count.mock.calls) {
      expect({ op: 'count', where: call[0].where }).toEqual({ op: 'count', where: { ...call[0].where, deletedAt: null } });
    }
    for (const call of prisma.ticket.groupBy.mock.calls) {
      expect({ op: 'groupBy', by: call[0].by, where: call[0].where }).toEqual({ op: 'groupBy', by: call[0].by, where: { ...call[0].where, deletedAt: null } });
    }
    for (const call of prisma.ticket.findMany.mock.calls) {
      expect({ op: 'findMany', where: call[0].where }).toEqual({ op: 'findMany', where: { ...call[0].where, deletedAt: null } });
    }
    expect(prisma.ticket.count.mock.calls.length + prisma.ticket.groupBy.mock.calls.length + prisma.ticket.findMany.mock.calls.length)
      .toBeGreaterThanOrEqual(ENDPOINTS.length);

    // La charge par équipe (SQL brut) filtre aussi la corbeille
    const sql = prisma.$queryRaw.mock.calls.map((c) => c[0].join('')).join(' ');
    expect(sql).toContain('"deletedAt" IS NULL');
  });

  it('/technician-performance : corbeille exclue + ouverts = OPEN_GROUP', async () => {
    db.tickets.push(
      t({ id: 1, assignedToId: 1, status: 'NEW' }),
      t({ id: 2, assignedToId: 1, status: 'WAITING_FOR_USER' }),
      t({ id: 3, assignedToId: 1, status: 'OPEN', deletedAt: new Date() }), // corbeille
      t({ id: 4, assignedToId: 1, status: 'SOLVED' }),
    );

    const res = makeRes();
    await getHandler('get', '/technician-performance')(makeReq(), res);

    expect(res.body).toEqual([
      { id: 1, fullName: 'Tech', email: 'tech@t.ci', assigned: 3, open: 2, solved: 1 },
    ]);
  });

  it('/recent-activity : n\'affiche pas les tickets supprimés', async () => {
    db.tickets.push(t({ id: 1 }), t({ id: 2, deletedAt: new Date() }), t({ id: 3 }));

    const res = makeRes();
    await getHandler('get', '/recent-activity')(makeReq(), res);

    expect(res.body).toHaveLength(2);
    expect(res.body.map((x) => x.id).sort()).toEqual([1, 3]);
  });

  it('/closure-stats : file d\'attente « pending » sans la corbeille', async () => {
    db.tickets.push(
      t({ id: 1, closeSuggested: true }),
      t({ id: 2, closeSuggested: true }),
      t({ id: 3, closeSuggested: true, deletedAt: new Date() }),
    );

    const res = makeRes();
    await getHandler('get', '/closure-stats')(makeReq(), res);

    expect(res.body.pending).toBe(2);
  });
});

// ── Périmètre (scope) + période (days) + payload enrichi pour les widgets ──
describe('GET /dashboard/stats — scope, days et payload enrichi', () => {
  beforeEach(() => {
    db.tickets.length = 0;
    jest.clearAllMocks();
  });

  async function stats(query = {}) {
    const res = makeRes();
    await getHandler('get', '/stats')(makeReq({ query }), res);
    return res.body;
  }

  it('scope=open ne compte que les statuts ouverts (OPEN_GROUP)', async () => {
    db.tickets.push(
      t({ id: 1, status: 'NEW' }),
      t({ id: 2, status: 'WAITING_FOR_USER' }),
      t({ id: 3, status: 'SOLVED' }),
      t({ id: 4, status: 'CLOSED' }),
    );

    const body = await stats({ scope: 'open' });

    expect(body.total).toBe(2);
    expect(body.open).toBe(2);
    expect(body.resolved).toBe(0);
    expect(body.byStatus.map((s) => s.status).sort()).toEqual(['NEW', 'WAITING_FOR_USER']);
  });

  it('scope=closed ne compte que SOLVED/CLOSED, open tombe à 0', async () => {
    db.tickets.push(
      t({ id: 1, status: 'OPEN' }),
      t({ id: 2, status: 'SOLVED' }),
      t({ id: 3, status: 'CLOSED' }),
    );

    const body = await stats({ scope: 'closed' });

    expect(body.total).toBe(2);
    expect(body.open).toBe(0);
    expect(body.resolved).toBe(2);
    expect(body.byStatus.map((s) => s.status).sort()).toEqual(['CLOSED', 'SOLVED']);
  });

  it('scope=all (défaut) garde tous les statuts', async () => {
    db.tickets.push(t({ id: 1, status: 'OPEN' }), t({ id: 2, status: 'SOLVED' }));

    const body = await stats();

    expect(body.total).toBe(2);
    expect(body.open).toBe(1);
    expect(body.resolved).toBe(1);
  });

  it('days borne createdAt : les vieux tickets sortent du comptage', async () => {
    db.tickets.push(
      t({ id: 1, createdAt: new Date('2026-01-01') }), // vieux
      t({ id: 2, createdAt: new Date() }),              // récent
    );

    const body = await stats({ days: '7' });

    expect(body.total).toBe(1);

    // et le where transmis porte bien une borne basse récente
    const where = prisma.ticket.count.mock.calls[0][0].where;
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    expect(where.createdAt.gte.getTime()).toBeGreaterThan(Date.now() - 9 * 24 * 60 * 60 * 1000);
  });

  it('payload enrichi : resolved, aiProcessed et byTeamPriority', async () => {
    db.tickets.push(
      t({ id: 1, status: 'SOLVED', teamId: 1, priority: 'P1' }),
      t({ id: 2, status: 'SOLVED', teamId: 1, priority: 'P2' }),
      t({ id: 3, status: 'OPEN', teamId: 1, priority: 'P2', aiProcessed: true }),
      t({ id: 4, status: 'OPEN', teamId: null, priority: 'P3' }),
    );

    const body = await stats();

    expect(body.resolved).toBe(2);
    expect(body.aiProcessed).toBe(1);
    expect(body.byTeamPriority).toEqual(
      expect.arrayContaining([
        { teamId: 1, teamName: 'Équipe 1', priority: 'P2', count: 2 },
        { teamId: 1, teamName: 'Équipe 1', priority: 'P1', count: 1 },
        { teamId: null, teamName: 'Non assignée', priority: 'P3', count: 1 },
      ]),
    );
  });

  it('/technician-performance honore days (borne createdAt)', async () => {
    db.tickets.push(t({ id: 1, assignedToId: 1, createdAt: new Date('2026-01-01') }));
    const res = makeRes();
    await getHandler('get', '/technician-performance')(makeReq({ query: { days: '7' } }), res);

    expect(res.body).toEqual([]); // ticket trop vieux pour 7 jours
    const where = prisma.ticket.count.mock.calls[0][0].where;
    expect(where.createdAt.gte).toBeInstanceOf(Date);
  });
});

// ── GET /dashboard/ticket-evolution : chaque carte doit valoir la somme exacte de sa série ──
describe('GET /dashboard/ticket-evolution — nombres fiables', () => {
  const PERIOD = { startDate: '2026-09-01', endDate: '2026-09-30' };

  beforeEach(() => {
    db.tickets.length = 0;
    jest.clearAllMocks();
  });

  async function evolution(query = {}) {
    const res = makeRes();
    await getHandler('get', '/ticket-evolution')(makeReq({ query: { ...PERIOD, ...query } }), res);
    expect(res.statusCode).toBe(200);
    return res.body;
  }

  const sum = (arr, key) => arr.reduce((n, x) => n + x[key], 0);

  it('exclut corbeille et approbations PENDING/REJECTED (sur les 2 requêtes)', async () => {
    db.tickets.push(
      t({ id: 1 }),
      t({ id: 2, deletedAt: new Date('2026-09-10') }),
      t({ id: 3, approvalStatus: 'PENDING' }),
      t({ id: 4, approvalStatus: 'REJECTED' }),
    );

    const body = await evolution();

    expect(body.totals.created).toBe(1);
    expect(prisma.ticket.findMany.mock.calls.length).toBe(2); // créés + résolus
    for (const call of prisma.ticket.findMany.mock.calls) {
      const where = call[0].where;
      expect(where.deletedAt).toBeNull();
      expect(where.approvalStatus).toEqual({ notIn: ['PENDING', 'REJECTED'] });
    }
  });

  it('compte un ticket créé avant la période mais résolu pendant', async () => {
    db.tickets.push(
      // Créé en juillet, résolu le 5 septembre → « Résolus »
      t({ id: 1, status: 'SOLVED', createdAt: new Date('2026-07-15'), solvedAt: new Date('2026-09-05') }),
      // Créé le 2 septembre, pas encore résolu → « Créés » seulement
      t({ id: 2, status: 'OPEN', createdAt: new Date('2026-09-02') }),
      // Créé le 3, résolu en octobre (hors période) → « Créés » seulement
      t({ id: 3, status: 'SOLVED', createdAt: new Date('2026-09-03'), solvedAt: new Date('2026-10-10') }),
    );

    const body = await evolution();

    expect(body.totals.created).toBe(2);
    expect(body.totals.resolved).toBe(1);
  });

  it('chaque carte vaut la somme de sa série ; un ticket réouvert n\'est pas résolu', async () => {
    db.tickets.push(
      t({ id: 1, status: 'SOLVED', createdAt: new Date('2026-09-01T08:00:00'), solvedAt: new Date('2026-09-04T10:00:00') }),
      t({ id: 2, status: 'CLOSED', createdAt: new Date('2026-09-02'), solvedAt: new Date('2026-09-04'), closedAt: new Date('2026-09-12') }),
      // Réouvert après résolution : solvedAt conservé en base mais statut OPEN → pas résolu
      t({ id: 3, status: 'OPEN', createdAt: new Date('2026-09-03'), solvedAt: new Date('2026-09-06') }),
      t({ id: 4, priority: 'P1', slaBreachedAt: new Date('2026-09-05') }),
    );

    const body = await evolution();
    const s = body.series;

    expect(body.totals.created).toBe(sum(s, 'created'));
    expect(body.totals.resolved).toBe(sum(s, 'resolved'));
    expect(body.totals.p1).toBe(sum(s, 'p1'));
    expect(body.totals.slaBreached).toBe(sum(s, 'slaBreached'));

    expect(body.totals.created).toBe(4);
    expect(body.totals.resolved).toBe(2); // #1 et #2, pas #3 (réouvert)
    expect(body.totals.p1).toBe(1);
    expect(body.totals.slaBreached).toBe(1);
  });

  it('durée moyenne calculée sur les tickets résolus de la période', async () => {
    db.tickets.push(
      t({ id: 1, status: 'SOLVED', createdAt: new Date('2026-09-01'), solvedAt: new Date('2026-09-05') }), // 4 j
      t({ id: 2, status: 'SOLVED', createdAt: new Date('2026-08-26'), solvedAt: new Date('2026-09-05') }), // 10 j
      t({ id: 3, status: 'SOLVED', createdAt: new Date('2026-09-10'), solvedAt: new Date('2026-10-01') }), // hors période de résolution
    );

    const body = await evolution();

    expect(body.totals.resolved).toBe(2);
    expect(body.totals.avgResolutionDays).toBe(7); // (4 + 10) / 2
  });

  it('filtre status : résolus restreints aux statuts résolus (intersection)', async () => {
    db.tickets.push(
      t({ id: 1, status: 'SOLVED', createdAt: new Date('2026-09-02'), solvedAt: new Date('2026-09-04') }),
      t({ id: 2, status: 'OPEN', createdAt: new Date('2026-09-02'), solvedAt: new Date('2026-09-06') }),
    );

    const bySolved = await evolution({ status: 'SOLVED' });
    expect(bySolved.totals.resolved).toBe(1);

    const byOpen = await evolution({ status: 'OPEN' });
    expect(byOpen.totals.resolved).toBe(0); // statut incompatible : rien à résoudre
  });

  it('ticket résolu avant puis clos pendant la période reste dans la série (résolu)', async () => {
    db.tickets.push(
      t({ id: 1, status: 'CLOSED', createdAt: new Date('2026-07-01'), solvedAt: new Date('2026-08-20'), closedAt: new Date('2026-09-10') }),
    );

    const body = await evolution();

    expect(body.totals.resolved).toBe(1);
    expect(sum(body.series, 'resolved')).toBe(1); // bucketisé sur la clôture, pas hors clés
    const bucket = body.series.find((x) => x.resolved > 0);
    expect(bucket.date).toBe('2026-09-10');
  });
});
