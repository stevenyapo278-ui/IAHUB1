// GET /dashboard/pulse — compteurs agrégés du widget flottant SystemPulse.jsx (un seul appel) :
//   1. définition « ouverts » identique à la vue tickets (OPEN_GROUP, corbeille exclue,
//      approbations PENDING/REJECTED exclues),
//   2. SLA dépassés = ouverts réellement breachés (un ticket résolu breaché ne compte pas),
//   3. relances = brouillons REMINDER encore en attente de décision,
//   4. boîte de réception scoppée par buildEmailScope : un demandeur ne voit que SES emails.
jest.mock('../prismaClient', () => {
  const db = { tickets: [], drafts: [], emails: [] };
  const isEq = (a, b) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);

  // Évaluation restreinte aux opérateurs réellement utilisés par le handler /pulse
  function matches(row, where = {}) {
    for (const [key, cond] of Object.entries(where)) {
      if (key === 'OR') {
        if (!Array.isArray(cond) || !cond.some((c) => matches(row, c))) return false;
        continue;
      }
      if (key === 'AND') {
        if (!Array.isArray(cond) || !cond.every((c) => matches(row, c))) return false;
        continue;
      }
      const val = row[key];
      if (cond === null) {
        if (val !== null && val !== undefined) return false;
        continue;
      }
      if (typeof cond === 'object' && !Array.isArray(cond)) {
        if ('none' in cond) {
          if ((val || []).length !== 0) return false;
          continue;
        }
        if ('some' in cond) {
          if (!(val || []).some((x) => matches(x, cond.some))) return false;
          continue;
        }
        if ('has' in cond) {
          if (!(Array.isArray(val) && val.includes(cond.has))) return false;
          continue;
        }
        if ('in' in cond && !cond.in.includes(val)) return false;
        if ('notIn' in cond && cond.notIn.includes(val)) return false;
        if ('not' in cond) {
          if (cond.not === null) {
            if (val === null || val === undefined) return false; // « not: null » = doit être renseigné
          } else if (isEq(val, cond.not)) return false;
        }
        if ('equals' in cond) {
          const target = cond.equals;
          const same = cond.mode === 'insensitive' && typeof val === 'string' && typeof target === 'string'
            ? val.toLowerCase() === target.toLowerCase()
            : isEq(val, target);
          if (!same) return false;
        }
        continue;
      }
      if (!isEq(val, cond)) return false;
    }
    return true;
  }

  return {
    __db: db,
    ticket: {
      count: jest.fn(async ({ where } = {}) => db.tickets.filter((t) => matches(t, where)).length),
      findMany: jest.fn(async ({ where } = {}) => db.tickets.filter((t) => matches(t, where))),
    },
    aiEmailDraft: { count: jest.fn(async ({ where } = {}) => db.drafts.filter((d) => matches(d, where)).length) },
    incomingEmail: { count: jest.fn(async ({ where } = {}) => db.emails.filter((e) => matches(e, where)).length) },
    emailAccount: {
      aggregate: jest.fn(async () => ({ _max: { lastSyncAt: new Date('2026-10-01T10:00:00.000Z') } })),
      count: jest.fn(async () => 1),
    },
    // Bloc « santé des intégrations » (visible seulement avec settings.integrations)
    apiConfig: { findFirst: jest.fn(async () => ({ baseUrl: 'https://glpi.local/apirest.php' })) },
    systemSettings: { findUnique: jest.fn(async () => ({ aiEnabled: true })) },
    aiProvider: { count: jest.fn(async () => 2) },
    n8nWorkflow: {
      findMany: jest.fn(async () => [
        { isActive: true, lastStatus: 'success' },
        { isActive: true, lastStatus: 'error' },
        { isActive: false, lastStatus: 'error' },
      ]),
    },
  };
});

