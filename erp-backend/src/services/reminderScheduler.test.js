const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();
const mockDraftFindFirst = jest.fn();
const mockDraftCreate = jest.fn();
const mockTicketUpdate = jest.fn();
const mockGetIO = jest.fn();
const mockEmit = jest.fn();

jest.mock('../prismaClient', () => ({
  reminderConfig: { findFirst: (...args) => mockFindFirst(...args) },
  ticket: { findMany: (...args) => mockFindMany(...args), update: (...args) => mockTicketUpdate(...args) },
  aiEmailDraft: {
    findFirst: (...args) => mockDraftFindFirst(...args),
    create: (...args) => mockDraftCreate(...args),
  },
}));
jest.mock('../utils/socket', () => ({ getIO: (...args) => mockGetIO(...args) }));
jest.mock('./emailSender', () => ({ sendReminder: jest.fn() }));
jest.mock('./ticketEvent', () => ({ logEvent: jest.fn() }));
jest.mock('./approvalReminderScheduler', () => ({ processApprovalReminders: jest.fn().mockResolvedValue(undefined) }));

const { runReminderScheduler } = require('./reminderScheduler');

// Ticket WAITING_FOR_USER créé par email, sans réponse depuis 6 jours
function makeTicket(overrides = {}) {
  return {
    id: 101,
    title: 'Imprimante hors service',
    status: 'WAITING_FOR_USER',
    sourceEmail: 'client@prosuma.ci',
    sourceName: 'Client Test',
    lastUserReplyAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(),
    reminderCount: 0,
    closeSuggested: false,
    messages: [],
    ...overrides,
  };
}

describe('runReminderScheduler — respect du réglage isActive', () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockFindMany.mockReset();
  });

  it("ne traite aucun ticket si une config existe et a été explicitement désactivée (isActive=false)", async () => {
    mockFindFirst.mockResolvedValue({ isActive: false, firstReminderDays: 2, secondReminderDays: 5, preCloseDays: 10, autoCloseDays: 15 });
    const results = await runReminderScheduler();
    expect(results).toEqual([]);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("utilise les délais par défaut si aucune configuration n'existe encore en base", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([]);
    await runReminderScheduler();
    expect(mockFindMany).toHaveBeenCalled();
  });

  it('traite les tickets si la config existe et est active', async () => {
    mockFindFirst.mockResolvedValue({ isActive: true, firstReminderDays: 2, secondReminderDays: 5, preCloseDays: 10, autoCloseDays: 15 });
    mockFindMany.mockResolvedValue([]);
    await runReminderScheduler();
    expect(mockFindMany).toHaveBeenCalled();
  });
});

