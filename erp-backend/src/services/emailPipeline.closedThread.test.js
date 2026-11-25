const mockIncomingEmailFindUnique = jest.fn();
const mockIncomingEmailCreate = jest.fn();
const mockIncomingEmailUpdate = jest.fn();
const mockTicketLinkCreateMany = jest.fn();

jest.mock('../prismaClient', () => ({
  incomingEmail: {
    findUnique: (...args) => mockIncomingEmailFindUnique(...args),
    create: (...args) => mockIncomingEmailCreate(...args),
    update: (...args) => mockIncomingEmailUpdate(...args),
  },
  ticket: {
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    update: jest.fn(),
  },
  ticketMessage: {
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    update: jest.fn(),
  },
  ticketLink: {
    createMany: (...args) => mockTicketLinkCreateMany(...args),
  },
  user: { findUnique: jest.fn().mockResolvedValue(null) },
  followup: { findMany: jest.fn().mockResolvedValue([]) },
  requesterLocation: {
    findMany: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue({}),
  },
  location: {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('../utils/socket', () => ({
  getIO: () => null,
  emitTicketCreated: jest.fn(),
  emitTicketAssigned: jest.fn(),
  persistNotification: jest.fn(),
  userHasPermission: jest.fn().mockResolvedValue(true),
}));
jest.mock('./emailPoller', () => ({ pollAllAccounts: jest.fn() }));
jest.mock('./mailAnalyzer', () => ({
  analyzeEmail: jest.fn(),
  analyzeImageAttachments: jest.fn().mockResolvedValue(null),
}));
jest.mock('./ticketCreator', () => ({ createTicketFromEmail: jest.fn() }));
jest.mock('./slaService', () => ({ applySla: jest.fn() }));

const mockFindExistingTicket = jest.fn();
jest.mock('./conversationMatcher', () => ({
  findExistingTicket: (...args) => mockFindExistingTicket(...args),
}));

const mockFindSimilarOpenTicket = jest.fn();
jest.mock('./similarIncidentDetector', () => ({
  findSimilarOpenTicket: (...args) => mockFindSimilarOpenTicket(...args),
  attachSiteToTicket: jest.fn(),
  saveTicketEmbedding: jest.fn(),
}));

jest.mock('./intentAnalyzer', () => ({ analyzeIntent: jest.fn(), applyIntentActions: jest.fn() }));
jest.mock('./followupEscalation', () => ({ decideFollowupAction: jest.fn() }));
jest.mock('./followupReplyGenerator', () => ({ generateFollowupReply: jest.fn() }));
jest.mock('./emailSender', () => ({
  sendAcknowledgement: jest.fn().mockResolvedValue(undefined),
  sendEmail: jest.fn(),
  sendNeedsHumanReviewNotification: jest.fn().mockResolvedValue(undefined),
  buildAcknowledgementHtml: jest.fn(),
  buildKnownIncidentNotificationHtml: jest.fn(),
  buildEmailLayout: ({ children }) => children,
  getEmailSignature: jest.fn().mockResolvedValue(''),
  sendReopenNotificationEmail: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./approvalReminderScheduler', () => ({
  notifyNewPendingTicket: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./emailAttachmentProcessor', () => ({
  processIncomingAttachments: jest.fn().mockResolvedValue({ saved: [], cidMap: {} }),
}));
jest.mock('./signatureStripper', () => ({ stripSignature: jest.fn(async (body) => body) }));
jest.mock('./ticketEvent', () => ({ logEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock('./systemSettings', () => ({
  getSystemSettings: jest.fn().mockResolvedValue({ autoSendAiEmails: false }),
  resolveFrontendUrl: jest.fn().mockResolvedValue('http://localhost'),
}));
jest.mock('./aiReplyCc', () => ({ resolveAiReplyCc: jest.fn().mockResolvedValue([]) }));
jest.mock('./draftReplyApproval', () => ({ tryHandleReminderReply: jest.fn().mockResolvedValue(false) }));
jest.mock('../utils/circuitBreaker', () => ({
  getBreaker: jest.fn(() => ({ fire: async (fn) => fn() })),
}));
jest.mock('./emailRagService', () => ({
  indexIncomingEmail: jest.fn().mockResolvedValue(undefined),
  indexTicketMessage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./senderReputation', () => ({ isLowTrustSender: jest.fn().mockResolvedValue(false) }));
jest.mock('./emailHtml', () => ({ applyCidMap: jest.fn((html) => html) }));
jest.mock('./emailSummaryGenerator', () => ({ generateEmailSummary: jest.fn().mockResolvedValue(null) }));
jest.mock('./senderIdentity', () => ({
  resolveSenderIdentity: jest.fn().mockResolvedValue({
    known: false, role: 'inconnu', teams: [], skills: [],
    fullName: null, email: null, isRequester: false,
  }),
  ROLE_LABELS: {},
}));
jest.mock('./conversationContext', () => ({
  loadConversationItems: jest.fn().mockResolvedValue([]),
  stripHtml: jest.fn((value) => value || ''),
}));
jest.mock('./inboxRuleEngine', () => ({ applyRulesToEmail: jest.fn().mockResolvedValue(null) }));
jest.mock('./locationDetector', () => ({
  detectLocationFromSender: jest.fn().mockReturnValue(null),
  extractSignatureZone: jest.fn().mockReturnValue(''),
  resolveLocationFromRequesterLinks: jest.fn().mockReturnValue(null),
}));
jest.mock('./emailSpamFilter', () => ({ checkEmailSpam: jest.fn().mockReturnValue({ isSpam: false }) }));
jest.mock('./emailRuleEngine', () => ({ evaluateRules: jest.fn().mockResolvedValue(null) }));
jest.mock('./emailAnalysisValidator', () => ({
  validateAndCleanAnalysis: jest.fn(async (analysis) => analysis),
}));

const prisma = require('../prismaClient');
const { analyzeEmail } = require('./mailAnalyzer');
const { createTicketFromEmail } = require('./ticketCreator');
const { logEvent } = require('./ticketEvent');
const { processMessage } = require('./emailPipeline');

function buildMessage(overrides = {}) {
  return {
    id: 'graph-closed-1',
    from: { emailAddress: { address: 'client@prosuma.ci', name: 'Client Test' } },
    subject: 'RE: Imprimante caisse 3 bloquée',
    bodyPreview: 'Le problème est revenu ce matin',
    body: { content: '<p>Le problème est revenu ce matin</p>' },
    receivedDateTime: new Date().toISOString(),
    conversationId: 'conv-closed-1',
    internetMessageHeaders: [],
    toRecipients: [],
    ccRecipients: [],
    ...overrides,
  };
}

describe('emailPipeline — email reçu dans le fil d\'un ticket fermé', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIncomingEmailFindUnique.mockResolvedValueOnce(null);
    mockIncomingEmailCreate.mockResolvedValue({ id: 1, bodyHtml: '<p>Le problème est revenu ce matin</p>' });
    mockIncomingEmailUpdate.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
    mockTicketLinkCreateMany.mockResolvedValue({ count: 1 });

    mockFindExistingTicket.mockResolvedValue({
      ticketId: null,
      method: 'NEW_TICKET_FROM_CLOSED',
      closedTicketId: 5,
      closedTicketTitle: 'Ancien ticket imprimante',
      closedTicketStatus: 'CLOSED',
    });
    // Si le pipeline consultait les incidents similaires, il rattacherait le mail à #999.
    mockFindSimilarOpenTicket.mockResolvedValue({ ticketId: 999, similarity: 0.98 });

    analyzeEmail.mockResolvedValue({
      summary: 'Imprimante de nouveau bloquée',
      category: 'Matériel',
      priority: 'P3',
      isSpam: false,
      isInformational: false,
      requiresAction: true,
      confidence: 0.9,
      suggestedTitle: 'Imprimante caisse 3 bloquée',
    });
    createTicketFromEmail.mockResolvedValue({ erpTicketId: 501 });
    prisma.ticket.findUnique.mockResolvedValue({
      id: 501, title: 'Imprimante caisse 3 bloquée', priority: 'P3',
      status: 'WAITING_FOR_USER', category: 'Matériel', createdAt: new Date(), assignedToId: null,
    });
    prisma.$transaction = jest.fn(async (cb) => cb({
      ticket: { update: jest.fn() },
      ticketMessage: { create: jest.fn().mockResolvedValue({ id: 801 }) },
    }));
  });

  it('crée une nouvelle demande, la lie au ticket fermé et trace l\'origine', async () => {
    await processMessage(buildMessage(), { id: 1, emailAddress: 'support@prosuma.ci' });

    // Le mail ne doit pas être rattaché à un incident similaire ouvert.
    expect(mockFindSimilarOpenTicket).not.toHaveBeenCalled();
    expect(createTicketFromEmail).toHaveBeenCalledTimes(1);

    expect(mockTicketLinkCreateMany).toHaveBeenCalledWith({
      data: [{ ticketAId: 5, ticketBId: 501, type: 'RELATED' }],
      skipDuplicates: true,
    });

    expect(mockIncomingEmailUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 },
      data: expect.objectContaining({
        erpTicketId: 501,
        isNewTicket: true,
        aiIntent: 'NEW_REQUEST_FROM_CLOSED_TICKET',
      }),
    }));

    expect(logEvent).toHaveBeenCalledWith(
      501,
      'CREATED_FROM_CLOSED_TICKET',
      'SYSTEM',
      expect.objectContaining({ originTicketId: 5, originTicketTitle: 'Ancien ticket imprimante' }),
      expect.anything()
    );
    expect(logEvent).toHaveBeenCalledWith(
      5,
      'NEW_REQUEST_CREATED',
      'SYSTEM',
      expect.objectContaining({ targetTicketId: 501 }),
      expect.anything()
    );
  });
});
