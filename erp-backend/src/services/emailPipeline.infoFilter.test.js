const mockIncomingEmailFindUnique = jest.fn();
const mockIncomingEmailCreate = jest.fn();
const mockIncomingEmailUpdate = jest.fn();
const mockTicketCreate = jest.fn();

jest.mock('../prismaClient', () => ({
  ticketMessage: { findFirst: jest.fn().mockResolvedValue(null) },
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
    findFirst: jest.fn().mockResolvedValue(null),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    upsert: jest.fn().mockResolvedValue({}),
  },
  glpiLocation: {
    findFirst: jest.fn().mockResolvedValue(null),
  },
  // Résolution de l'expéditeur (couche 3) : aucun utilisateur connu par défaut
  user: {
    findUnique: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('./emailPoller', () => ({ pollAllAccounts: jest.fn() }));
const mockAnalyzeEmail = jest.fn();
jest.mock('./mailAnalyzer', () => ({ analyzeEmail: (...args) => mockAnalyzeEmail(...args) }));
const mockCreateTicketFromEmail = jest.fn();
jest.mock('./ticketCreator', () => ({
  createTicketFromEmail: (...args) => mockCreateTicketFromEmail(...args),
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

  it('oriente vers le centre de validation (NEEDS_REVIEW) si le sujet est une Note d\'information non technique', async () => {
    mockAnalyzeEmail.mockResolvedValueOnce({
      summary: 'Note d\'information bâtiment A',
      category: 'Système',
      priority: 'P4',
      isSpam: false,
      isInformational: true,
      requiresAction: false,
      confidence: 0.9,
    });

    await processMessage(buildMessage(), { id: 1 });

    expect(mockCreateTicketFromEmail).not.toHaveBeenCalled();
    expect(mockIncomingEmailUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 101 },
      data: expect.objectContaining({
        status: 'NEEDS_REVIEW',
        aiIsSpam: false,
      }),
    }));
  });

  it('oriente vers le centre de validation (NEEDS_REVIEW) à la couche 3 si l\'IA identifie isInformational=true', async () => {
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
        status: 'NEEDS_REVIEW',
        aiIsSpam: false,
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

describe('emailPipeline — couche 0 : accusés de remise / de lecture (MDN)', () => {
  const { findExistingTicket } = require('./conversationMatcher');

  beforeEach(() => {
    // mockReset (et non clearAllMocks) : indispensable pour purger les "Once" en file
    // d'attente des tests précédents — sinon un matcheur de fil non consommé fausse le test.
    jest.clearAllMocks();
    mockIncomingEmailFindUnique.mockReset().mockResolvedValue(null);
    mockIncomingEmailCreate.mockReset().mockResolvedValue({ id: 101, status: 'INFORMATIONAL' });
    mockIncomingEmailUpdate.mockReset().mockResolvedValue({ id: 101, status: 'INFORMATIONAL' });
    mockAnalyzeEmail.mockReset();
    findExistingTicket.mockReset().mockResolvedValue(null);
  });

  it("classe un accusé de remise en INFORMATIONAL : aucune analyse IA, aucun ticket", async () => {
    const receipt = buildMessage({
      id: 'graph-msg-mdn-1',
      subject: 'Accusé de remise : Imprimante caisse 3 bloquée',
      from: { emailAddress: { address: 'client@prosuma.ci', name: 'Client Test' } },
      bodyPreview: 'Votre message a été remis au destinataire.',
      conversationId: 'conv-mdn-1',
    });

    const result = await processMessage(receipt, { id: 1 });

    expect(mockIncomingEmailCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'INFORMATIONAL', aiIntent: 'INFORMATIONAL' }),
    }));
    expect(result).toEqual(expect.objectContaining({ status: 'INFORMATIONAL' }));
    expect(findExistingTicket).not.toHaveBeenCalled();
    expect(mockIncomingEmailUpdate).not.toHaveBeenCalled();
    expect(mockAnalyzeEmail).not.toHaveBeenCalled();
    expect(mockCreateTicketFromEmail).not.toHaveBeenCalled();
  });

  it("n'attache pas un accusé de remise au ticket existant du fil (rattachement sauté)", async () => {
    // Le conversationMatcher RÉPONDRAIT avec un ticket — la couche 0 doit l'empêcher d'être appelé.
    findExistingTicket.mockResolvedValueOnce({ ticketId: 77, matchedBy: 'conversationId' });

    const threadedReceipt = buildMessage({
      id: 'graph-msg-mdn-2',
      subject: 'Accusé de lecture : Réponse support',
      from: { emailAddress: { address: 'client@prosuma.ci', name: 'Client Test' } },
      bodyPreview: 'Votre message a été lu par le destinataire.',
      conversationId: 'conv-existant',
    });

    await processMessage(threadedReceipt, { id: 1 });

    expect(findExistingTicket).not.toHaveBeenCalled();
    expect(mockTicketCreate).not.toHaveBeenCalled();
    expect(mockAnalyzeEmail).not.toHaveBeenCalled();
    expect(mockIncomingEmailCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'INFORMATIONAL' }),
    }));
  });

  it("analyse normalement un vrai message humain (la couche 0 ne bloque pas)", async () => {
    const human = buildMessage({
      id: 'graph-msg-human-1',
      subject: 'Remise de badge permanent',
      from: { emailAddress: { address: 'nouveau@prosuma.ci', name: 'Nouveau collègue' } },
      bodyPreview: 'Bonjour, je souhaite récupérer mon badge, merci de me dire quand passer.',
    });

    mockAnalyzeEmail.mockResolvedValueOnce({
      summary: 'Demande de badge par un nouvel arrivant',
      category: 'Comptes & Accès',
      priority: 'P4',
      isSpam: false,
      isInformational: true,
      requiresAction: false,
      confidence: 0.9,
    });

    await processMessage(human, { id: 1 });
    expect(findExistingTicket).toHaveBeenCalled();
    expect(mockAnalyzeEmail).toHaveBeenCalled();
    expect(mockIncomingEmailCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PROCESSING' }),
    }));
    expect(mockCreateTicketFromEmail).not.toHaveBeenCalled();
  });
});
