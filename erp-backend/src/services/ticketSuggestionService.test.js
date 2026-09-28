// Moteur de suggestions de triage (Centre de Validation) :
// tous les champs (équipe, technicien, observateurs, priorité) doivent être
// suggérés en combinant compétence (UserSkill), historique (tickets de même
// catégorie, auto-assignations corrigées) et charge active.
jest.mock('../prismaClient', () => ({
  userSkill: { findMany: jest.fn(async () => []) },
  ticket: { groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
  team: { findFirst: jest.fn(async () => null), findUnique: jest.fn(async () => null), findMany: jest.fn(async () => []) },
  user: { findMany: jest.fn(async () => []) },
  reassignmentLog: { groupBy: jest.fn(async () => []) },
}));

const prisma = require('../prismaClient');
const { scoreCandidate, suggestPriority, suggestObservers, scoreCandidates, suggestAnalysisFields } = require('./ticketSuggestionService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('scoreCandidate — score combiné compétence + historique + charge', () => {
  const hist = { load: 0, handled: 10, same: 5, resolvedSame: 5, corrected: 0 };

  it('un expert disponible sur la catégorie atteint le score maximal', () => {
    expect(scoreCandidate({ skillLevel: 5, hist, maxLoad: 10 })).toBe(100);
  });

  it('un débutant surchargé descend fortement', () => {
    const tired = { load: 10, handled: 2, same: 1, resolvedSame: 0, corrected: 0 };
    const score = scoreCandidate({ skillLevel: 1, hist: tired, maxLoad: 10 });
    expect(score).toBeLessThan(50);
  });

  it('sans compétence déclarée, le score se fonde sur historique et charge', () => {
    const score = scoreCandidate({ skillLevel: null, hist, maxLoad: 10 });
    expect(score).toBeGreaterThan(70);
    expect(score).toBeLessThan(100);
  });

  it('les auto-assignations corrigées pénalisent le score', () => {
    const clean = scoreCandidate({ skillLevel: 5, hist, maxLoad: 10 });
    const corrected = scoreCandidate({ skillLevel: 5, hist: { ...hist, corrected: 2 }, maxLoad: 10 });
    expect(corrected).toBeLessThan(clean);
    expect(corrected).toBe(clean - 20);
  });
});

describe('suggestPriority — matrice impact × urgence avec alias UI', () => {
  it('comprend la gamme étendue de l\'interface (MAJOR / VERY_HIGH → P1)', async () => {
    const suggestion = await suggestPriority({ ticket: { impact: 'MAJOR', urgency: 'VERY_HIGH', type: 'INCIDENT', category: null } });
    expect(suggestion.value).toBe('P1');
    expect(suggestion.reasons[0]).toContain('≡ CRITICAL / CRITICAL');
  });

  it('HIGH / HIGH reste P2 et VERY_LOW / VERY_LOW descend en P4', async () => {
    const high = await suggestPriority({ ticket: { impact: 'HIGH', urgency: 'HIGH', type: 'INCIDENT', category: null } });
    const low = await suggestPriority({ ticket: { impact: 'VERY_LOW', urgency: 'VERY_LOW', type: 'INCIDENT', category: null } });
    expect(high.value).toBe('P2');
    expect(low.value).toBe('P4');
  });
});

describe('suggestObservers — défauts équipe + historique, hors technicien assigné', () => {
  it('combine les observateurs par défaut et les techniciens historiques', async () => {
    prisma.team.findUnique.mockResolvedValueOnce({ defaultObservers: [{ id: 1, fullName: 'Observateur équipe' }] });
    prisma.ticket.groupBy.mockResolvedValueOnce([
      { assignedToId: 3, _count: { id: 12 } }, // technicien assigné : exclu
      { assignedToId: 2, _count: { id: 7 } },
      { assignedToId: 1, _count: { id: 4 } }, // déjà observateur par défaut : exclu (seen)
    ]);
    prisma.user.findMany.mockResolvedValueOnce([{ id: 2, fullName: 'Historique Tech' }]);

    const observers = await suggestObservers({ teamId: 9, category: 'Matériel', excludeIds: [3] });

    expect(observers.map((o) => o.id)).toEqual([1, 2]);
    expect(observers[0].source).toBe('equipe');
    expect(observers[1].source).toBe('historique');
    expect(observers[1].reasons[0]).toContain('7 ticket(s)');
  });
});

describe('suggestAnalysisFields — tous les champs suggérés + historique du demandeur', () => {
  it('propose une catégorie alternative issue de l\'historique du demandeur', async () => {
    prisma.ticket.groupBy.mockImplementation(async ({ by }) => {
      if (by.includes('category')) return [
        { category: 'Matériel', _count: { id: 8 } },
        { category: 'Sécurité', _count: { id: 2 } },
      ];
      return [];
    });

    const analysis = await suggestAnalysisFields({ id: 50, category: 'Sécurité', requesterId: 7, aiProcessed: true });

    expect(analysis.source).toBe('Suggéré par l\'IA de triage');
    expect(analysis.categoryAlternative.value).toBe('Matériel');
    expect(analysis.categoryAlternative.reasons[0]).toContain('80 %');
  });

  it('ne propose rien quand la catégorie actuelle domine déjà chez le demandeur', async () => {
    prisma.ticket.groupBy.mockImplementation(async ({ by }) => {
      if (by.includes('category')) return [{ category: 'Sécurité', _count: { id: 9 } }];
      return [];
    });

    const analysis = await suggestAnalysisFields({ id: 51, category: 'Sécurité', sourceEmail: 'user@x.ci', aiProcessed: false });

    expect(analysis.source).toBe('Saisi manuellement');
    expect(analysis.categoryAlternative).toBeNull();
  });
});

describe('scoreCandidates — fallback Centre de Validation', () => {
  it('sans compétente ni équipe : propose quand même tous les techniciens actifs', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 11, fullName: 'Tech A', teamId: 2 },
      { id: 12, fullName: 'Tech B', teamId: null },
    ]);

    const { ranked, method } = await scoreCandidates('Serveur', 'Serveur', 'Serveur', { fallbackAll: true });

    expect(method).toBe('fallback');
    expect(ranked).toHaveLength(2);
    expect(ranked.map((r) => r.id).sort()).toEqual([11, 12]);
  });

  it('sans fallbackAll (auto-assign à la création) : reste strictement vide', async () => {
    const { ranked } = await scoreCandidates('Serveur', 'Serveur', 'Serveur');
    expect(ranked).toHaveLength(0);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
