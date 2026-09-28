const mockTicketFindUnique = jest.fn();
const mockTicketUpdate = jest.fn();

jest.mock('../prismaClient', () => ({
  ticket: {
    findUnique: (...args) => mockTicketFindUnique(...args),
    update: (...args) => mockTicketUpdate(...args),
  },
}));

jest.mock('./ticketEvent', () => ({ logEvent: jest.fn() }));
jest.mock('./ticketCreator', () => ({
  createTicketFromEmail: jest.fn().mockResolvedValue({ erpTicketId: 2 }),
}));

const { applyIntentActions } = require('./intentAnalyzer');

describe('applyIntentActions — validation humaine obligatoire des clôtures', () => {
  beforeEach(() => {
    mockTicketFindUnique.mockReset();
    mockTicketUpdate.mockReset();
    require('./ticketCreator').createTicketFromEmail.mockClear();
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

  it('suggère la clôture sans synchronisation GLPI (intégration retirée)', async () => {
    mockTicketUpdate.mockImplementation(async (args) => ({ ...args.data, id: 1 }));
    await applyIntentActions(1, { intent: 'RESOLVED', confidence: 0.99 }, 'AI');

    // La suggestion de clôture est bien posée, aucune erreur levée
    const updateCall = mockTicketUpdate.mock.calls[0][0];
    expect(updateCall.data.closeSuggested).toBe(true);
  });

  it('NEW_ISSUE_IN_THREAD sur ticket EN COURS : pose la suggestion sans toucher au statut ni scinder', async () => {
    const { logEvent } = require('./ticketEvent');
    const { createTicketFromEmail } = require('./ticketCreator');
    logEvent.mockClear();

    mockTicketFindUnique.mockResolvedValue({
      id: 1, status: 'OPEN', firstOpenedAt: new Date(), closeSuggestionCount: 0,
    });
    await applyIntentActions(
      1,
      { intent: 'NEW_ISSUE_IN_THREAD', confidence: 0.95, newIssueSummary: 'Nouveau souci' },
      'AI',
      { fromEmail: 'user@ex.com', fromName: 'User', originalBody: 'corps', originalSubject: 'sujet' }
    );

    const updateCall = mockTicketUpdate.mock.calls[0][0];
    // Le ticket d'origine ne bouge pas : ni statut, ni clôture suggérée
    expect(updateCall.data.status).toBeUndefined();
    expect(updateCall.data.closeSuggested).toBeUndefined();
    expect(updateCall.data.newTicketSuggested).toBe(true);
    expect(updateCall.data.newTicketSuggestedSummary).toBe('Nouveau souci');
    expect(updateCall.data.newTicketSuggestedBody).toBe('corps');
    expect(updateCall.data.newTicketSuggestedSender).toBe('user@ex.com');
    expect(createTicketFromEmail).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(1, 'NEW_TICKET_SUGGESTED', 'AI', expect.objectContaining({ newIssueSummary: 'Nouveau souci' }));
  });

  it('NEW_ISSUE_IN_THREAD sur ticket EN COURS : ne re-notifie pas si la suggestion existe déjà', async () => {
    const { logEvent } = require('./ticketEvent');
    logEvent.mockClear();

    mockTicketFindUnique.mockResolvedValue({
      id: 1, status: 'OPEN', newTicketSuggested: true, closeSuggestionCount: 0,
    });
    await applyIntentActions(
      1,
      { intent: 'NEW_ISSUE_IN_THREAD', confidence: 0.9, newIssueSummary: 'Encore un souci' },
      'AI',
      { fromEmail: 'user@ex.com', fromName: 'User', originalBody: 'corps mis à jour', originalSubject: 'sujet' }
    );

    // Le contenu est rafraîchi, mais aucune notification/journalisation supplémentaire
    const updateCall = mockTicketUpdate.mock.calls[0][0];
    expect(updateCall.data.newTicketSuggested).toBe(true);
    expect(updateCall.data.newTicketSuggestedBody).toBe('corps mis à jour');
    expect(logEvent.mock.calls.filter((c) => c[1] === 'NEW_TICKET_SUGGESTED')).toHaveLength(0);
  });

  it('NEW_ISSUE_IN_THREAD sur ticket FERMÉ : garde la suggestion reply-on-closed existante', async () => {
    const { logEvent } = require('./ticketEvent');
    const { createTicketFromEmail } = require('./ticketCreator');
    logEvent.mockClear();

    mockTicketFindUnique.mockResolvedValue({
      id: 1, status: 'CLOSED', closeSuggestionCount: 0,
    });
    await applyIntentActions(
      1,
      { intent: 'NEW_ISSUE_IN_THREAD', confidence: 0.95, newIssueSummary: 'Autre problème' },
      'AI',
      { fromEmail: 'user@ex.com', fromName: 'User', originalBody: 'corps', originalSubject: 'sujet' }
    );

    const updateCall = mockTicketUpdate.mock.calls[0][0];
    expect(updateCall.data.replyOnClosedSuggested).toBe(true);
    expect(updateCall.data.status).toBeUndefined();
    expect(updateCall.data.newTicketSuggested).toBeUndefined();
    expect(createTicketFromEmail).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(1, 'REPLY_ON_CLOSED_SUGGESTED', 'AI', expect.anything());
  });
});