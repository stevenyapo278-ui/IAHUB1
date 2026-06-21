jest.mock('../prismaClient', () => ({
  ticket: { findMany: jest.fn() },
  systemSettings: { update: jest.fn() },
}));
jest.mock('./emailSender', () => ({ sendEmail: jest.fn(), getEmailSignature: jest.fn().mockResolvedValue('<p>Signature</p>') }));
jest.mock('./systemSettings', () => ({ getSystemSettings: jest.fn() }));
// Aucun fournisseur IA actif par défaut dans ces tests : generateInsight doit alors retourner null
// sans planter (dégradation silencieuse), voir les tests dédiés ci-dessous qui le surchargent.
jest.mock('./mailAnalyzer', () => ({ getActiveProvider: jest.fn().mockResolvedValue(null), callProvider: jest.fn() }));
jest.mock('./promptTemplates', () => ({ getPrompt: jest.fn() }));

const prisma = require('../prismaClient');
const { sendEmail } = require('./emailSender');
const { getSystemSettings } = require('./systemSettings');
const { getActiveProvider, callProvider } = require('./mailAnalyzer');
const { getPrompt } = require('./promptTemplates');
const { buildDailySummaryHtml, sendDailySummary, checkAndSendDailySummary } = require('./dailySummary');

describe('buildDailySummaryHtml', () => {
  it("affiche un message dédié quand aucun ticket n'est ouvert", () => {
    const html = buildDailySummaryHtml([], '<p>Signature</p>');
    expect(html).toContain('Aucun ticket ouvert');
  });

  it('liste chaque ticket avec son titre et sa priorité', () => {
    const tickets = [
      { id: 1, glpiTicketId: 10, title: 'Imprimante en panne', priority: 'P1', status: 'OPEN', createdAt: new Date(), assignedTo: { fullName: 'Jean' } },
    ];
    const html = buildDailySummaryHtml(tickets, '<p>Signature</p>');
    expect(html).toContain('Imprimante en panne');
    expect(html).toContain('P1 - Critique');
    expect(html).toContain('Jean');
  });

  it('signale les tickets sans réponse depuis 3 jours ou plus', () => {
    const old = new Date();
    old.setDate(old.getDate() - 5);
    const tickets = [
      { id: 1, glpiTicketId: 10, title: 'Vieux ticket', priority: 'P2', status: 'WAITING_FOR_USER', createdAt: old, lastUserReplyAt: old, assignedTo: null },
    ];
    const html = buildDailySummaryHtml(tickets, '<p>Signature</p>');
    expect(html).toMatch(/sans réponse/i);
  });

  it('insère la signature fournie', () => {
    const html = buildDailySummaryHtml([], '<p>Ma signature</p>');
    expect(html).toContain('Ma signature');
  });

  it('affiche le demandeur via sourceName en priorité', () => {
    const tickets = [
      { id: 1, glpiTicketId: 10, title: 'Test', priority: 'P3', status: 'OPEN', createdAt: new Date(), sourceName: 'Jean Dupont', sourceEmail: 'jean@test.com', requester: null, assignedTo: null },
    ];
    const html = buildDailySummaryHtml(tickets, '<p>Sig</p>');
    expect(html).toContain('Jean Dupont');
  });

  it("retombe sur l'email source si aucun nom n'est disponible", () => {
    const tickets = [
      { id: 1, glpiTicketId: 10, title: 'Test', priority: 'P3', status: 'OPEN', createdAt: new Date(), sourceName: null, sourceEmail: 'jean@test.com', requester: null, assignedTo: null },
    ];
    const html = buildDailySummaryHtml(tickets, '<p>Sig</p>');
    expect(html).toContain('jean@test.com');
  });

  it("retombe sur le demandeur ERP (requester) si aucune info email source n'existe", () => {
    const tickets = [
      { id: 1, glpiTicketId: 10, title: 'Test', priority: 'P3', status: 'OPEN', createdAt: new Date(), sourceName: null, sourceEmail: null, requester: { fullName: 'Admin Interne', email: 'admin@test.com' }, assignedTo: null },
    ];
    const html = buildDailySummaryHtml(tickets, '<p>Sig</p>');
    expect(html).toContain('Admin Interne');
  });

  it("insère le résumé IA dans un bloc \"En bref\" quand fourni", () => {
    const html = buildDailySummaryHtml([], '<p>Sig</p>', 'Deux tickets critiques non assignés nécessitent une attention immédiate.');
    expect(html).toContain('En bref');
    expect(html).toContain('Deux tickets critiques non assignés');
  });

  it("n'affiche aucun bloc résumé si insight est null", () => {
    const html = buildDailySummaryHtml([], '<p>Sig</p>', null);
    expect(html).not.toContain('En bref');
  });
});

