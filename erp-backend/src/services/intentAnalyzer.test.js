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
    require('./glpiTicketCreator').updateGlpiTicket.mockClear();
    require('./glpiTicketCreator').createTicketFromEmail.mockClear();
    mockTicketFindUnique.mockResolvedValue({
      id: 1, status: 'OPEN', firstOpenedAt: new Date(), aiExchangeCount: 1, closeSuggestionCount: 0,
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
    expect(updateCall.data.closeSuggestionCount).toBe(1);
    expect(updateCall.data.solvedAt).toBeUndefined();
  });

  it('suggère la clôture à haute confiance (>= 0.7)', async () => {
    await applyIntentActions(1, { intent: 'RESOLVED', confidence: 0.7 }, 'AI');

    const updateCall = mockTicketUpdate.mock.calls[0][0];
    expect(updateCall.data.closeSuggested).toBe(true);
    expect(updateCall.data.closeSuggestionConfidence).toBe(0.7);
  });

  it('ne suggère AUCUNE clôture à basse confiance (< 0.7) — ticket en attente humaine sans suggestion', async () => {
    const { logEvent } = require('./ticketEvent');

    await applyIntentActions(1, { intent: 'RESOLVED', confidence: 0.3 }, 'AI');

    const updateCall = mockTicketUpdate.mock.calls[0][0];
    expect(updateCall.data.closeSuggested).toBeUndefined();
    expect(updateCall.data.closeSuggestedAt).toBeUndefined();
    expect(updateCall.data.status).toBe('WAITING_FOR_USER');
    expect(logEvent).toHaveBeenCalledWith(1, 'CLOSURE_NOT_SUGGESTED', 'AI', expect.objectContaining({ reason: 'low_confidence' }));
  });

  it('ne re-suggère plus au-delà de 2 suggestions sur le même ticket (anti-boucle)', async () => {
    const { logEvent } = require('./ticketEvent');

    mockTicketFindUnique.mockResolvedValue({
      id: 1, status: 'OPEN', firstOpenedAt: new Date(), closeSuggestionCount: 2,
    });
    await applyIntentActions(1, { intent: 'RESOLVED', confidence: 0.99 }, 'AI');

    const updateCall = mockTicketUpdate.mock.calls[0][0];
    expect(updateCall.data.closeSuggested).toBeUndefined();
    expect(logEvent).toHaveBeenCalledWith(1, 'CLOSURE_NOT_SUGGESTED', 'AI', expect.objectContaining({ reason: 'limit_reached' }));
  });

  it('ne synchronise pas le statut GLPI tant que la clôture suggérée n\'est pas validée', async () => {
    const { updateGlpiTicket } = require('./glpiTicketCreator');

    mockTicketUpdate.mockImplementation(async (args) => ({ ...args.data, id: 1, glpiTicketId: 42 }));
    await applyIntentActions(1, { intent: 'RESOLVED', confidence: 0.99 }, 'AI');

    expect(updateGlpiTicket).not.toHaveBeenCalled();
  });

  it('suggère aussi la clôture sur NEW_ISSUE_IN_THREAD (split) au lieu de fermer automatiquement', async () => {
    mockTicketFindUnique.mockResolvedValue({
      id: 1, status: 'OPEN', firstOpenedAt: new Date(), splitCount: 0, closeSuggestionCount: 0,
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

  it('scinde le nouveau sujet même si la clôture n\'est pas suggérée (confiance insuffisante)', async () => {
    const { createTicketFromEmail } = require('./glpiTicketCreator');

    mockTicketFindUnique.mockResolvedValue({
      id: 1, status: 'OPEN', firstOpenedAt: new Date(), splitCount: 0, closeSuggestionCount: 0,
    });
    await applyIntentActions(
      1,
      { intent: 'NEW_ISSUE_IN_THREAD', confidence: 0.4, newIssueSummary: 'Nouveau souci' },
      'AI',
      { fromEmail: 'user@ex.com', fromName: 'User', originalBody: 'corps', originalSubject: 'sujet' }
    );

    expect(createTicketFromEmail).toHaveBeenCalled();
    const updateCall = mockTicketUpdate.mock.calls[0][0];
    expect(updateCall.data.closeSuggested).toBeUndefined();
  });
});