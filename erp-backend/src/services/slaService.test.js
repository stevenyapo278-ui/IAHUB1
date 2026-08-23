jest.mock('../prismaClient', () => ({
  systemSettings: { findUnique: jest.fn() },
  ticket: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
}));
jest.mock('./ticketEvent', () => ({ logEvent: jest.fn() }));
jest.mock('../utils/socket', () => ({ emitSlaBreach: jest.fn() }));
jest.mock('./emailSender', () => ({ sendSlaBreachEmail: jest.fn(() => Promise.resolve()) }));
jest.mock('./escalationService', () => ({ runEscalationMonitor: jest.fn() }));

const prisma = require('../prismaClient');
const { logEvent } = require('./ticketEvent');
const { emitSlaBreach } = require('../utils/socket');
const { sendSlaBreachEmail } = require('./emailSender');
const { runEscalationMonitor } = require('./escalationService');
const {
  applySla, recordFirstResponse, runSlaMonitor, DEFAULT_SLA_HOURS,
  parseSlaHours, computeSlaDeadlines,
} = require('./slaService');

describe('parseSlaHours — fusion config JSON + défauts', () => {
  it('retourne les seuils par défaut si aucune config', () => {
    expect(parseSlaHours(null)).toEqual(DEFAULT_SLA_HOURS);
  });

  it('fusionne partiellement : un champ absent retombe sur le défaut', () => {
    const parsed = parseSlaHours({ P1: { response: 2 } });
    expect(parsed.P1).toEqual({ response: 2, resolution: 4 });
    expect(parsed.P3).toEqual(DEFAULT_SLA_HOURS.P3);
  });

  it('ignore les valeurs invalides (négatives, chaînes)', () => {
    const parsed = parseSlaHours({ P1: { response: -5, resolution: 'abc' } });
    expect(parsed.P1).toEqual(DEFAULT_SLA_HOURS.P1);
  });

  it('autorise la désactivation d’un seuil avec 0', () => {
    const parsed = parseSlaHours({ P4: { response: 0 } });
    expect(parsed.P4).toEqual({ response: 0, resolution: 72 });
  });
});

describe('computeSlaDeadlines — calcul des échéances', () => {
  const createdAt = new Date('2026-08-17T08:00:00Z');

  it('calcule réponse + résolution à partir de la date de création (P1 = 1h/4h)', () => {
    const { slaResponseDueAt, slaResolutionDueAt } = computeSlaDeadlines({ createdAt, priority: 'P1', slaHours: null });
    expect(slaResponseDueAt.toISOString()).toBe('2026-08-17T09:00:00.000Z');
    expect(slaResolutionDueAt.toISOString()).toBe('2026-08-17T12:00:00.000Z');
  });

  it('retombe sur createdAt si absent', () => {
    const { slaResponseDueAt } = computeSlaDeadlines({ createdAt: null, priority: 'P3', slaHours: null });
    expect(slaResponseDueAt.getTime()).toBeGreaterThan(Date.now() - 10000);
  });

  it('retourne null quand le seuil est 0 (SLA désactivé pour cette priorité)', () => {
    const { slaResponseDueAt, slaResolutionDueAt } = computeSlaDeadlines({
      createdAt,
      priority: 'P4',
      slaHours: { P4: { response: 0, resolution: 0 } },
    });
    expect(slaResponseDueAt).toBeNull();
    expect(slaResolutionDueAt).toBeNull();
  });

  it('utilise la config personnalisée (P2 = 30 min de réponse)', () => {
    const { slaResponseDueAt } = computeSlaDeadlines({
      createdAt,
      priority: 'P2',
      slaHours: { P2: { response: 0.5, resolution: 6 } },
    });
    expect(slaResponseDueAt.toISOString()).toBe('2026-08-17T08:30:00.000Z');
  });
});

