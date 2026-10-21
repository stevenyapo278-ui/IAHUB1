const mockAiUsageLogCreate = jest.fn();
const mockAiUsageLogAggregate = jest.fn();
const mockAiUsageLogGroupBy = jest.fn();
const mockAiUsageLogCount = jest.fn();
const mockQueryRaw = jest.fn();

jest.mock('../prismaClient', () => ({
  aiUsageLog: {
    create: (...args) => mockAiUsageLogCreate(...args),
    aggregate: (...args) => mockAiUsageLogAggregate(...args),
    groupBy: (...args) => mockAiUsageLogGroupBy(...args),
    count: (...args) => mockAiUsageLogCount(...args),
  },
  $queryRaw: (...args) => mockQueryRaw(...args),
}));

// getSystemSettings : budget par défaut 100000, pas d'alerte
const mockSettings = {
  aiEnabled: true,
  aiDailyTokenBudget: 100000,
  aiTokenAlertThreshold: 0.8,
  aiTokenAlertRecipients: [],
};
jest.mock('./systemSettings', () => ({
  getSystemSettings: jest.fn(async () => mockSettings),
}));

// emailSender : on intercepte les alertes pour vérifier l'envoi
const mockSendEmail = jest.fn();
jest.mock('./emailSender', () => ({
  sendEmail: (...args) => mockSendEmail(...args),
}));

const { trackAiUsage, getTodayTokenUsage, checkTokenBudget, getAiUsageStats } = require('./aiUsageTracker');

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings.aiDailyTokenBudget = 100000;
  mockSettings.aiTokenAlertThreshold = 0.8;
  mockSettings.aiTokenAlertRecipients = [];
  mockAiUsageLogCreate.mockResolvedValue({ id: 1 });
  mockAiUsageLogAggregate.mockResolvedValue({ _sum: { totalTokens: 0 } });
  mockSendEmail.mockResolvedValue({});
});

