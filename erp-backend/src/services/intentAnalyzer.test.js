const mockTicketFindUnique = jest.fn();
const mockTicketUpdate = jest.fn();

jest.mock('../prismaClient', () => ({
  ticket: {
    findUnique: (...args) => mockTicketFindUnique(...args),
    update: (...args) => mockTicketUpdate(...args),
  },
}));

jest.mock('./ticketEvent', () => ({ logEvent: jest.fn() }));
jest.mock('./glpiTicketCreator', () => ({
  updateGlpiTicket: jest.fn(),
  createTicketFromEmail: jest.fn().mockResolvedValue({ erpTicketId: 2, glpiTicketId: null }),
}));

const { applyIntentActions } = require('./intentAnalyzer');

describe('applyIntentActions — validation humaine obligatoire des clôtures', () => {
  beforeEach(() => {
    mockTicketFindUnique.mockReset();
    mockTicketUpdate.mockReset();
    mockTicketFindUnique.mockResolvedValue({
      id: 1, status: 'OPEN', firstOpenedAt: new Date(), aiExchangeCount: 1,
    });
    mockTicketUpdate.mockImplementation(async (args) => ({ ...args.data, id: 1, glpiTicketId: 42 }));
  });

  it('ne clôt plus jamais automatiquement, même avec une confiance maximale', async () => {
    await applyIntentActions(1, { intent: 'RESOLVED', confidence: 0.99 }, 'AI');

    const updateCall = mockTicketUpdate.mock.calls[0][0];
    expect(updateCall.data.status).not.toBe('SOLVED');
    expect(updateCall.data.status).toBe('WAITING_FOR_USER');
    expect(updateCall.data.closeSuggested).toBe(true);
    expect(updateCall.data.closeSuggestedAt).toBeInstanceOf(Date);
    expect(updateCall.data.closeSuggestionConfidence).toBe(0.99);
    expect(updateCall.data.solvedAt).toBeUndefined();
  });

  it('suggère la clôture même à basse confiance', async () => {
    await applyIntentActions(1, { intent: 'RESOLVED', confidence: 0.3 }, 'AI');

    const updateCall = mockTicketUpdate.mock.calls[0][0];
    expect(updateCall.data.closeSuggested).toBe(true);
    expect(updateCall.data.closeSuggestionConfidence).toBe(0.3);
  });

  it('ne synchronise pas le statut GLPI tant que la clôture suggérée n\'est pas validée', async () => {
    const { updateGlpiTicket } = require('./glpiTicketCreator');

    mockTicketUpdate.mockImplementation(async (args) => ({ ...args.data, id: 1, glpiTicketId: 42 }));
    await applyIntentActions(1, { intent: 'RESOLVED', confidence: 0.99 }, 'AI');

    expect(updateGlpiTicket).not.toHaveBeenCalled();
  });

  it('suggère aussi la clôture sur NEW_ISSUE_IN_THREAD (split) au lieu de fermer automatiquement', async () => {
    mockTicketFindUnique.mockResolvedValue({
      id: 1, status: 'OPEN', firstOpenedAt: new Date(), splitCount: 0,
    });
    await applyIntentActions(
      1,
      { intent: 'NEW_ISSUE_IN_THREAD', confidence: 0.95, newIssueSummary: 'Nouveau souci' },
      'AI',
      { fromEmail: 'user@ex.com', fromName: 'User', originalBody: 'corps', originalSubject: 'sujet' }
    );

    const updateCall = mockTicketUpdate.mock.calls[0][0];
    expect(updateCall.data.closeSuggested).toBe(true);
    expect(updateCall.data.status).not.toBe('SOLVED');
    expect(updateCall.data.status).toBe('WAITING_FOR_USER');
  });
});
