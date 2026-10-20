const mockSettings = jest.fn();
const mockTicketFindMany = jest.fn();
const mockEventFindMany = jest.fn();
const mockSendEmail = jest.fn();
const mockLogEvent = jest.fn();

jest.mock('../prismaClient', () => ({
  ticket: { findMany: (...args) => mockTicketFindMany(...args) },
  ticketEvent: { findMany: (...args) => mockEventFindMany(...args) },
}));
jest.mock('./systemSettings', () => ({ getSystemSettings: (...args) => mockSettings(...args) }));
jest.mock('./emailSender', () => ({ sendTechnicianReminderDigestEmail: (...args) => mockSendEmail(...args) }));
jest.mock('./ticketEvent', () => ({ logEvent: (...args) => mockLogEvent(...args) }));

const { runTechnicianReminderScheduler } = require('./technicianReminderScheduler');

const HOUR_MS = 60 * 60 * 1000;

function makeSettings(overrides = {}) {
  return {
    techReminderEnabled: true,
    techReminderDelayHours: 24,
    techReminderRepeatHours: 0,
    techReminderOnNoActivity: true,
    techReminderOnUnassigned: true,
    ...overrides,
  };
}

// Ticket ouvert assigné, sans activité depuis `idleHours`
function makeTicket(overrides = {}) {
  const idleHours = 'idleHours' in overrides ? overrides.idleHours : 30;
  const idleSince = new Date(Date.now() - idleHours * HOUR_MS);
  return {
    id: 101,
    title: 'Imprimante bloquée',
    status: 'OPEN',
    priority: 'P2',
    category: 'Matériel',
    requesterId: 7,
    assignedToId: 5,
    createdAt: idleSince,
    assignedTo: { id: 5, email: 'technicien@prosuma.ci', fullName: 'Koffi Tech' },
    team: {
      id: 3,
      name: 'Support N2',
      groupEmail: 'support-n2@prosuma.ci',
      members: [
        { id: 5, email: 'technicien@prosuma.ci', fullName: 'Koffi Tech' },
        { id: 6, email: 'aya@prosuma.ci', fullName: 'Aya Tech' },
      ],
    },
    messages: [],
    followups: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings.mockResolvedValue(makeSettings());
  mockTicketFindMany.mockResolvedValue([]);
  mockEventFindMany.mockResolvedValue([]);
  mockSendEmail.mockResolvedValue({ messageId: 'x' });
  mockLogEvent.mockResolvedValue(undefined);
});