describe('trackAiUsage', () => {
  it("n'enregistre rien si usage est vide ou à zéro token", async () => {
    await trackAiUsage(null, 'gemini', 'chatbot');
    await trackAiUsage({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }, 'gemini', 'chatbot');
    expect(mockAiUsageLogCreate).not.toHaveBeenCalled();
  });

  it('enregistre les champs enrichis (model, durationMs, estimated, userId, source)', async () => {
    await trackAiUsage(
      { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      'gemini',
      'chatbot',
      { model: 'gemini-3.5-flash', durationMs: 1234, estimated: true, userId: 42, source: 'chatbotAnswer' }
    );

    expect(mockAiUsageLogCreate).toHaveBeenCalledWith({
      data: {
        provider: 'gemini',
        usage: 'chatbot',
        source: 'chatbotAnswer',
        model: 'gemini-3.5-flash',
        userId: 42,
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        durationMs: 1234,
        estimated: true,
      },
    });
  });

  it("enregistre avec estimated=false, userId=null et source=null par défaut", async () => {
    await trackAiUsage({ promptTokens: 10, completionTokens: 5, totalTokens: 15 }, 'openai', 'email');
    const data = mockAiUsageLogCreate.mock.calls[0][0].data;
    expect(data.estimated).toBe(false);
    expect(data.userId).toBeNull();
    expect(data.model).toBeNull();
    expect(data.durationMs).toBeNull();
    expect(data.source).toBeNull();
  });

  it("vérifie le budget journalier après l'enregistrement", async () => {
    await trackAiUsage({ promptTokens: 1, completionTokens: 1, totalTokens: 2 }, 'gemini', 'email');
    // checkTokenBudget appelle getTodayTokenUsage → aggregate
    expect(mockAiUsageLogAggregate).toHaveBeenCalled();
  });
});

describe('getAiUsageStats', () => {
  it('convertit les BigInt des requêtes SQL en Number (la réponse JSON ne doit pas planter)', async () => {
    // SUM()/COUNT() en SQL brut renvoient des bigint que Prisma livre en BigInt :
    // sans conversion, res.json() lève « Do not know how to serialize a BigInt »
    // et toute la vue suivi de consommation tombe en 500.
    mockQueryRaw
      .mockResolvedValueOnce([
        { userId: 1, fullName: 'Alice', email: 'a@x.ci', totalTokens: 5000n, calls: 12n },
      ])
      .mockResolvedValueOnce([
        { date: new Date('2026-10-14'), totalTokens: 5000n, calls: 12n },
      ])
      .mockResolvedValueOnce([
        { hour: '2026-10-14 08:00', source: 'dailySummary', totalTokens: 600n, calls: 2n },
        { hour: '2026-10-14 08:00', source: 'analyzeEmail', totalTokens: 300n, calls: 1n },
        { hour: '2026-10-14 09:00', source: null, totalTokens: 120n, calls: 4n },
      ]);

    const stats = await getAiUsageStats(7);

    expect(() => JSON.stringify(stats)).not.toThrow();
    expect(stats.byUser[0]).toMatchObject({ totalTokens: 5000, calls: 12 });
    expect(stats.byDay[0]).toMatchObject({ totalTokens: 5000, calls: 12 });
    expect(typeof stats.byDay[0].totalTokens).toBe('number');
    expect(typeof stats.byDay[0].calls).toBe('number');
    // Agrégat horaire = somme des tâches sur chaque heure
    expect(stats.byHour).toEqual([
      { hour: '2026-10-14 08:00', totalTokens: 900, calls: 3 },
      { hour: '2026-10-14 09:00', totalTokens: 120, calls: 4 },
    ]);
    // Détail horaire × tâche (permet d'imputer un pic à une tâche)
    expect(stats.byHourSource).toEqual([
      { hour: '2026-10-14 08:00', source: 'dailySummary', totalTokens: 600, calls: 2 },
      { hour: '2026-10-14 08:00', source: 'analyzeEmail', totalTokens: 300, calls: 1 },
      { hour: '2026-10-14 09:00', source: null, totalTokens: 120, calls: 4 },
    ]);
    expect(stats.byHourPeriodStart).toBeTruthy();
  });

  it("gère un byDay vide sans planter", async () => {
    mockQueryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const stats = await getAiUsageStats(7);
    expect(stats.byUser).toEqual([]);
    expect(stats.byDay).toEqual([]);
    expect(stats.byHour).toEqual([]);
    expect(stats.byHourSource).toEqual([]);
  });

  it('normalise bySource (tâche appelante) avec feature, tokens et appels', async () => {
    mockAiUsageLogGroupBy.mockImplementation(async ({ by }) => {
      if (by && by[0] === 'source') {
        return [
          { source: 'dailySummary', usage: 'background', _sum: { totalTokens: 1200, promptTokens: 1000, completionTokens: 200 }, _count: { id: 4 } },
          { source: null, usage: 'email', _sum: { totalTokens: 50, promptTokens: 40, completionTokens: 10 }, _count: { id: 2 } },
        ];
      }
      return [];
    });
    mockQueryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const stats = await getAiUsageStats(7);

    expect(stats.bySource).toEqual([
      { source: 'dailySummary', usage: 'background', totalTokens: 1200, promptTokens: 1000, completionTokens: 200, calls: 4 },
      { source: null, usage: 'email', totalTokens: 50, promptTokens: 40, completionTokens: 10, calls: 2 },
    ]);
  });
});

describe('getTodayTokenUsage', () => {
  it("retourne 0 si aucun token aujourd'hui", async () => {
    mockAiUsageLogAggregate.mockResolvedValue({ _sum: { totalTokens: null } });
    expect(await getTodayTokenUsage()).toBe(0);
  });

  it("retourne la somme du jour", async () => {
    mockAiUsageLogAggregate.mockResolvedValue({ _sum: { totalTokens: 4200 } });
    expect(await getTodayTokenUsage()).toBe(4200);
  });
});

describe('checkTokenBudget', () => {
  it("n'envoie pas d'alerte si le budget est illimité (0)", async () => {
    mockSettings.aiDailyTokenBudget = 0;
    mockSettings.aiTokenAlertRecipients = ['a@b.c'];
    await checkTokenBudget();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("n'envoie pas d'alerte si on est sous le seuil", async () => {
    mockSettings.aiDailyTokenBudget = 100000;
    mockSettings.aiTokenAlertRecipients = ['a@b.c'];
    mockAiUsageLogAggregate.mockResolvedValue({ _sum: { totalTokens: 10000 } }); // 10%
    await checkTokenBudget();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("envoie une alerte email si le seuil est dépassé", async () => {
    mockSettings.aiDailyTokenBudget = 100000;
    mockSettings.aiTokenAlertThreshold = 0.8;
    mockSettings.aiTokenAlertRecipients = ['admin@x.ci'];
    mockAiUsageLogAggregate.mockResolvedValue({ _sum: { totalTokens: 90000 } }); // 90%
    await checkTokenBudget();
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const call = mockSendEmail.mock.calls[0][0];
    expect(call.to).toEqual(['admin@x.ci']);
    expect(call.subject).toMatch(/budget journalier/i);
  });
});
