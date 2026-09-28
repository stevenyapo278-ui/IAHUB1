const mockIncomingEmailFindUnique = jest.fn();
const mockIncomingEmailCreate = jest.fn();
const mockIncomingEmailUpdate = jest.fn();
const mockTicketFindUnique = jest.fn();
const mockTicketUpdate = jest.fn();
const mockTicketMessageCreate = jest.fn();
const mockTicketMessageUpdate = jest.fn();
const mockTicketMessageFindMany = jest.fn();
const mockTicketMessageFindUnique = jest.fn();
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
    update: (...args) => mockTicketMessageUpdate(...args),
    findMany: (...args) => mockTicketMessageFindMany(...args),
    findUnique: (...args) => mockTicketMessageFindUnique(...args),
    findFirst: jest.fn().mockResolvedValue(null),
  },
  aiEmailDraft: {
    create: (...args) => mockAiEmailDraftCreate(...args),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  knowledgeChunk: {
    findUnique: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('./emailPoller', () => ({ pollAllAccounts: jest.fn() }));
jest.mock('./mailAnalyzer', () => ({ analyzeEmail: jest.fn(), getActiveProvider: jest.fn(), callProvider: jest.fn() }));
jest.mock('./ticketCreator', () => ({
  createTicketFromEmail: jest.fn(),
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
  buildEmailLayout: ({ children }) => children,
  sendEmail: jest.fn(),
  getEmailSignature: jest.fn().mockResolvedValue('<div>Signature</div>'),
}));
jest.mock('./emailAttachmentProcessor', () => ({ processIncomingAttachments: jest.fn().mockResolvedValue({ saved: [], cidMap: {} }) }));
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
    mockTicketMessageCreate.mockResolvedValue({ id: 999, bodyHtml: '<p>Toujours en panne</p>' });
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

  it('ignore le message émis par la boîte support elle-même (anti-boucle, expéditeur = boîte)', async () => {
    const prismaMock = require('../prismaClient');
    mockIncomingEmailFindUnique.mockResolvedValue(null);

    const result = await processMessage(buildMessage({ from: { emailAddress: { address: 'support@prosuma.ci', name: 'Support' } } }), { id: 1, emailAddress: 'support@prosuma.ci' });

    expect(result).toBeNull();
    expect(mockIncomingEmailCreate).not.toHaveBeenCalled();
    expect(mockAnalyzeIntent).not.toHaveBeenCalled();
    expect(prismaMock.ticketMessage.findFirst).not.toHaveBeenCalled();
  });

  it('ignore l\'écho de notre propre réponse revenue via boîte de diffusion (même internetMessageId qu\'un OUTBOUND)', async () => {
    const prismaMock = require('../prismaClient');
    mockIncomingEmailFindUnique.mockResolvedValue(null);
    prismaMock.ticketMessage.findFirst.mockResolvedValueOnce({ id: 555, ticketId: 42 }); // envoi sortant trouvé avec cet id RFC

    const result = await processMessage(buildMessage({ internetMessageId: '<notre-reponse@prosuma.ci>' }), { id: 1, emailAddress: 'support@prosuma.ci' });

    expect(result).toBeNull();
    expect(mockIncomingEmailCreate).not.toHaveBeenCalled();
    expect(mockAnalyzeIntent).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(42, 'EMAIL_LOOP_SKIPPED', 'SYSTEM', expect.objectContaining({ internetMessageId: '<notre-reponse@prosuma.ci>' }));
  });

  it('analyse normalement un message entrant dont l\'internetMessageId ne correspond à aucun envoi sortant', async () => {
    const prismaMock = require('../prismaClient');
    mockIncomingEmailFindUnique.mockResolvedValue(null);
    prismaMock.ticketMessage.findFirst.mockResolvedValueOnce(null); // pas d'écho
    mockGenerateFollowupReply.mockResolvedValue({ canAnswer: true, replyHtml: '<p>ok</p>', confidence: 0.9, usedKnowledgeChunkIds: [] });

    await processMessage(buildMessage(), { id: 1, emailAddress: 'support@prosuma.ci' });

    expect(mockAnalyzeIntent).toHaveBeenCalled();
    expect(mockAiEmailDraftCreate).toHaveBeenCalled();
  });

  it('neutralise le brouillon antérieur et trace confiance / sources / contexte à chaque génération', async () => {
    const prismaMock = require('../prismaClient');
    prismaMock.aiEmailDraft.updateMany.mockResolvedValue({ count: 1 });
    mockAiEmailDraftCreate.mockResolvedValue({ id: 77, subject: '[Ticket #EN_ATTENTE] RE: Imprimante', createdAt: new Date() });
    mockGenerateFollowupReply.mockResolvedValue({ canAnswer: true, replyHtml: '<p>ok</p>', confidence: 0.87, usedKnowledgeChunkIds: [11, 12] });
    mockTicketMessageFindMany.mockResolvedValue([
      // findMany est en orderBy timestamp desc : le plus récent d'abord
      { direction: 'INBOUND', body: 'Toujours la meme panne', sender: 'user@client.com', timestamp: new Date('2026-09-28T10:10:00Z') },
      { direction: 'OUTBOUND', body: 'Nous nous en occupons', sender: 'support@prosuma.ci', timestamp: new Date('2026-09-28T10:05:00Z') },
      { direction: 'INBOUND', body: 'Imprimante en panne', sender: 'user@client.com', timestamp: new Date('2026-09-28T10:00:00Z') },
    ]);

    await processMessage(buildMessage(), { id: 1 });

    // Jamais deux propositions concurrentes : le brouillon PENDING antérieur est neutralisé
    expect(prismaMock.aiEmailDraft.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ticketId: 42, status: 'PENDING', draftKind: 'CONVERSATION_FOLLOWUP' },
      data: expect.objectContaining({ status: 'SUPERSEDED' }),
    }));

    const created = mockAiEmailDraftCreate.mock.calls[0][0].data;
    expect(created).toEqual(expect.objectContaining({
      ticketId: 42,
      aiConfidence: 0.87,
      knowledgeChunkIds: [11, 12],
    }));
    // Contexte = derniers échanges vus par l'IA, du plus récent au plus ancien, corps tronqué
    expect(Array.isArray(created.contextMessages)).toBe(true);
    expect(created.contextMessages[0].body).toContain('Toujours la meme panne');
    expect(created.contextMessages[0].direction).toBe('INBOUND');
    expect(created.contextMessages.length).toBeLessThanOrEqual(4);
    expect(created.contextMessages[0].body.length).toBeLessThanOrEqual(400);
  });
});