describe('sendDailySummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("ne tente aucun envoi si aucun destinataire n'est configuré", async () => {
    prisma.ticket.findMany.mockResolvedValue([]);
    getSystemSettings.mockResolvedValue({ dailySummaryRecipients: [] });
    const result = await sendDailySummary();
    expect(result.sent).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('envoie un email par destinataire configuré', async () => {
    prisma.ticket.findMany.mockResolvedValue([]);
    getSystemSettings.mockResolvedValue({ dailySummaryRecipients: ['a@test.com', 'b@test.com'] });
    const result = await sendDailySummary();
    expect(result.sent).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("continue d'envoyer aux autres destinataires si l'un échoue", async () => {
    prisma.ticket.findMany.mockResolvedValue([]);
    getSystemSettings.mockResolvedValue({ dailySummaryRecipients: ['a@test.com', 'b@test.com'] });
    sendEmail.mockRejectedValueOnce(new Error('SMTP down')).mockResolvedValueOnce({});
    const result = await sendDailySummary();
    expect(result.sent).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("n'appelle pas l'IA si aucun ticket n'est ouvert", async () => {
    prisma.ticket.findMany.mockResolvedValue([]);
    getSystemSettings.mockResolvedValue({ dailySummaryRecipients: ['a@test.com'] });
    await sendDailySummary();
    expect(getActiveProvider).not.toHaveBeenCalled();
  });

  it("inclut le résumé IA dans le mail envoyé quand un fournisseur est actif", async () => {
    const tickets = [{ id: 1, glpiTicketId: 10, title: 'Test', priority: 'P1', status: 'OPEN', createdAt: new Date(), assignedTo: null, requester: null }];
    prisma.ticket.findMany.mockResolvedValue(tickets);
    getSystemSettings.mockResolvedValue({ dailySummaryRecipients: ['a@test.com'] });
    getActiveProvider.mockResolvedValue({ name: 'openai' });
    getPrompt.mockResolvedValue('prompt');
    callProvider.mockResolvedValue('{"insight": "Un ticket critique à traiter en priorité."}');

    await sendDailySummary();

    const sentHtml = sendEmail.mock.calls[0][0].bodyHtml;
    expect(sentHtml).toContain('Un ticket critique à traiter en priorité.');
  });

  it("dégrade silencieusement (pas de résumé) si l'IA échoue", async () => {
    const tickets = [{ id: 1, glpiTicketId: 10, title: 'Test', priority: 'P1', status: 'OPEN', createdAt: new Date(), assignedTo: null, requester: null }];
    prisma.ticket.findMany.mockResolvedValue(tickets);
    getSystemSettings.mockResolvedValue({ dailySummaryRecipients: ['a@test.com'] });
    getActiveProvider.mockResolvedValue({ name: 'openai' });
    getPrompt.mockResolvedValue('prompt');
    callProvider.mockRejectedValue(new Error('Provider down'));

    const result = await sendDailySummary();
    expect(result.sent).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("envoie un récap dédié à chaque email de groupe d'équipe, en plus de la liste globale", async () => {
    const tickets = [
      { id: 1, glpiTicketId: 10, title: 'Ticket réseau', priority: 'P1', status: 'OPEN', createdAt: new Date(), assignedTo: null, requester: null, team: { id: 1, name: 'Réseau', groupEmail: 'reseau@test.com' } },
      { id: 2, glpiTicketId: 11, title: 'Ticket dev', priority: 'P3', status: 'OPEN', createdAt: new Date(), assignedTo: null, requester: null, team: { id: 2, name: 'Développement', groupEmail: 'dev@test.com' } },
    ];
    prisma.ticket.findMany.mockResolvedValue(tickets);
    getSystemSettings.mockResolvedValue({ dailySummaryRecipients: ['admin@test.com'] });

    const result = await sendDailySummary();

    // 1 mail à admin@test.com (global) + 1 à reseau@test.com + 1 à dev@test.com
    expect(sendEmail).toHaveBeenCalledTimes(3);
    expect(result.recipientCount).toBe(3);
    const recipients = sendEmail.mock.calls.map((c) => c[0].to);
    expect(recipients).toEqual(expect.arrayContaining(['admin@test.com', 'reseau@test.com', 'dev@test.com']));
  });

  it("le récap d'une équipe ne contient que ses propres tickets, pas ceux des autres équipes", async () => {
    const tickets = [
      { id: 1, glpiTicketId: 10, title: 'Ticket réseau', priority: 'P1', status: 'OPEN', createdAt: new Date(), assignedTo: null, requester: null, team: { id: 1, name: 'Réseau', groupEmail: 'reseau@test.com' } },
      { id: 2, glpiTicketId: 11, title: 'Ticket dev', priority: 'P3', status: 'OPEN', createdAt: new Date(), assignedTo: null, requester: null, team: { id: 2, name: 'Développement', groupEmail: 'dev@test.com' } },
    ];
    prisma.ticket.findMany.mockResolvedValue(tickets);
    getSystemSettings.mockResolvedValue({ dailySummaryRecipients: [] });

    await sendDailySummary();

    const reseauCall = sendEmail.mock.calls.find((c) => c[0].to === 'reseau@test.com');
    const devCall = sendEmail.mock.calls.find((c) => c[0].to === 'dev@test.com');
    expect(reseauCall[0].bodyHtml).toContain('Ticket réseau');
    expect(reseauCall[0].bodyHtml).not.toContain('Ticket dev');
    expect(devCall[0].bodyHtml).toContain('Ticket dev');
    expect(devCall[0].bodyHtml).not.toContain('Ticket réseau');
  });

  it("n'envoie aucun mail d'équipe pour les équipes sans email de groupe configuré", async () => {
    const tickets = [
      { id: 1, glpiTicketId: 10, title: 'Ticket sans email équipe', priority: 'P1', status: 'OPEN', createdAt: new Date(), assignedTo: null, requester: null, team: { id: 1, name: 'Réseau', groupEmail: null } },
    ];
    prisma.ticket.findMany.mockResolvedValue(tickets);
    getSystemSettings.mockResolvedValue({ dailySummaryRecipients: ['admin@test.com'] });

    await sendDailySummary();

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin@test.com' }));
  });

  it("envoie aux équipes même sans liste de destinataires globale configurée", async () => {
    const tickets = [
      { id: 1, glpiTicketId: 10, title: 'Ticket réseau', priority: 'P1', status: 'OPEN', createdAt: new Date(), assignedTo: null, requester: null, team: { id: 1, name: 'Réseau', groupEmail: 'reseau@test.com' } },
    ];
    prisma.ticket.findMany.mockResolvedValue(tickets);
    getSystemSettings.mockResolvedValue({ dailySummaryRecipients: [] });

    const result = await sendDailySummary();
    expect(result.sent).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'reseau@test.com' }));
  });
});

describe('checkAndSendDailySummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ne déclenche rien si la fonctionnalité est désactivée', async () => {
    getSystemSettings.mockResolvedValue({ dailySummaryEnabled: false });
    await checkAndSendDailySummary();
    expect(prisma.systemSettings.update).not.toHaveBeenCalled();
  });

  it("ne déclenche rien si l'heure actuelle ne correspond pas à l'heure configurée", async () => {
    getSystemSettings.mockResolvedValue({ dailySummaryEnabled: true, dailySummaryTime: '23:59' });
    await checkAndSendDailySummary();
    expect(prisma.systemSettings.update).not.toHaveBeenCalled();
  });

  it("ne déclenche rien si déjà envoyé aujourd'hui (dailySummaryLastSentDate)", async () => {
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 5);
    const today = now.toISOString().slice(0, 10);
    getSystemSettings.mockResolvedValue({ dailySummaryEnabled: true, dailySummaryTime: currentTime, dailySummaryLastSentDate: today });
    await checkAndSendDailySummary();
    expect(prisma.systemSettings.update).not.toHaveBeenCalled();
  });
});
