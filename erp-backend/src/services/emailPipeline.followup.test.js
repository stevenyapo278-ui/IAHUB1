const mockIncomingEmailFindUnique = jest.fn();
const mockIncomingEmailCreate = jest.fn();
const mockIncomingEmailUpdate = jest.fn();
const mockTicketFindUnique = jest.fn();
const mockTicketUpdate = jest.fn();
const mockTicketMessageCreate = jest.fn();
const mockTicketMessageFindMany = jest.fn();
const mockAiEmailDraftCreate = jest.fn();

jest.mock('../prismaClient', () => ({
  incomingEmail: {
    findUnique: (...args) => mockIncomingEmailFindUnique(...args),
    create: (...args) => mockIncomingEmailCreate(...args),
    update: (...args) => mockIncomingEmailUpdate(...args),
  },
  ticket: {
    findUnique: (...args) => mockTicketFindUnique(...args),
    update: (...args) => mockTicketUpdate(...args),
  },
  ticketMessage: {
    create: (...args) => mockTicketMessageCreate(...args),
    findMany: (...args) => mockTicketMessageFindMany(...args),
  },
  aiEmailDraft: { create: (...args) => mockAiEmailDraftCreate(...args) },
}));

jest.mock('./emailPoller', () => ({ pollAllAccounts: jest.fn() }));
jest.mock('./mailAnalyzer', () => ({ analyzeEmail: jest.fn(), getActiveProvider: jest.fn(), callProvider: jest.fn() }));
jest.mock('./glpiTicketCreator', () => ({
  createTicketFromEmail: jest.fn(),
  addGlpiFollowup: jest.fn().mockResolvedValue(undefined),
  updateGlpiTicket: jest.fn().mockResolvedValue(undefined),
}));

const mockFindExistingTicket = jest.fn();
jest.mock('./conversationMatcher', () => ({ findExistingTicket: (...args) => mockFindExistingTicket(...args) }));
jest.mock('./similarIncidentDetector', () => ({
  findSimilarOpenTicket: jest.fn(),
  attachSiteToTicket: jest.fn(),
  saveTicketEmbedding: jest.fn(),
}));

const mockAnalyzeIntent = jest.fn();
const mockApplyIntentActions = jest.fn().mockResolvedValue(undefined);
jest.mock('./intentAnalyzer', () => ({
  analyzeIntent: (...args) => mockAnalyzeIntent(...args),
  applyIntentActions: (...args) => mockApplyIntentActions(...args),
}));

const mockGenerateFollowupReply = jest.fn();
jest.mock('./followupReplyGenerator', () => ({ generateFollowupReply: (...args) => mockGenerateFollowupReply(...args) }));