jest.mock('../middleware/auth', () => ({ authenticate: (_req, _res, next) => next() }));
// hasPermission piloté par un drapeau : le bloc « santé des intégrations » de /pulse
// n'apparaît que pour les rôles qui ont settings.integrations.
let mockCanSeeIntegrations = true;
jest.mock('../middleware/permissions', () => ({
  requirePermission: () => (_req, _res, next) => next(),
  hasPermission: jest.fn(async () => mockCanSeeIntegrations),
}));
jest.mock('../services/pdfReportService', () => ({ generateReport: jest.fn() }));
jest.mock('../utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const { __db: db } = require('../prismaClient');
const router = require('./dashboard.routes');

function getHandler(path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods.get);
  if (!layer) throw new Error(`Route GET ${path} introuvable`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function makeReq({ user = { sub: 1, role: 'SUPERADMIN' } } = {}) {
  return { user, query: {}, headers: {}, requestId: 'test-req' };
}

function makeRes() {
  const res = { statusCode: 200, body: null, sent: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.body = payload; return res; });
  res.send = jest.fn((payload) => { res.sent = payload; return res; });
  return res;
}

const t = (over = {}) => ({
  status: 'OPEN',
  approvalStatus: 'APPROVED',
  deletedAt: null,
  assignedToId: null,
  slaBreachedAt: null,
  replyOnClosedSuggested: false,
  newTicketSuggested: false,
  ...over,
});

const d = (over = {}) => ({ status: 'PENDING', draftKind: 'ACKNOWLEDGEMENT', ...over });
const e = (over = {}) => ({ folderId: null, status: 'DONE', isRead: true, fromEmail: 'x@y.ci', erpTicketId: null, ...over });

beforeEach(() => {
  db.tickets.length = 0;
  db.drafts.length = 0;
  db.emails.length = 0;
  mockCanSeeIntegrations = true;
  jest.clearAllMocks();
});

describe('GET /dashboard/pulse — compteurs du widget flottant', () => {
  it('compte les ouverts, SLA dépassés et non assignés exactement comme la vue tickets', async () => {
    db.tickets.push(
      t({ id: 1, status: 'OPEN' }), // ouvert, non breaché, non assigné
      t({ id: 2, status: 'OPEN', slaBreachedAt: new Date(), assignedToId: 5 }), // breaché
      t({ id: 3, status: 'CLOSED', slaBreachedAt: new Date(), assignedToId: 5 }), // résolu : hors périmètre
      t({ id: 4, status: 'NEW', deletedAt: new Date() }), // corbeille
      t({ id: 5, status: 'OPEN', approvalStatus: 'PENDING', assignedToId: 5 }), // approbation en attente
      t({ id: 6, status: 'WAITING_FOR_USER', assignedToId: 5 }), // ouvert (OPEN_GROUP)
    );

    const res = makeRes();
    await getHandler('/pulse')(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.openTickets).toBe(3); // 1, 2, 6
    expect(res.body.slaBreached).toBe(1); // 2 uniquement
    expect(res.body.unassigned).toBe(1); // 1 uniquement
    expect(res.body.approvals).toBe(1); // 5
    expect(res.body.lastEmailSyncAt.toISOString()).toBe('2026-10-01T10:00:00.000Z');
    expect(typeof res.body.fetchedAt).toBe('string');
  });

  it('sépare les brouillons en attente des relances (REMINDER)', async () => {
    db.tickets.push(t({ id: 1 }));
    db.drafts.push(
      d({ id: 1, draftKind: 'REMINDER' }),
      d({ id: 2, draftKind: 'REMINDER', status: 'APPROVED' }), // déjà traité
      d({ id: 3, draftKind: 'ACKNOWLEDGEMENT' }),
    );

    const res = makeRes();
    await getHandler('/pulse')(makeReq(), res);

    expect(res.body.aiDrafts).toBe(2); // 1 et 3
    expect(res.body.reminders).toBe(1); // 1 uniquement
  });

  it('exclut la corbeille des suggestions de réponse et compte les erreurs de boîte', async () => {
    db.tickets.push(
      t({ id: 1, replyOnClosedSuggested: true }),
      t({ id: 2, newTicketSuggested: true, deletedAt: new Date() }), // corbeille
      t({ id: 3, newTicketSuggested: true }),
    );
    db.emails.push(
      e({ id: 1, status: 'ERROR', isRead: false }),
      e({ id: 2, status: 'RETRY' }),
      e({ id: 3, status: 'DEAD_LETTER' }),
      e({ id: 4, status: 'DONE' }),
    );

    const res = makeRes();
    await getHandler('/pulse')(makeReq(), res);

    expect(res.body.replySuggestions).toBe(2); // 1 et 3
    expect(res.body.inboxErrors).toBe(3); // ERROR + RETRY + DEAD_LETTER
    expect(res.body.inboxUnread).toBe(1); // 1
    expect(res.body.inboxProcessing).toBe(0);
  });

  it('scoppe la boîte de réception pour un demandeur (seuls SES emails)', async () => {
    db.emails.push(
      e({ id: 1, fromEmail: 'demandeur@prosuma.ci', status: 'ERROR', isRead: false }),
      e({ id: 2, fromEmail: 'autre@prosuma.ci', status: 'ERROR', isRead: false }),
      e({ id: 3, fromEmail: 'AUTRE2@prosuma.ci', erpTicketId: 42, status: 'ERROR' }),
    );
    db.tickets.push(t({ id: 42, requesterId: 9, assignedToId: 5 }));

    const res = makeRes();
    await getHandler('/pulse')(makeReq({
      user: { sub: 9, role: 'REQUESTER', email: 'Demandeur@prosuma.ci' },
    }), res);

    // Portée appliquée : fromEmail (insensible à la casse) OU ticket rattaché au demandeur
    const wheres = require('../prismaClient').incomingEmail.count.mock.calls.map((c) => c[0].where);
    const inboxWhere = wheres.find((w) => w && w.folderId === null && w.OR);
    expect(inboxWhere).toBeDefined();
    expect(inboxWhere.OR[0]).toEqual({ fromEmail: { equals: 'demandeur@prosuma.ci', mode: 'insensitive' } });
    expect(inboxWhere.OR[1]).toEqual({ erpTicketId: { in: [42] } });

    expect(res.body.inboxErrors).toBe(2); // emails 1 et 3 seulement
    expect(res.body.inboxUnread).toBe(1); // email 1 (les 2 et 3 sont lus)
    expect(res.body.openTickets).toBe(1); // ticket 42 (les compteurs tickets ne sont pas scoppés)
  });

  it('ne scoppe pas la boîte pour les autres rôles (scope null)', async () => {
    db.emails.push(e({ id: 1, status: 'ERROR', isRead: false }), e({ id: 2, fromEmail: 'autre@x.ci', status: 'ERROR' }));

    const res = makeRes();
    await getHandler('/pulse')(makeReq({ user: { sub: 5, role: 'HOTLINE', email: 'hl@x.ci' } }), res);

    const wheres = require('../prismaClient').incomingEmail.count.mock.calls.map((c) => c[0].where);
    expect(wheres.some((w) => w && w.OR)).toBe(false); // aucun filtre de portée
    expect(res.body.inboxErrors).toBe(2);
  });

  it('compte mes tickets (titulaire ou co-affecté), pas ceux des autres', async () => {
    db.tickets.push(
      t({ id: 1, assignedToId: 7, status: 'OPEN' }), // moi (titulaire)
      t({ id: 2, status: 'OPEN', assignees: [{ id: 7 }] }), // moi (co-affecté)
      t({ id: 3, assignedToId: 7, status: 'CLOSED' }), // résolu : hors périmètre
      t({ id: 4, assignedToId: 9, status: 'OPEN' }), // quelqu'un d'autre
    );

    const res = makeRes();
    await getHandler('/pulse')(makeReq({ user: { sub: 7, role: 'TECHNICIAN' } }), res);

    expect(res.body.myOpenTickets).toBe(2);
    expect(res.body.openTickets).toBe(3); // 1, 2, 4 — pas de périmètre personnel ici
  });

  it('pour un demandeur, tous les compteurs tickets sont limités à SES tickets', async () => {
    db.tickets.push(
      t({ id: 1, requesterId: 9, status: 'OPEN' }),
      t({ id: 2, requesterId: 9, status: 'OPEN', slaBreachedAt: new Date() }),
      t({ id: 3, requesterId: 44, status: 'OPEN', slaBreachedAt: new Date() }), // d'autres
      t({ id: 4, requesterId: 9, status: 'OPEN', approvalStatus: 'PENDING' }),
      t({ id: 5, requesterId: 9, status: 'OPEN' }),
    );

    const res = makeRes();
    await getHandler('/pulse')(makeReq({ user: { sub: 9, role: 'REQUESTER', email: 'd@x.ci' } }), res);

    expect(res.body.openTickets).toBe(3); // 1, 2, 5 (4 en attente d'approbation, 3 hors périmètre)
    expect(res.body.slaBreached).toBe(1); // 2 uniquement
    expect(res.body.myOpenTickets).toBe(3); // = son périmètre pour un demandeur
    expect(res.body.approvals).toBe(1); // 4
  });

  it('expose la santé des intégrations seulement avec settings.integrations', async () => {
    const prisma = require('../prismaClient');
    db.tickets.push(t({ id: 1 }));

    const res = makeRes();
    await getHandler('/pulse')(makeReq(), res);
    expect(res.body.integrations).toEqual({
      glpi: { configured: true },
      email: { accounts: 1 },
      ai: { enabled: true, providers: 2 },
      n8n: { active: 2, failing: 1 }, // le workflow inactif en erreur ne compte pas
    });

    mockCanSeeIntegrations = false;
    const res2 = makeRes();
    await getHandler('/pulse')(makeReq(), res2);
    expect(res2.body.integrations).toBeNull();
    expect(prisma.apiConfig.findFirst).toHaveBeenCalledTimes(1); // pas relancé sans droit
  });
});
