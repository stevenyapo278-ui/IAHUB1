const mockTicketFindUnique = jest.fn();
const mockMessageFindMany = jest.fn();

jest.mock('../prismaClient', () => ({
  ticket: { findUnique: (...args) => mockTicketFindUnique(...args) },
  ticketMessage: { findMany: (...args) => mockMessageFindMany(...args) },
  promptTemplate: { findUnique: jest.fn().mockResolvedValue(null) },
}));

const mockGetActiveProvider = jest.fn();
const mockGetActiveProviders = jest.fn();
const mockCallProvider = jest.fn();
const mockCallProviderWithFallback = jest.fn();
jest.mock('./mailAnalyzer', () => ({
  getActiveProvider: (...args) => mockGetActiveProvider(...args),
  getActiveProviders: (...args) => mockGetActiveProviders(...args),
  callProvider: (...args) => mockCallProvider(...args),
  callProviderWithFallback: (...args) => mockCallProviderWithFallback(...args),
}));

const mockSearchKnowledge = jest.fn();
jest.mock('./knowledgeSearch', () => ({ searchKnowledge: (...args) => mockSearchKnowledge(...args) }));

const { generateFollowupReply } = require('./followupReplyGenerator');

describe('generateFollowupReply', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTicketFindUnique.mockResolvedValue({ id: 1, title: 'Imprimante en panne', aiSummary: "L'imprimante ne répond plus" });
    mockMessageFindMany.mockResolvedValue([{ direction: 'INBOUND', body: 'Mon imprimante ne marche plus' }]);
    mockSearchKnowledge.mockResolvedValue([]);
    mockGetActiveProviders.mockResolvedValue([{ name: 'openai', label: 'OpenAI', keys: [{}], models: [{ name: 'gpt-4o' }] }]);
  });

  it("retourne canAnswer: false sans exception si aucun provider IA n'est actif", async () => {
    mockGetActiveProviders.mockResolvedValue([]);
    const result = await generateFollowupReply({ ticketId: 1, lastMessageBody: 'toujours en panne', fromEmail: 'a@b.com' });
    expect(result).toEqual({ canAnswer: false, replyHtml: '', usedKnowledgeChunkIds: [], confidence: 0 });
    expect(mockCallProviderWithFallback).not.toHaveBeenCalled();
  });

  it('propage canAnswer: false tel que retourné par le provider', async () => {
    mockGetActiveProviders.mockResolvedValue([{ name: 'openai', label: 'OpenAI', keys: [{}], models: [{ name: 'gpt-4o' }] }]);
    mockCallProviderWithFallback.mockResolvedValue(JSON.stringify({ canAnswer: false, confidence: 0 }));
    const result = await generateFollowupReply({ ticketId: 1, lastMessageBody: 'toujours en panne' });
    expect(result.canAnswer).toBe(false);
  });

  it('traite un JSON invalide comme un échec, sans lever d\'exception', async () => {
    mockGetActiveProviders.mockResolvedValue([{ name: 'openai', label: 'OpenAI', keys: [{}], models: [{ name: 'gpt-4o' }] }]);
    mockCallProviderWithFallback.mockResolvedValue('ceci n\'est pas du JSON');
    const result = await generateFollowupReply({ ticketId: 1, lastMessageBody: 'toujours en panne' });
    expect(result.canAnswer).toBe(false);
  });

  it('traite une erreur réseau du provider comme un échec, sans relancer l\'exception', async () => {
    mockGetActiveProviders.mockResolvedValue([{ name: 'openai', label: 'OpenAI', keys: [{}], models: [{ name: 'gpt-4o' }] }]);
    mockCallProviderWithFallback.mockRejectedValue(new Error('Timeout'));
    const result = await generateFollowupReply({ ticketId: 1, lastMessageBody: 'toujours en panne' });
    expect(result.canAnswer).toBe(false);
  });

  it('appelle searchKnowledge avec une requête construite depuis le résumé et le dernier message', async () => {
    mockGetActiveProviders.mockResolvedValue([{ name: 'openai', label: 'OpenAI', keys: [{}], models: [{ name: 'gpt-4o' }] }]);
    mockCallProviderWithFallback.mockResolvedValue(JSON.stringify({ canAnswer: true, replyHtml: '<p>Essayez de redémarrer</p>', confidence: 0.8 }));
    await generateFollowupReply({ ticketId: 1, lastMessageBody: 'toujours en panne' });
    expect(mockSearchKnowledge).toHaveBeenCalledWith(expect.stringContaining('toujours en panne'));
  });

  it('filtre les résultats de connaissance sous le seuil de similarité avant de les injecter dans le prompt', async () => {
    mockGetActiveProviders.mockResolvedValue([{ name: 'openai', label: 'OpenAI', keys: [{}], models: [{ name: 'gpt-4o' }] }]);
    mockSearchKnowledge.mockResolvedValue([
      { id: 1, content: 'Procédure pertinente', similarity: 0.9 },
      { id: 2, content: 'Hors sujet', similarity: 0.3 },
    ]);
    mockCallProviderWithFallback.mockImplementation((_, prompt) => {
      expect(prompt).toContain('Procédure pertinente');
      expect(prompt).not.toContain('Hors sujet');
      return Promise.resolve(JSON.stringify({ canAnswer: true, replyHtml: '<p>ok</p>', confidence: 0.9 }));
    });
    const result = await generateFollowupReply({ ticketId: 1, lastMessageBody: 'toujours en panne' });
    expect(result.canAnswer).toBe(true);
  });

  it('retourne canAnswer: true avec confiance bornée entre 0 et 1', async () => {
    mockGetActiveProviders.mockResolvedValue([{ name: 'openai', label: 'OpenAI', keys: [{}], models: [{ name: 'gpt-4o' }] }]);
    mockCallProviderWithFallback.mockResolvedValue(JSON.stringify({ canAnswer: true, replyHtml: '<p>Réponse</p>', confidence: 1.5, usedKnowledgeChunkIds: [1] }));
    const result = await generateFollowupReply({ ticketId: 1, lastMessageBody: 'toujours en panne' });
    expect(result).toEqual({ canAnswer: true, replyHtml: '<p>Réponse</p>', usedKnowledgeChunkIds: [1], confidence: 1 });
  });
});