jest.mock('./emailSender', () => ({
  buildAcknowledgementHtml: jest.fn(),
  buildKnownIncidentNotificationHtml: jest.fn(),
  sendEmail: jest.fn(),
  getEmailSignature: jest.fn().mockResolvedValue('<div>Signature</div>'),
}));
jest.mock('./emailAttachmentProcessor', () => ({ processIncomingAttachments: jest.fn() }));
jest.mock('./signatureStripper', () => ({ stripSignature: jest.fn((body) => Promise.resolve(body)) }));
jest.mock('./ticketEvent', () => ({ logEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock('./systemSettings', () => ({ getSystemSettings: jest.fn().mockResolvedValue({ autoSendAiEmails: true }) }));
jest.mock('./draftReplyApproval', () => ({ tryHandleReminderReply: jest.fn().mockResolvedValue(false) }));

const { sendEmail } = require('./emailSender');
const { logEvent } = require('./ticketEvent');
const { processMessage } = require('./emailPipeline');

function buildMessage(overrides = {}) {
  return {
    id: 'graph-msg-1',
    from: { emailAddress: { address: 'user@client.com', name: 'Jean Client' } },
    subject: 'RE: Imprimante en panne',
    bodyPreview: 'Toujours en panne',
    body: { content: '<p>Toujours en panne</p>' },
    receivedDateTime: new Date().toISOString(),
    conversationId: 'conv-1',
    internetMessageHeaders: [],
    toRecipients: [],
    ccRecipients: [],
    ...overrides,
  };
}

describe('emailPipeline — conversation IA multi-tours sur les emails de suivi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIncomingEmailFindUnique.mockResolvedValueOnce(null); // pas déjà traité
    mockFindExistingTicket.mockResolvedValue({ ticketId: 42, method: 'CONVERSATION_ID' });
    mockTicketFindUnique.mockResolvedValue({ id: 42, glpiTicketId: 99, title: 'Imprimante en panne', aiSummary: 'Panne imprimante', aiExchangeCount: 0 });
    mockTicketMessageFindMany.mockResolvedValue([]);
    mockIncomingEmailCreate.mockResolvedValue({ id: 1 });
    mockIncomingEmailUpdate.mockResolvedValue({ id: 1 });
    mockIncomingEmailFindUnique.mockResolvedValue({ id: 1, status: 'DONE' });
    mockAnalyzeIntent.mockResolvedValue({ intent: 'QUESTION', confidence: 0.9, isAutoReply: false, newIssueSummary: null });
  });

  it('crée un AiEmailDraft CONVERSATION_FOLLOWUP quand l\'IA peut répondre, jamais d\'envoi direct même avec autoSendAiEmails: true', async () => {
    mockGenerateFollowupReply.mockResolvedValue({ canAnswer: true, replyHtml: '<p>Essayez de redémarrer</p>', confidence: 0.9, usedKnowledgeChunkIds: [] });

    await processMessage(buildMessage(), { id: 1 });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(mockAiEmailDraftCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ticketId: 42, draftKind: 'CONVERSATION_FOLLOWUP', exchangeTurn: 1 }),
    }));
  });

  it('incrémente aiExchangeCount après une réponse réussie', async () => {
    mockGenerateFollowupReply.mockResolvedValue({ canAnswer: true, replyHtml: '<p>ok</p>', confidence: 0.9, usedKnowledgeChunkIds: [] });

    await processMessage(buildMessage(), { id: 1 });

    expect(mockTicketUpdate).toHaveBeenCalledWith({ where: { id: 42 }, data: { aiExchangeCount: 1 } });
  });

  it('escalade sans créer de brouillon quand le seuil de tours est atteint', async () => {
    mockTicketFindUnique.mockResolvedValue({ id: 42, glpiTicketId: 99, title: 'Imprimante en panne', aiSummary: 'Panne', aiExchangeCount: 3 });

    await processMessage(buildMessage(), { id: 1 });

    expect(mockAiEmailDraftCreate).not.toHaveBeenCalled();
    expect(mockGenerateFollowupReply).not.toHaveBeenCalled();
    expect(mockTicketUpdate).toHaveBeenCalledWith({ where: { id: 42 }, data: { status: 'WAITING_FOR_USER' } });
    expect(logEvent).toHaveBeenCalledWith(42, 'AI_CONVERSATION_ESCALATED', 'AI', { reason: 'MAX_EXCHANGES_REACHED' });
  });

  it('escalade sans créer de brouillon quand l\'IA ne peut pas répondre (canAnswer: false)', async () => {
    mockGenerateFollowupReply.mockResolvedValue({ canAnswer: false, replyHtml: '', confidence: 0, usedKnowledgeChunkIds: [] });

    await processMessage(buildMessage(), { id: 1 });

    expect(mockAiEmailDraftCreate).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(42, 'AI_CONVERSATION_ESCALATED', 'AI', { reason: 'GENERATION_FAILED' });
  });

  it('ne génère aucune réponse de suivi pour une réponse automatique détectée (isAutoReply)', async () => {
    mockAnalyzeIntent.mockResolvedValue({ intent: 'UNKNOWN', confidence: 0, isAutoReply: true, newIssueSummary: null });

    await processMessage(buildMessage(), { id: 1 });

    expect(mockGenerateFollowupReply).not.toHaveBeenCalled();
    expect(mockAiEmailDraftCreate).not.toHaveBeenCalled();
  });
});
