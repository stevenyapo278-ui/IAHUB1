jest.mock('../prismaClient', () => ({
  ticket: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  user: { findMany: jest.fn() },
}));
jest.mock('./ticketEvent', () => ({ logEvent: jest.fn() }));
jest.mock('../utils/socket', () => ({ emitTicketEscalated: jest.fn() }));
jest.mock('./emailSender', () => ({ sendEscalationEmail: jest.fn(() => Promise.resolve()) }));

const prisma = require('../prismaClient');
const { logEvent } = require('./ticketEvent');
const { emitTicketEscalated } = require('../utils/socket');
const { sendEscalationEmail } = require('./emailSender');
const { scheduleEscalation, escalateTicket, runEscalationMonitor } = require('./escalationService');

function mockTicket(overrides = {}) {
  prisma.ticket.findUnique = jest.fn(async () => overrides);
  prisma.ticket.update = jest.fn(async ({ data }) => ({ ...(overrides || {}), ...data }));
  prisma.user.findMany = jest.fn(async () => []);
}

describe('scheduleEscalation — planification d\'une escalade', () => {
  it('calcule escalateAt = maintenant + minutes et stocke la règle de triage', async () => {
    const before = Date.now();
    prisma.ticket.update = jest.fn(async ({ data }) => data);

    await scheduleEscalation(42, 30, 7);

    expect(prisma.ticket.update).toHaveBeenCalled();
    const { where, data } = prisma.ticket.update.mock.calls[0][0];
    expect(where.id).toBe(42);
    expect(data.triageRuleId).toBe(7);
    expect(data.escalateAt.getTime()).toBeGreaterThanOrEqual(before + 30 * 60000);
    expect(data.escalateAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * 60000 + 1000);
  });

  it('retourne null sans toucher la base si minutes invalides ou négatives', async () => {
    prisma.ticket.update = jest.fn();
    expect(await scheduleEscalation(42, 0)).toBeNull();
    expect(await scheduleEscalation(42, -5)).toBeNull();
    expect(await scheduleEscalation(42, null)).toBeNull();
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });
});

describe('escalateTicket — escalade réelle', () => {
  const ticket = {
    id: 10,
    title: 'Impression KO',
    priority: 'P1',
    escalationLevel: 1,
    assignedTo: { id: 5, email: 'tech@prosuma.ci', fullName: 'Tech' },
    requester: { id: 6, email: 'req@prosuma.ci', fullName: 'Req' },
    team: { id: 3, name: 'Support' },
  };

  beforeEach(() => jest.clearAllMocks());

  it('incrémente le niveau, trace l\'événement, notifie socket et alerte les admins', async () => {
    mockTicket(ticket);
    prisma.user.findMany = jest.fn(async () => [
      { email: 'admin1@prosuma.ci', fullName: 'Admin 1' },
      { email: 'admin2@prosuma.ci', fullName: 'Admin 2' },
    ]);

    const updated = await escalateTicket(10, { reason: 'Panne totale', actor: 'jdoe@prosuma.ci', source: 'manual' });

    expect(updated.escalationLevel).toBe(2);
    expect(updated.escalatedAt).toBeInstanceOf(Date);
    expect(updated.escalateAt).toBeNull();
    expect(prisma.ticket.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 10 },
      data: { escalationLevel: 2, escalatedAt: expect.any(Date), escalateAt: null },
    }));
    expect(logEvent).toHaveBeenCalledWith(10, 'ESCALATED', 'jdoe@prosuma.ci', {
      source: 'manual', reason: 'Panne totale', escalationLevel: 2,
    });
    expect(emitTicketEscalated).toHaveBeenCalledWith(expect.objectContaining({ id: 10 }), {
      reason: 'Panne totale', escalationLevel: 2,
    });
    expect(sendEscalationEmail).toHaveBeenCalledTimes(2);
    expect(sendEscalationEmail.mock.calls[0][0].recipientEmail).toBe('admin1@prosuma.ci');
  });

  it('gère le niveau 0 (première escalade) et un ticket sans assigné', async () => {
    mockTicket({ ...ticket, escalationLevel: 0, assignedTo: null });

    const updated = await escalateTicket(10, {});

    expect(updated.escalationLevel).toBe(1);
    expect(sendEscalationEmail).not.toHaveBeenCalled();
  });

  it('lève une erreur si le ticket n\'existe pas', async () => {
    mockTicket(null);

    await expect(escalateTicket(999)).rejects.toThrow('Ticket introuvable');
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });
});

describe('runEscalationMonitor — déclenchement automatique des escalades à échéance', () => {
  it('escalade uniquement les tickets actifs dont escalateAt est dépassé', async () => {
    prisma.ticket.findMany = jest.fn(async () => [
      { id: 1, title: 'A', priority: 'P1' },
      { id: 2, title: 'B', priority: 'P2' },
    ]);
    mockTicket({ id: 1, title: 'A', priority: 'P1', escalationLevel: 0 });

    const { escalatedCount } = await runEscalationMonitor();

    expect(escalatedCount).toBe(2);
    expect(logEvent).toHaveBeenCalledTimes(2);
    expect(logEvent.mock.calls.every(([, type]) => type === 'ESCALATED')).toBe(true);
  });

  it('ne casse pas le moniteur si une escalade échoue (best-effort)', async () => {
    prisma.ticket.findMany = jest.fn(async () => [
      { id: 1, title: 'A', priority: 'P1' },
      { id: 2, title: 'B', priority: 'P2' },
    ]);
    mockTicket(null); // ticket introuvable → escalade échoue

    const { escalatedCount } = await runEscalationMonitor();

    expect(escalatedCount).toBe(0);
  });
});