describe('runTechnicianReminderScheduler', () => {
  it('ne fait rien quand le réglage est désactivé (défaut)', async () => {
    mockSettings.mockResolvedValue(makeSettings({ techReminderEnabled: false }));

    await expect(runTechnicianReminderScheduler()).resolves.toEqual([]);
    expect(mockTicketFindMany).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('n interroge aucun ticket si les deux critères sont désactivés', async () => {
    mockSettings.mockResolvedValue(makeSettings({ techReminderOnNoActivity: false, techReminderOnUnassigned: false }));

    await expect(runTechnicianReminderScheduler()).resolves.toEqual([]);
    expect(mockTicketFindMany).not.toHaveBeenCalled();
  });

  it('ticket assigné sans activité depuis 24h : UN digest au technicien + tracé REMINDER_SENT', async () => {
    mockTicketFindMany.mockResolvedValue([makeTicket({ idleHours: 25 })]);

    const results = await runTechnicianReminderScheduler();

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'technicien@prosuma.ci',
      recipientName: 'Koffi Tech',
      delayHours: 24,
      tickets: [expect.objectContaining({
        ticketId: 101,
        ticketTitle: 'Imprimante bloquée',
        priority: 'P2',
        hoursWaiting: expect.any(Number),
        criteriaLabels: ['assigné sans activité'],
      })],
    }));
    expect(mockSendEmail.mock.calls[0][0].tickets[0].hoursWaiting).toBeGreaterThanOrEqual(24);
    expect(mockLogEvent).toHaveBeenCalledWith(101, 'REMINDER_SENT', 'SYSTEM', expect.objectContaining({
      kind: 'TECHNICIAN',
      criteria: 'NO_ACTIVITY',
      recipients: ['technicien@prosuma.ci'],
    }));
    expect(results).toEqual([{ action: 'TECH_DIGEST_SENT', to: 'technicien@prosuma.ci', tickets: 1 }]);
  });

  it('DIGEST : deux tickets du même technicien → UN seul email avec un tableau de 2 lignes', async () => {
    mockTicketFindMany.mockResolvedValue([
      makeTicket({ id: 101, idleHours: 30 }),
      makeTicket({ id: 102, title: 'Écran HS', idleHours: 40 }),
    ]);

    const results = await runTechnicianReminderScheduler();

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const arg = mockSendEmail.mock.calls[0][0];
    expect(arg.to).toBe('technicien@prosuma.ci');
    expect(arg.tickets).toHaveLength(2);
    expect(arg.tickets.map((t) => t.ticketId).sort()).toEqual([101, 102]);
    expect(mockLogEvent).toHaveBeenCalledTimes(2); // tracé par ticket (anti-doublon)
    expect(results).toEqual([{ action: 'TECH_DIGEST_SENT', to: 'technicien@prosuma.ci', tickets: 2 }]);
  });

  it('DIGEST : tickets de deux techniciens → deux emails distincts (un par destinataire)', async () => {
    mockTicketFindMany.mockResolvedValue([
      makeTicket({ id: 101, assignedToId: 5, assignedTo: { id: 5, email: 'technicien@prosuma.ci', fullName: 'Koffi Tech' } }),
      makeTicket({ id: 102, assignedToId: 6, assignedTo: { id: 6, email: 'aya@prosuma.ci', fullName: 'Aya Tech' } }),
    ]);

    const results = await runTechnicianReminderScheduler();

    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    const recipients = mockSendEmail.mock.calls.map(([args]) => args.to).sort();
    expect(recipients).toEqual(['aya@prosuma.ci', 'technicien@prosuma.ci']);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.action === 'TECH_DIGEST_SENT')).toBe(true);
  });

  it('passe en revue uniquement les tickets ouverts (hors Résolu/Fermé)', async () => {
    mockTicketFindMany.mockResolvedValue([makeTicket({ idleHours: 25 })]);
    await runTechnicianReminderScheduler();

    expect(mockTicketFindMany.mock.calls[0][0].where.status.in).toEqual(['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER']);
  });

  it('ne sélectionne que des champs réellement présents sur User (fullName, pas name)', async () => {
    // Garde-fou contre une erreur que Prisma ne peut pas signaler ici (client moqué) :
    // un select sur un champ inexistant (`name`) fait échouer la requête en conditions
    // réelles — c'est arrivé et a été attrapé par le test e2e.
    mockTicketFindMany.mockResolvedValue([]);
    await runTechnicianReminderScheduler();

    const include = mockTicketFindMany.mock.calls[0][0].include;
    expect(include.assignedTo.select).toEqual({ id: true, email: true, fullName: true });
    expect(include.team.select.members.select).toEqual({ id: true, email: true, fullName: true });
  });

  it('activité technicien récente (suivi) : aucun rappel', async () => {
    mockTicketFindMany.mockResolvedValue([makeTicket({
      idleHours: 30,
      followups: [{ createdAt: new Date(Date.now() - 1 * HOUR_MS), authorId: 5 }],
    })]);

    await expect(runTechnicianReminderScheduler()).resolves.toEqual([]);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('réponse sortante récente : aucun rappel', async () => {
    mockTicketFindMany.mockResolvedValue([makeTicket({
      idleHours: 30,
      messages: [{ timestamp: new Date(Date.now() - 2 * HOUR_MS) }],
    })]);

    await expect(runTechnicianReminderScheduler()).resolves.toEqual([]);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('un suivi du DEMANDEUR ne réinitialise pas le compteur (le rappel reste dû)', async () => {
    mockTicketFindMany.mockResolvedValue([makeTicket({
      idleHours: 30,
      followups: [{ createdAt: new Date(Date.now() - 1 * HOUR_MS), authorId: 7 }], // authorId = requesterId
    })]);

    const results = await runTechnicianReminderScheduler();

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(results[0].action).toBe('TECH_DIGEST_SENT');
  });

  it('ticket non assigné : UN digest par membre de l équipe + email de groupe, critère UNASSIGNED', async () => {
    mockTicketFindMany.mockResolvedValue([makeTicket({ idleHours: 30, assignedToId: null, assignedTo: null })]);

    const results = await runTechnicianReminderScheduler();

    // 3 destinataires (2 membres + groupEmail), chacun reçoit son digest avec le même ticket.
    const recipients = mockSendEmail.mock.calls.map(([args]) => args.to);
    expect(recipients.sort()).toEqual(['aya@prosuma.ci', 'support-n2@prosuma.ci', 'technicien@prosuma.ci']);
    for (const [args] of mockSendEmail.mock.calls) {
      expect(args.tickets).toHaveLength(1);
      expect(args.tickets[0].ticketId).toBe(101);
    }
    expect(mockLogEvent).toHaveBeenCalledWith(101, 'REMINDER_SENT', 'SYSTEM', expect.objectContaining({ criteria: 'UNASSIGNED' }));
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.action === 'TECH_DIGEST_SENT' && r.tickets === 1)).toBe(true);
  });

  it('ticket non assigné sans équipe ni destinataire : rien ne part', async () => {
    mockTicketFindMany.mockResolvedValue([makeTicket({ idleHours: 30, assignedToId: null, assignedTo: null, team: null })]);

    await expect(runTechnicianReminderScheduler()).resolves.toEqual([]);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('anti-doublon : un rappel déjà envoyé (repeatHours=0) ne repart pas', async () => {
    mockTicketFindMany.mockResolvedValue([makeTicket({ idleHours: 30 })]);
    mockEventFindMany.mockResolvedValue([{
      ticketId: 101,
      createdAt: new Date(Date.now() - 1 * HOUR_MS),
      payload: { kind: 'TECHNICIAN' },
    }]);

    await expect(runTechnicianReminderScheduler()).resolves.toEqual([]);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('relance demandeur ignorée : un REMINDER_SENT de type demandeur ne bloque pas le rappel technicien', async () => {
    mockTicketFindMany.mockResolvedValue([makeTicket({ idleHours: 30 })]);
    mockEventFindMany.mockResolvedValue([{
      ticketId: 101,
      createdAt: new Date(Date.now() - 1 * HOUR_MS),
      payload: { kind: 'REQUESTER' },
    }]);

    const results = await runTechnicianReminderScheduler();
    expect(results[0].action).toBe('TECH_DIGEST_SENT');
  });

  it('rappel répété : renvoi après X h, mais pas avant', async () => {
    mockSettings.mockResolvedValue(makeSettings({ techReminderRepeatHours: 12 }));
    mockTicketFindMany.mockResolvedValue([makeTicket({ idleHours: 48 })]);
    // Dernier rappel il y a 4 h → trop tôt
    mockEventFindMany.mockResolvedValue([{ ticketId: 101, createdAt: new Date(Date.now() - 4 * HOUR_MS), payload: { kind: 'TECHNICIAN' } }]);
    await expect(runTechnicianReminderScheduler()).resolves.toEqual([]);
    expect(mockSendEmail).not.toHaveBeenCalled();

    // Dernier rappel il y a 24 h → délai de 12 h dépassé, on renvoie
    mockEventFindMany.mockResolvedValue([{ ticketId: 101, createdAt: new Date(Date.now() - 24 * HOUR_MS), payload: { kind: 'TECHNICIAN' } }]);
    const results = await runTechnicianReminderScheduler();
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(results[0].action).toBe('TECH_DIGEST_SENT');
  });

  it('un ticket trop récent (moins de 24h) ne déclenche rien', async () => {
    mockTicketFindMany.mockResolvedValue([makeTicket({ idleHours: 3 })]);

    await expect(runTechnicianReminderScheduler()).resolves.toEqual([]);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('un échec d envoi sur un destinataire ne bloque pas les suivants', async () => {
    mockTicketFindMany.mockResolvedValue([
      makeTicket({ id: 1, assignedToId: 5, assignedTo: { id: 5, email: 'koffi@prosuma.ci', fullName: 'Koffi Tech' } }),
      makeTicket({ id: 2, assignedToId: 6, assignedTo: { id: 6, email: 'aya@prosuma.ci', fullName: 'Aya Tech' } }),
    ]);
    mockSendEmail.mockRejectedValueOnce(new Error('SMTP en erreur'));

    const results = await runTechnicianReminderScheduler();

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ action: 'ERROR', to: 'koffi@prosuma.ci', error: 'SMTP en erreur' });
    expect(results[1]).toMatchObject({ action: 'TECH_DIGEST_SENT', to: 'aya@prosuma.ci', tickets: 1 });
    // Seul le digest livré est tracé (ticket 2 uniquement).
    expect(mockLogEvent).toHaveBeenCalledTimes(1);
    expect(mockLogEvent).toHaveBeenCalledWith(2, 'REMINDER_SENT', 'SYSTEM', expect.objectContaining({
      recipients: ['aya@prosuma.ci'],
    }));
  });

  it('un ticket dont TOUS les destinataires échouent n est pas tracé (pas d anti-doublon à tort)', async () => {
    mockTicketFindMany.mockResolvedValue([makeTicket({ idleHours: 30, assignedToId: null, assignedTo: null })]);
    mockSendEmail.mockRejectedValue(new Error('SMTP en erreur'));

    const results = await runTechnicianReminderScheduler();

    expect(results.every((r) => r.action === 'ERROR')).toBe(true);
    expect(mockLogEvent).not.toHaveBeenCalled(); // rien de livré → pas de REMINDER_SENT
  });
});
