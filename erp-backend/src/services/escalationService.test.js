jest.mock('../prismaClient', () => ({
  ticket: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  user: { findMany: jest.fn(), findFirst: jest.fn() },
  team: { findUnique: jest.fn() },
}));
jest.mock('./ticketEvent', () => ({ logEvent: jest.fn() }));
jest.mock('../utils/socket', () => ({ emitTicketEscalated: jest.fn(), emitTicketAssigned: jest.fn() }));
jest.mock('./emailSender', () => ({
  sendEscalationEmail: jest.fn(() => Promise.resolve()),
  sendRequesterEscalationEmail: jest.fn(() => Promise.resolve()),
}));

const prisma = require('../prismaClient');
const { logEvent } = require('./ticketEvent');
const { emitTicketEscalated } = require('../utils/socket');
const { sendEscalationEmail, sendRequesterEscalationEmail } = require('./emailSender');
const { scheduleEscalation, escalateTicket, runEscalationMonitor } = require('./escalationService');

function mockTicket(overrides = {}) {
  prisma.ticket.findUnique = jest.fn(async () => overrides);
  prisma.ticket.update = jest.fn(async ({ data }) => ({ ...(overrides || {}), ...data }));
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

describe('escalateTicket — escalade = transfert à une équipe responsable', () => {
  const ticket = {
    id: 10,
    title: 'Impression KO',
    priority: 'P1',
    status: 'OPEN',
    escalationLevel: 1,
    assignedTo: { id: 5, email: 'tech@prosuma.ci', fullName: 'Tech' },
    requester: { id: 6, email: 'req@prosuma.ci', fullName: 'Req' },
    team: { id: 3, name: 'Support' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findMany = jest.fn(async () => []);
    prisma.user.findFirst = jest.fn(async () => null);
    prisma.team.findUnique = jest.fn(async () => null);
  });

  it('sans équipe cible : alerte l\'équipe courante + admins, ne touche ni teamId ni assignedToId', async () => {
    mockTicket(ticket);
    // 1er appel = membres de l'équipe cible (ici l'équipe courante), 2e = admins
    prisma.user.findMany = jest.fn()
      .mockResolvedValueOnce([{ email: 'mate@prosuma.ci', fullName: 'Mate' }])
      .mockResolvedValueOnce([{ email: 'admin1@prosuma.ci', fullName: 'Admin 1' }]);

    const updated = await escalateTicket(10, { reason: 'Panne totale', actor: 'jdoe@prosuma.ci', source: 'manual' });

    // Pas de changement d'équipe ni de technicien
    expect(prisma.team.findUnique).not.toHaveBeenCalled();
    expect(updated.teamId).toBeUndefined();
    expect(updated.assignedToId).toBeUndefined();
    // Le compteur suit les relances successives (traçabilité), sans notion de « niveau »
    expect(updated.escalationLevel).toBe(2);
    expect(updated.escalateAt).toBeNull();
    expect(logEvent).toHaveBeenCalledWith(10, 'ESCALATED', 'jdoe@prosuma.ci', expect.objectContaining({
      source: 'manual',
      reason: 'Panne totale',
      fromTeam: { id: 3, name: 'Support' },
      toTeam: null,
    }));
    // Membre de l'équipe + admin alertés ; le demandeur reçoit le template dédié
    const recipients = sendEscalationEmail.mock.calls.map((c) => c[0].recipientEmail);
    expect(recipients).toEqual(expect.arrayContaining(['mate@prosuma.ci', 'admin1@prosuma.ci']));
    expect(sendRequesterEscalationEmail).toHaveBeenCalledTimes(1);
    expect(sendRequesterEscalationEmail.mock.calls[0][0].recipientEmail).toBe('req@prosuma.ci');
  });

  it('avec équipe cible : transfère teamId, alerte l\'équipe cible (groupe + membres) et l\'ancien technicien', async () => {
    mockTicket(ticket);
    prisma.team.findUnique = jest.fn(async () => ({ id: 9, name: 'Sécurité', groupEmail: 'securite@prosuma.ci' }));
    // 1er appel = membres équipe cible, 2e = admins
    prisma.user.findMany = jest.fn()
      .mockResolvedValueOnce([{ email: 'sec1@prosuma.ci', fullName: 'Sec 1' }])
      .mockResolvedValueOnce([{ email: 'admin1@prosuma.ci', fullName: 'Admin 1' }]);

    const updated = await escalateTicket(10, { reason: 'Ouverture de port validée — à exécuter', targetTeamId: 9 });

    expect(updated.teamId).toBe(9);
    expect(logEvent).toHaveBeenCalledWith(10, 'ESCALATED', 'SYSTEM', expect.objectContaining({
      fromTeam: { id: 3, name: 'Support' },
      toTeam: { id: 9, name: 'Sécurité' },
    }));
    const recipients = sendEscalationEmail.mock.calls.map((c) => c[0].recipientEmail.toLowerCase());
    // Adresse de groupe + membre de l'équipe cible + admin + technicien sortant (il perd la main)
    expect(recipients).toEqual(expect.arrayContaining(['securite@prosuma.ci', 'sec1@prosuma.ci', 'admin1@prosuma.ci', 'tech@prosuma.ci']));
    // Le mail de l'équipe cible mentionne le transfert
    const groupMail = sendEscalationEmail.mock.calls.find((c) => c[0].recipientEmail === 'securite@prosuma.ci');
    expect(groupMail[0].targetTeamName).toBe('Sécurité');
  });

  it('avec technicien cible : l\'assigne et synchronise la liste many-to-many assignees', async () => {
    mockTicket(ticket);
    prisma.team.findUnique = jest.fn(async () => ({ id: 9, name: 'Sécurité', groupEmail: null }));
    prisma.user.findFirst = jest.fn(async () => ({ id: 55, email: 'tech9@prosuma.ci', fullName: 'Tech 9', teamId: 9 }));

    const updated = await escalateTicket(10, { targetTeamId: 9, assignedToId: 55 });

    expect(updated.teamId).toBe(9);
    expect(updated.assignedToId).toBe(55);
    // L'interface « Attribué à » affiche assignees en priorité — sans cette synchro,
    // l'ancien technicien restait affiché malgré le changement d'assignedToId.
    expect(updated.assignees).toEqual({ set: [{ id: 55 }] });
    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 55, role: 'TECHNICIAN', isActive: true }),
    }));
  });

  it('désassigne (assignedToId + assignees vidés) lors d\'un transfert d\'équipe sans technicien explicite', async () => {
    mockTicket({ ...ticket, assignedTo: { id: 5, email: 'tech@prosuma.ci', fullName: 'Tech' } });
    prisma.team.findUnique = jest.fn(async () => ({ id: 9, name: 'Sécurité', groupEmail: null }));

    const updated = await escalateTicket(10, { targetTeamId: 9 });

    expect(updated.teamId).toBe(9);
    expect(updated.assignedToId).toBeNull();
    expect(updated.assignees).toEqual({ set: [] });
  });

  it('attache les observateurs par défaut de l\'équipe cible lors du transfert d\'équipe', async () => {
    mockTicket(ticket);
    prisma.team.findUnique = jest.fn(async () => ({
      id: 9, name: 'Sécurité', groupEmail: null,
      defaultObservers: [{ id: 71 }, { id: 72 }],
    }));

    const updated = await escalateTicket(10, { targetTeamId: 9 });

    expect(updated.teamId).toBe(9);
    expect(updated.observers).toEqual({ set: [{ id: 71 }, { id: 72 }] });
  });

  it('ne touche pas aux observateurs quand l\'équipe cible n\'a pas d\'observateurs par défaut', async () => {
    mockTicket({ ...ticket, observers: [{ id: 71 }] });
    prisma.team.findUnique = jest.fn(async () => ({ id: 9, name: 'Sécurité', groupEmail: null, defaultObservers: [] }));
    prisma.ticket.update = jest.fn(async ({ data }) => ({ ...ticket, ...data }));

    await escalateTicket(10, { targetTeamId: 9 });

    const { data } = prisma.ticket.update.mock.calls[0][0];
    expect(data.teamId).toBe(9);
    expect(data.observers).toBeUndefined();
  });

  it('refuse un technicien qui n\'a pas le rôle TECHNICIAN ou est inactif', async () => {
    mockTicket(ticket);
    prisma.user.findFirst = jest.fn(async () => null);

    await expect(escalateTicket(10, { targetTeamId: 9, assignedToId: 55 }))
      .rejects.toThrow(/rôle technique|introuvable|n'a pas le rôle/i);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('refuse un technicien qui n\'appartient pas à l\'équipe cible', async () => {
    mockTicket(ticket);
    prisma.team.findUnique = jest.fn(async () => ({ id: 9, name: 'Sécurité', groupEmail: null }));
    prisma.user.findFirst = jest.fn(async () => ({ id: 55, email: 'x@prosuma.ci', fullName: 'X', teamId: 5 }));

    await expect(escalateTicket(10, { targetTeamId: 9, assignedToId: 55 }))
      .rejects.toThrow(/n'appartient pas à l'équipe cible/);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('refuse une équipe cible inconnue', async () => {
    mockTicket(ticket);
    prisma.team.findUnique = jest.fn(async () => null);

    await expect(escalateTicket(10, { targetTeamId: 999 })).rejects.toThrow('Équipe cible introuvable');
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('refuse l\'escalade d\'un ticket résolu (SOLVED)', async () => {
    mockTicket({ ...ticket, status: 'SOLVED' });

    await expect(escalateTicket(10, {})).rejects.toThrow('escalader un ticket résolu');
    expect(prisma.ticket.update).not.toHaveBeenCalled();
    expect(emitTicketEscalated).not.toHaveBeenCalled();
    expect(sendEscalationEmail).not.toHaveBeenCalled();
  });

  it('refuse l\'escalade d\'un ticket fermé (CLOSED)', async () => {
    mockTicket({ ...ticket, status: 'CLOSED' });

    await expect(escalateTicket(10, {})).rejects.toThrow('escalader un ticket résolu');
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('refuse l\'escalade d\'un ticket rejeté (REJECTED) ou mis à la corbeille', async () => {
    mockTicket({ ...ticket, status: 'REJECTED' });
    await expect(escalateTicket(10, {})).rejects.toThrow('escalader un ticket résolu');

    mockTicket({ ...ticket, status: 'OPEN', deletedAt: new Date() });
    await expect(escalateTicket(10, {})).rejects.toThrow('Ticket introuvable');
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('autorise l\'escalade sur WAITING_FOR_USER (état actif : demandeur silencieux)', async () => {
    mockTicket({ ...ticket, status: 'WAITING_FOR_USER' });
    prisma.ticket.update = jest.fn(async ({ data }) => ({ ...ticket, ...data }));

    await expect(escalateTicket(10, {})).resolves.toBeTruthy();
    expect(prisma.ticket.update).toHaveBeenCalled();
  });

  it('notifie le demandeur même sans admin ni technicien assigné', async () => {
    mockTicket({ ...ticket, escalationLevel: 0, assignedTo: null });

    await escalateTicket(10, {});

    expect(sendEscalationEmail).not.toHaveBeenCalled();
    expect(sendRequesterEscalationEmail).toHaveBeenCalledTimes(1);
    expect(sendRequesterEscalationEmail.mock.calls[0][0].recipientEmail).toBe('req@prosuma.ci');
  });

  it('retombe sur sourceEmail/sourceName quand le ticket n\'a pas de demandeur interne', async () => {
    mockTicket({
      ...ticket,
      requester: null,
      assignedTo: null,
      sourceEmail: 'ext@client.com',
      sourceName: 'Client Externe',
    });

    await escalateTicket(10, { reason: 'Urgence client' });

    expect(sendEscalationEmail).not.toHaveBeenCalled();
    expect(sendRequesterEscalationEmail).toHaveBeenCalledTimes(1);
    expect(sendRequesterEscalationEmail.mock.calls[0][0]).toEqual(expect.objectContaining({
      recipientEmail: 'ext@client.com',
      recipientName: 'Client Externe',
    }));
  });

  it('déduplique les emails (membre déjà alerté via adresse de groupe → un seul mail)', async () => {
    mockTicket(ticket);
    prisma.team.findUnique = jest.fn(async () => ({ id: 9, name: 'Sécurité', groupEmail: 'sec1@prosuma.ci' }));
    prisma.user.findMany = jest.fn()
      .mockResolvedValueOnce([{ email: 'sec1@prosuma.ci', fullName: 'Sec 1' }])
      .mockResolvedValueOnce([]);

    await escalateTicket(10, { targetTeamId: 9 });

    const emails = sendEscalationEmail.mock.calls.map((c) => c[0].recipientEmail.toLowerCase());
    expect(emails.filter((e) => e === 'sec1@prosuma.ci')).toHaveLength(1);
    expect(sendRequesterEscalationEmail).toHaveBeenCalledTimes(1);
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