describe('applySla — persistance des échéances', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calcule et persiste les échéances, et logge SLA_UPDATED quand elles changent', async () => {
    const ticket = {
      id: 5,
      createdAt: new Date('2026-08-17T08:00:00Z'),
      priority: 'P1',
      status: 'NEW',
      slaResponseDueAt: null,
      slaResolutionDueAt: null,
    };
    prisma.systemSettings.findUnique = jest.fn(async () => ({ slaHours: null }));
    prisma.ticket.update = jest.fn(async ({ data }) => ({ ...ticket, ...data }));

    const updated = await applySla(ticket);

    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: {
        slaResponseDueAt: new Date('2026-08-17T09:00:00.000Z'),
        slaResolutionDueAt: new Date('2026-08-17T12:00:00.000Z'),
      },
    });
    expect(logEvent).toHaveBeenCalledWith(5, 'SLA_UPDATED', 'SYSTEM', expect.objectContaining({
      priority: 'P1',
    }));
    expect(updated.slaResponseDueAt.toISOString()).toBe('2026-08-17T09:00:00.000Z');
  });

  it('ne logge aucun événement si les échéances sont identiques', async () => {
    const due = new Date('2026-08-17T09:00:00.000Z');
    const ticket = {
      id: 5, createdAt: new Date('2026-08-17T08:00:00Z'), priority: 'P1', status: 'OPEN',
      slaResponseDueAt: due, slaResolutionDueAt: new Date('2026-08-17T12:00:00.000Z'),
    };
    prisma.systemSettings.findUnique = jest.fn(async () => ({ slaHours: null }));
    prisma.ticket.update = jest.fn(async () => ticket);

    await applySla(ticket);

    expect(logEvent).not.toHaveBeenCalled();
  });

  it('retourne le ticket sans toucher la base pour un statut clôturé', async () => {
    const ticket = { id: 5, status: 'CLOSED', priority: 'P1' };
    prisma.ticket.update = jest.fn();

    const result = await applySla(ticket);

    expect(result).toBe(ticket);
    expect(prisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });
});

describe('recordFirstResponse — temps de première réponse', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fixe firstResponseAt si jamais enregistré', async () => {
    prisma.ticket.findUnique = jest.fn(async () => ({ id: 7, firstResponseAt: null }));
    prisma.ticket.update = jest.fn(async ({ data }) => data);

    await recordFirstResponse(7, 99);

    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { firstResponseAt: expect.any(Date) },
    });
  });

  it('ne réécrit jamais firstResponseAt s\'il existe déjà', async () => {
    const existing = new Date('2026-08-17T09:00:00Z');
    prisma.ticket.findUnique = jest.fn(async () => ({ id: 7, firstResponseAt: existing }));
    prisma.ticket.update = jest.fn();

    const result = await recordFirstResponse(7, 99);

    expect(result.firstResponseAt).toBe(existing);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('retourne sans erreur si le ticket n\'existe pas', async () => {
    prisma.ticket.findUnique = jest.fn(async () => null);

    await expect(recordFirstResponse(999, 1)).resolves.toBeNull();
  });
});

describe('runSlaMonitor — détection des dépassements', () => {
  beforeEach(() => jest.clearAllMocks());

  it('marque, journalise, notifie socket/email pour chaque ticket en retard et compte les escalades', async () => {
    const due = new Date(Date.now() - 30 * 60000);
    prisma.systemSettings.findUnique = jest.fn(async () => ({ slaHours: null }));
    prisma.ticket.findMany = jest.fn(async () => [
      {
        id: 1, title: 'A', priority: 'P1', slaResponseDueAt: due,
        assignedTo: { email: 'tech@prosuma.ci', fullName: 'Tech' },
      },
      {
        id: 2, title: 'B', priority: 'P2', slaResponseDueAt: due,
        assignedTo: null,
      },
    ]);
    prisma.ticket.update = jest.fn(async () => ({}));
    runEscalationMonitor.mockResolvedValue({ escalatedCount: 1 });

    const result = await runSlaMonitor();

    expect(prisma.ticket.update).toHaveBeenCalledTimes(2);
    expect(logEvent).toHaveBeenCalledTimes(2);
    expect(logEvent.mock.calls[0][1]).toBe('SLA_BREACHED');
    expect(logEvent.mock.calls[0][2]).toBe('SYSTEM');
    expect(emitSlaBreach).toHaveBeenCalledTimes(2);
    expect(sendSlaBreachEmail).toHaveBeenCalledTimes(1);
    expect(runEscalationMonitor).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ breachedCount: 2, escalatedCount: 1 });
  });

  it('n\'escalade les tickets déjà marqués en dépassement (slaBreachedAt non nul)', async () => {
    prisma.systemSettings.findUnique = jest.fn(async () => ({ slaHours: null }));
    prisma.ticket.findMany = jest.fn(async () => []);
    runEscalationMonitor.mockResolvedValue({ escalatedCount: 0 });

    const result = await runSlaMonitor();

    expect(prisma.ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { in: ['NEW', 'OPEN', 'PLANNED', 'PENDING'] }, slaResponseDueAt: { not: null, lt: expect.any(Date) }, slaBreachedAt: null },
    }));
    expect(result.breachedCount).toBe(0);
    expect(DEFAULT_SLA_HOURS.P1).toEqual({ response: 1, resolution: 4 });
  });
});