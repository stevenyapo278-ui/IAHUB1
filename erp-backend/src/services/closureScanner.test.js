const mockTicketFindMany = jest.fn();
const mockTicketMessageFindMany = jest.fn();
const mockTicketUpdate = jest.fn();
const mockTicketEventFindMany = jest.fn();

jest.mock('../prismaClient', () => ({
  ticket: {
    findMany: (...args) => mockTicketFindMany(...args),
    update: (...args) => mockTicketUpdate(...args),
  },
  ticketMessage: {
    findMany: (...args) => mockTicketMessageFindMany(...args),
  },
  ticketEvent: {
    findMany: (...args) => mockTicketEventFindMany(...args),
  },
}));

jest.mock('./ticketEvent', () => ({ logEvent: jest.fn() }));
jest.mock('./mailAnalyzer', () => ({
  getActiveProviders: jest.fn().mockResolvedValue([{ name: 'test-provider' }]),
  callProviderWithFallback: jest.fn(),
}));
jest.mock('./promptTemplates', () => ({
  getPrompt: jest.fn().mockResolvedValue('prompt'),
}));

const { runClosureAnalysis } = require('./closureScanner');
const { callProviderWithFallback } = require('./mailAnalyzer');

function baseTicket(overrides = {}) {
  return {
    id: 1, title: 'Ticket de test', aiSummary: 'Résumé',
    status: 'OPEN', closeSuggestionCount: 0,
    firstOpenedAt: new Date(Date.now() - 10 * 86400000),
    createdAt: new Date(Date.now() - 10 * 86400000),
    updatedAt: new Date(Date.now() - 5 * 86400000),
    lastUserReplyAt: new Date(Date.now() - 6 * 86400000),
    ...overrides,
  };
}

function baseHistory() {
  return [
    { direction: 'INBOUND', body: 'Mon imprimante est en panne', timestamp: new Date(Date.now() - 6 * 86400000) },
    { direction: 'OUTBOUND', body: 'Le problème est corrigé, dites-nous si cela fonctionne', timestamp: new Date(Date.now() - 5 * 86400000) },
  ];
}

describe('runClosureAnalysis — scanne les tickets pour proposer des clôtures', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTicketFindMany.mockReset();
    mockTicketMessageFindMany.mockReset();
    mockTicketUpdate.mockReset();
    mockTicketEventFindMany.mockReset();
    mockTicketFindMany.mockResolvedValue([baseTicket()]);
    mockTicketMessageFindMany.mockResolvedValue(baseHistory());
    mockTicketEventFindMany.mockResolvedValue([]);
    mockTicketUpdate.mockImplementation(async (args) => ({ ...args.data, id: 1 }));
  });

  it('suggère la clôture quand l\'IA conclut à une résolution confiante et prouvée', async () => {
    callProviderWithFallback.mockResolvedValue('{"resolved": true, "confidence": 0.9, "evidence": "Le problème est corrigé"}');

    const result = await runClosureAnalysis({ limit: 10 });

    expect(mockTicketFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ closeSuggested: false }),
    }));
    const updateCall = mockTicketUpdate.mock.calls[0][0];
    expect(updateCall.data.closeSuggested).toBe(true);
    expect(updateCall.data.closeSuggestionConfidence).toBe(0.9);
    expect(updateCall.data.closeSuggestionCount).toBe(1);
    expect(result.suggested).toBe(1);
  });

  it('ne suggère rien si l\'IA conclut que le problème persiste', async () => {
    callProviderWithFallback.mockResolvedValue('{"resolved": false, "confidence": 0.9, "evidence": "L\'utilisateur signale encore le souci"}');

    const result = await runClosureAnalysis({ limit: 10 });

    expect(mockTicketUpdate).not.toHaveBeenCalled();
    expect(result.suggested).toBe(0);
  });

  it('ne suggère rien si la confiance est insuffisante (< 0.7)', async () => {
    callProviderWithFallback.mockResolvedValue('{"resolved": true, "confidence": 0.5, "evidence": "preuve"}');

    const result = await runClosureAnalysis({ limit: 10 });

    expect(mockTicketUpdate).not.toHaveBeenCalled();
    expect(result.results[0].action).toBe('SKIP_LOW_CONFIDENCE');
  });

  it('ne suggère rien sans preuve (evidence vide)', async () => {
    callProviderWithFallback.mockResolvedValue('{"resolved": true, "confidence": 0.9, "evidence": ""}');

    const result = await runClosureAnalysis({ limit: 10 });

    expect(mockTicketUpdate).not.toHaveBeenCalled();
    expect(result.results[0].action).toBe('SKIP_NO_EVIDENCE');
  });

  it('ignore un ticket sans historique suffisant', async () => {
    mockTicketMessageFindMany.mockResolvedValue([]);

    const result = await runClosureAnalysis({ limit: 10 });

    expect(mockTicketUpdate).not.toHaveBeenCalled();
    expect(result.results[0].action).toBe('SKIP_NO_HISTORY');
  });

  it('sélectionne uniquement les tickets sans réponse utilisateur récente et sous le plafond de suggestions', async () => {
    await runClosureAnalysis({ minDaysWithoutReply: 4, limit: 25 });

    const where = mockTicketFindMany.mock.calls[0][0].where;
    expect(where.status.notIn).toEqual(['SOLVED', 'CLOSED']);
    expect(where.closeSuggestionCount.lt).toBe(2);
    expect(where.OR[0].lastUserReplyAt.lt).toBeInstanceOf(Date);
  });
});
