const mockIncomingEmailFindUnique = jest.fn();
const mockIncomingEmailCreate = jest.fn();
const mockIncomingEmailUpdate = jest.fn();
const mockTicketCreate = jest.fn();

jest.mock('../prismaClient', () => ({
  incomingEmail: {
    findUnique: (...args) => mockIncomingEmailFindUnique(...args),
    create: (...args) => mockIncomingEmailCreate(...args),
    update: (...args) => mockIncomingEmailUpdate(...args),
  },
  ticket: {
    findUnique: jest.fn(),
    create: (...args) => mockTicketCreate(...args),
  },
  requesterLocation: {
    findMany: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('./emailPoller', () => ({ pollAllAccounts: jest.fn() }));
const mockAnalyzeEmail = jest.fn();
jest.mock('./mailAnalyzer', () => ({ analyzeEmail: (...args) => mockAnalyzeEmail(...args) }));
const mockCreateTicketFromEmail = jest.fn();
jest.mock('./glpiTicketCreator', () => ({
  createTicketFromEmail: (...args) => mockCreateTicketFromEmail(...args),
  addGlpiFollowup: jest.fn(),
}));

jest.mock('./conversationMatcher', () => ({ findExistingTicket: jest.fn().mockResolvedValue(null) }));
jest.mock('./similarIncidentDetector', () => ({
  findSimilarOpenTicket: jest.fn().mockResolvedValue(null),
  attachSiteToTicket: jest.fn(),
  saveTicketEmbedding: jest.fn(),
}));

jest.mock('./intentAnalyzer', () => ({ analyzeIntent: jest.fn(), applyIntentActions: jest.fn() }));
jest.mock('./emailSender', () => ({
  buildAcknowledgementHtml: jest.fn(),
  buildKnownIncidentNotificationHtml: jest.fn(),
  sendEmail: jest.fn(),
  getEmailSignature: jest.fn().mockResolvedValue('<div>Signature</div>'),
}));
jest.mock('./emailAttachmentProcessor', () => ({ processIncomingAttachments: jest.fn().mockResolvedValue({ saved: [], cidMap: {} }) }));
jest.mock('./signatureStripper', () => ({ stripSignature: jest.fn((body) => Promise.resolve(body)) }));
jest.mock('./ticketEvent', () => ({ logEvent: jest.fn() }));
jest.mock('./systemSettings', () => ({ getSystemSettings: jest.fn().mockResolvedValue({ autoSendAiEmails: false }) }));
jest.mock('./draftReplyApproval', () => ({ tryHandleReminderReply: jest.fn().mockResolvedValue(false) }));
jest.mock('./emailRuleEngine', () => ({ evaluateRules: jest.fn().mockResolvedValue(null) }));

const { processMessage } = require('./emailPipeline');

function buildMessage(overrides = {}) {
  return {
    id: 'graph-msg-info-1',
    from: { emailAddress: { address: 'direction@prosuma.ci', name: 'Direction Générale' } },
    subject: "Note d'information : Travaux bâtiment A",
    bodyPreview: 'Message à tous les collaborateurs',
    body: { content: '<p>Message à tous les collaborateurs</p>' },
    receivedDateTime: new Date().toISOString(),
    conversationId: 'conv-info-1',
    internetMessageHeaders: [],
    toRecipients: [],
    ccRecipients: [],
    ...overrides,
  };
}

describe('emailPipeline — filtrage strict des emails d\'information', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIncomingEmailFindUnique.mockResolvedValueOnce(null);
    mockIncomingEmailCreate.mockResolvedValue({ id: 101 });
    mockIncomingEmailUpdate.mockResolvedValue({ id: 101, status: 'INFORMATIONAL' });
  });

  it('bloque la création de ticket dès la couche 1 si le sujet est une Note d\'information', async () => {
    await processMessage(buildMessage(), { id: 1 });

    expect(mockCreateTicketFromEmail).not.toHaveBeenCalled();
    expect(mockIncomingEmailUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 101 },
      data: expect.objectContaining({
        status: 'INFORMATIONAL',
        aiIsSpam: true,
      }),
    }));
  });

  it('bloque la création de ticket à la couche 3 si l\'IA identifie isInformational=true', async () => {
    const normalMessage = buildMessage({
      subject: 'Réorganisation de l\'équipe projets',
      from: { emailAddress: { address: 'chef.projet@prosuma.ci', name: 'Chef Projet' } },
      bodyPreview: 'Voici la nouvelle composition des équipes à partir du mois prochain.',
    });

    mockAnalyzeEmail.mockResolvedValueOnce({
      summary: 'Annonce de réorganisation d\'équipe sans demande de support',
      category: 'Système',
      priority: 'P4',
      isSpam: false,
      isInformational: true,
      requiresAction: false,
      confidence: 0.95,
    });

    await processMessage(normalMessage, { id: 1 });

    expect(mockAnalyzeEmail).toHaveBeenCalled();
    expect(mockCreateTicketFromEmail).not.toHaveBeenCalled();
    expect(mockIncomingEmailUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 101 },
      data: expect.objectContaining({
        status: 'INFORMATIONAL',
        aiIsSpam: true,
      }),
    }));
  });

  it('crée un ticket normalement pour une vraie demande de support IT (requiresAction=true, isInformational=false)', async () => {
    const supportMessage = buildMessage({
      subject: 'Imprimante caisse 3 bloquée',
      from: { emailAddress: { address: 'caissier@prosuma.ci', name: 'Magasin Vallon' } },
      bodyPreview: 'L\'imprimante de la caisse 3 ne s\'allume plus, merci d\'intervenir',
    });

    mockAnalyzeEmail.mockResolvedValueOnce({
      summary: 'Panne imprimante caisse 3',
      category: 'Matériel',
      priority: 'P3',
      isSpam: false,
      isInformational: false,
      requiresAction: true,
      confidence: 0.9,
      suggestedTitle: 'SUPER U VALLON : Panne imprimante caisse 3',
    });

    mockCreateTicketFromEmail.mockResolvedValueOnce({
      glpiTicketId: 1001,
      erpTicketId: 501,
    });

    // Mock transaction prisma
    const prisma = require('../prismaClient');
    prisma.$transaction = jest.fn(async (cb) => cb({
      ticket: { update: jest.fn() },
      ticketMessage: { create: jest.fn().mockResolvedValue({ id: 801 }) },
    }));

    await processMessage(supportMessage, { id: 1 });

    expect(mockAnalyzeEmail).toHaveBeenCalled();
    expect(mockCreateTicketFromEmail).toHaveBeenCalled();
  });
});
