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

const { trackAiUsage, getTodayTokenUsage, checkTokenBudget } = require('./aiUsageTracker');

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

  it('enregistre les champs enrichis (model, durationMs, estimated, userId)', async () => {
    await trackAiUsage(
      { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      'gemini',
      'chatbot',
      { model: 'gemini-3.5-flash', durationMs: 1234, estimated: true, userId: 42 }
    );

    expect(mockAiUsageLogCreate).toHaveBeenCalledWith({
      data: {
        provider: 'gemini',
        usage: 'chatbot',
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

  it('enregistre avec estimated=false et userId=null par défaut', async () => {
    await trackAiUsage({ promptTokens: 10, completionTokens: 5, totalTokens: 15 }, 'openai', 'email');
    const data = mockAiUsageLogCreate.mock.calls[0][0].data;
    expect(data.estimated).toBe(false);
    expect(data.userId).toBeNull();
    expect(data.model).toBeNull();
    expect(data.durationMs).toBeNull();
  });

  it("vérifie le budget journalier après l'enregistrement", async () => {
    await trackAiUsage({ promptTokens: 1, completionTokens: 1, totalTokens: 2 }, 'gemini', 'email');
    // checkTokenBudget appelle getTodayTokenUsage → aggregate
    expect(mockAiUsageLogAggregate).toHaveBeenCalled();
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
