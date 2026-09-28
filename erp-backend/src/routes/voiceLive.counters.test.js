// Chiffres vocaux = chiffres du dashboard (bug constaté : le mode vocal annonçait
// 48 « tickets ouverts » alors que /dashboard/stats en affiche 45).
// Le snapshot pré-chargé, get_ticket_count et generate_report doivent partager le
// même périmètre : corbeille (deletedAt) et suggestions en attente/rejetées
// (approvalStatus) exclues, et les 5 statuts ouverts (OPEN_STATUSES).
jest.mock('../prismaClient', () => {
  const db = { tickets: [], teams: [] };
  const isEq = (a, b) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);

  // Évaluation restreinte aux opérateurs réellement utilisés par les compteurs vocaux
  function matches(t, where = {}) {
    for (const [key, cond] of Object.entries(where)) {
      if (key === 'OR') {
        if (!cond.some((sub) => matches(t, sub))) return false;
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
        if ('not' in cond) {
          const excluded = cond.not === null ? val === null || val === undefined : isEq(val, cond.not);
          if (excluded) return false;
        }
        if ('equals' in cond && !isEq(val, cond.equals)) return false;
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
      groupBy: jest.fn(async ({ by, where, _count, take } = {}) => {
        const rows = new Map();
        for (const t of db.tickets.filter((x) => matches(x, where))) {
          const key = JSON.stringify(by.map((f) => t[f]));
          const bucket = rows.get(key) || { vals: by.map((f) => t[f]), n: 0 };
          bucket.n += 1;
          rows.set(key, bucket);
        }
        const countKey = _count && _count !== true ? Object.keys(_count)[0] : null;
        let out = [...rows.values()].map(({ vals, n }) => {
          const row = {};
          by.forEach((f, i) => { row[f] = vals[i]; });
          row._count = countKey ? { [countKey]: n } : n;
          return row;
        });
        out = out.sort((a, b) => {
          const av = countKey ? a._count[countKey] : a._count;
          const bv = countKey ? b._count[countKey] : b._count;
          return bv - av;
        });
        return typeof take === 'number' ? out.slice(0, take) : out;
      }),
      findMany: jest.fn(async ({ where, take } = {}) => {
        const rows = db.tickets.filter((t) => matches(t, where));
        return typeof take === 'number' ? rows.slice(0, take) : rows;
      }),
    },
    team: {
      // Le _count imbriqué (tickets de l'équipe) est calculé sur le where transmis
      findMany: jest.fn(async ({ select, take } = {}) => {
        const ticketsWhere = select?._count?.select?.tickets?.where || {};
        const teams = db.teams.map((team) => ({
          id: team.id,
          name: team.name,
          _count: { tickets: db.tickets.filter((t) => matches(t, ticketsWhere)).length },
        }));
        return typeof take === 'number' ? teams.slice(0, take) : teams;
      }),
    },
    user: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
    $queryRaw: jest.fn(async () => []),
    $queryRawUnsafe: jest.fn(async () => []),
  };
});

jest.mock('../utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../services/knowledgeSearch', () => ({ searchKnowledge: jest.fn(async () => []) }));
jest.mock('../services/chatbotService', () => ({
  searchTeams: jest.fn(async () => []),
  searchTickets: jest.fn(async () => ({ tickets: [], total: 0 })),
  buildSearchQuery: jest.fn(() => ({})),
  handleMessage: jest.fn(async () => ({ reply: '' })),
  executeTool: jest.fn(async () => ({})),
}));

const { __db: db } = require('../prismaClient');
const { executeTool, fetchVoiceSnapshot } = require('./voiceLive.routes');

const t = (over = {}) => ({
  title: 'Ticket',
  status: 'OPEN',
  priority: 'P2',
  approvalStatus: 'APPROVED',
  deletedAt: null,
  requesterId: 10,
  assignedToId: null,
  locationName: null,
  category: null,
  createdAt: new Date('2026-09-01'),
  updatedAt: new Date('2026-09-20'),
  ...over,
});

describe('Voice — les chiffres annoncés à l\'oral respectent le périmètre UI', () => {
  beforeEach(() => {
    db.tickets.length = 0;
    db.teams.length = 0;
    jest.clearAllMocks();
    // Périmètre volontairement « sale » : corbeille, approbation, WAITING_FOR_USER…
    db.tickets.push(
      t({ id: 1, status: 'OPEN', locationName: 'Abidjan' }),          // ouvert normal
      t({ id: 2, status: 'WAITING_FOR_USER' }),                       // ouvert (statut oublié avant)
      t({ id: 3, status: 'NEW', approvalStatus: 'PENDING', category: 'Réseau' }), // ← cause du 48
      t({ id: 4, status: 'OPEN', deletedAt: new Date('2026-09-22'), locationName: 'Abidjan' }), // corbeille
      t({ id: 5, status: 'NEW', category: 'Réseau' }),                // nouveau normal
      t({ id: 6, status: 'CLOSED' }),                                 // fermé
      t({ id: 7, status: 'OPEN', priority: 'P1' }),                   // critique ouvert
    );
    db.teams.push({ id: 1, name: 'Équipe 1' });
  });

  it('fetchVoiceSnapshot : exclut corbeille + approbation, inclut les 5 statuts ouverts', async () => {
    const snap = await fetchVoiceSnapshot(null);
    expect(snap.open).toBe(4);      // ids 1, 2, 5, 7 — NEW inclus ; id 3 (approbation) et id 4 (corbeille) exclus
    expect(snap.total).toBe(5);     // tous sauf id 3 (approbation) et id 4 (corbeille)
    expect(snap.newCount).toBe(1);  // id 5 seulement (id 3 en approbation exclu)
    expect(snap.p1Count).toBe(1);   // id 7
    expect(snap.solvedCount).toBe(1); // id 6
    expect(snap.topLocs).toEqual([{ locationName: 'Abidjan', _count: { id: 1 } }]); // corbeille exclue
    expect(snap.topCategories).toEqual([{ category: 'Réseau', _count: { id: 1 } }]); // approbation exclue
    expect(snap.teamStats[0]._count.tickets).toBe(4); // même périmètre que open
  });

  it('get_ticket_count : « ouverts » = 5 statuts ouverts (PENDING/WAITING inclus)', async () => {
    const r = await executeTool('get_ticket_count', {});
    expect(r.ouverts).toBe(4);      // ids 1, 2, 5, 7
    expect(r.enAttente).toBe(1);    // id 2 (sous-ensemble des ouverts)
    expect(r.total).toBe(5);
    expect(r.NEW).toBe(1);
    expect(r.CLOSED).toBe(1);
  });

  it('generate_report vocal : « ouverts » = même définition que le dashboard', async () => {
    const r = await executeTool('generate_report', {});
    expect(r.total).toBe(5);
    expect(r.ouverts).toBe(4);
    expect(r.fermes).toBe(1);
  });

  it('les trois sources annoncent le même nombre d\'ouverts', async () => {
    const snap = await fetchVoiceSnapshot(null);
    const count = await executeTool('get_ticket_count', {});
    const report = await executeTool('generate_report', {});
    expect(snap.open).toBe(count.ouverts);
    expect(snap.open).toBe(report.ouverts);
  });
});
