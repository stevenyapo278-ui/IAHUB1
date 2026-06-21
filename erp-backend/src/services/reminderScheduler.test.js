const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();

jest.mock('../prismaClient', () => ({
  reminderConfig: { findFirst: (...args) => mockFindFirst(...args) },
  ticket: { findMany: (...args) => mockFindMany(...args), update: jest.fn() },
}));
jest.mock('./emailSender', () => ({ sendReminder: jest.fn() }));
jest.mock('./ticketEvent', () => ({ logEvent: jest.fn() }));
jest.mock('./glpiTicketCreator', () => ({ updateGlpiTicket: jest.fn() }));

const { runReminderScheduler } = require('./reminderScheduler');

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