describe('runReminderScheduler — création des brouillons de relance (Centre de Validation)', () => {
  const activeConfig = { isActive: true, firstReminderDays: 2, secondReminderDays: 5, preCloseDays: 10, autoCloseDays: 15 };

  beforeEach(() => {
    mockFindFirst.mockReset();
    mockFindMany.mockReset();
    mockDraftFindFirst.mockReset();
    mockDraftCreate.mockReset();
    mockTicketUpdate.mockReset();
    mockDraftFindFirst.mockResolvedValue(null); // aucun brouillon de relance en attente
  });

  it('crée un brouillon REMINDER (1ère relance) pour un ticket sans réponse depuis J+2', async () => {
    mockFindFirst.mockResolvedValue(activeConfig);
    mockFindMany.mockResolvedValue([makeTicket({ lastUserReplyAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) })]);
    const results = await runReminderScheduler();
    expect(mockDraftCreate).toHaveBeenCalledTimes(1);
    expect(mockDraftCreate.mock.calls[0][0].data.draftKind).toBe('REMINDER');
    expect(mockDraftCreate.mock.calls[0][0].data.recipientEmail).toBe('client@prosuma.ci');
    expect(results).toEqual([{ ticketId: 101, action: 'REMINDER_1' }]);
    expect(mockTicketUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 101 }, data: expect.objectContaining({ reminderCount: 1 }) }));
  });

  it('crée un brouillon pré-clôture au-delà du délai preCloseDays', async () => {
    mockFindFirst.mockResolvedValue(activeConfig);
    mockFindMany.mockResolvedValue([makeTicket({ lastUserReplyAt: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000) })]);
    const results = await runReminderScheduler();
    expect(mockDraftCreate).toHaveBeenCalledTimes(1);
    expect(mockDraftCreate.mock.calls[0][0].data.proposedContent).toContain('automatiquement clôturé');
    expect(results).toEqual([{ ticketId: 101, action: 'REMINDER_PRE_CLOSE' }]);
  });

  it('clôture automatiquement au-delà de autoCloseDays sans créer de brouillon', async () => {
    mockFindFirst.mockResolvedValue(activeConfig);
    mockFindMany.mockResolvedValue([makeTicket({ lastUserReplyAt: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000) })]);
    const results = await runReminderScheduler();
    expect(mockDraftCreate).not.toHaveBeenCalled();
    expect(results).toEqual([{ ticketId: 101, action: 'AUTO_CLOSED' }]);
  });

  it('ne crée PAS de doublon si un brouillon de relance est déjà en attente', async () => {
    mockFindFirst.mockResolvedValue(activeConfig);
    // Ticket à J+3 → franchit le seuil firstReminderDays=2 → action REMINDER_1, mais le
    // brouillon existe déjà en attente : on doit pousser le compteur SANS recréer un doublon.
    mockFindMany.mockResolvedValue([makeTicket({ lastUserReplyAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) })]);
    mockDraftFindFirst.mockResolvedValue({ id: 55, draftKind: 'REMINDER', status: 'PENDING' });
    const results = await runReminderScheduler();
    expect(mockDraftCreate).not.toHaveBeenCalled();
    expect(results).toEqual([{ ticketId: 101, action: 'REMINDER_1' }]);
  });

  it('ne relance plus au-delà de reminderCount=3 (brouillons empilés interdits)', async () => {
    mockFindFirst.mockResolvedValue(activeConfig);
    mockFindMany.mockResolvedValue([makeTicket({ lastUserReplyAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000), reminderCount: 3 })]);
    const results = await runReminderScheduler();
    expect(mockDraftCreate).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('ignore un ticket ayant reçu un message il y a moins de 24h (garde anti-relance prématurée)', async () => {
    mockFindFirst.mockResolvedValue(activeConfig);
    mockFindMany.mockResolvedValue([makeTicket({ messages: [{ timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000) }] })]);
    const results = await runReminderScheduler();
    expect(mockDraftCreate).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });
});

describe('runReminderScheduler — notification temps réel du Centre de Validation', () => {
  const activeConfig = { isActive: true, firstReminderDays: 2, secondReminderDays: 5, preCloseDays: 10, autoCloseDays: 15 };

  beforeEach(() => {
    mockFindFirst.mockReset();
    mockFindMany.mockReset();
    mockDraftFindFirst.mockReset().mockResolvedValue(null);
    mockDraftCreate.mockReset();
    mockTicketUpdate.mockReset();
    mockGetIO.mockReset();
    mockEmit.mockReset();
    mockFindFirst.mockResolvedValue(activeConfig);
  });

  it('émet ai_draft_created avec draftKind REMINDER quand le brouillon est créé', async () => {
    mockGetIO.mockReturnValue({ emit: mockEmit });
    mockDraftCreate.mockResolvedValue({
      id: 900, ticketId: 101, subject: '[Ticket #101] Imprimante hors service',
      draftKind: 'REMINDER', createdAt: new Date('2026-10-01T10:00:00Z'),
    });
    mockFindMany.mockResolvedValue([makeTicket({ lastUserReplyAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) })]);

    await runReminderScheduler();

    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith('ai_draft_created', expect.objectContaining({
      draftId: 900,
      ticketId: 101,
      draftKind: 'REMINDER',
      subject: '[Ticket #101] Imprimante hors service',
    }));
  });

  it("n'émet rien quand un brouillon de relance est déjà en attente (pas de doublon)", async () => {
    mockGetIO.mockReturnValue({ emit: mockEmit });
    mockDraftFindFirst.mockResolvedValue({ id: 55, draftKind: 'REMINDER', status: 'PENDING' });
    mockFindMany.mockResolvedValue([makeTicket({ lastUserReplyAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) })]);

    await runReminderScheduler();

    expect(mockDraftCreate).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('fait échouer la génération de relance si getIO() lance une erreur (best-effort)', async () => {
    mockGetIO.mockImplementation(() => { throw new Error('socket indisponible'); });
    mockDraftCreate.mockResolvedValue({ id: 901, ticketId: 101, subject: 'x', draftKind: 'REMINDER' });
    mockFindMany.mockResolvedValue([makeTicket({ lastUserReplyAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) })]);

    const results = await runReminderScheduler();

    expect(results).toEqual([{ ticketId: 101, action: 'REMINDER_1' }]);
  });
});
