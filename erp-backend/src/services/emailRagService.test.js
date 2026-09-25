jest.mock('../prismaClient', () => ({
  emailRagChunk: { findFirst: jest.fn(), deleteMany: jest.fn(), create: jest.fn(), count: jest.fn() },
  incomingEmail: { findUnique: jest.fn(), findMany: jest.fn() },
  ticketMessage: { findUnique: jest.fn(), findMany: jest.fn() },
  $executeRawUnsafe: jest.fn(),
  $queryRawUnsafe: jest.fn(),
}));
jest.mock('../utils/embeddings', () => ({
  generateEmbedding: jest.fn().mockResolvedValue(new Array(768).fill(0.01)),
  toVectorLiteral: jest.fn(() => '[0.01]'),
}));
jest.mock('../utils/reranking', () => ({
  listRerankCandidates: jest.fn().mockResolvedValue([]),
  rerank: jest.fn(),
}));

const prisma = require('../prismaClient');
const { generateEmbedding } = require('../utils/embeddings');
const { listRerankCandidates } = require('../utils/reranking');
const {
  buildIncomingEmailContent,
  buildTicketMessageContent,
  chunkText,
  indexIncomingEmail,
  searchEmailRag,
} = require('./emailRagService');

describe('chunkText', () => {
  it('retourne un seul chunk si le texte est court', () => {
    expect(chunkText('bonjour')).toEqual(['bonjour']);
  });

  it('découpe un texte long avec chevauchement', () => {
    const text = 'a'.repeat(3500);
    const chunks = chunkText(text, 1500, 200);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toHaveLength(1500);
    // le chunk suivant chevauche de 200 caractères
    expect(chunks[1].slice(0, 200)).toBe(text.slice(1300, 1500));
  });

  it('couvre tout le texte sans perte', () => {
    const text = 'b'.repeat(3200);
    const chunks = chunkText(text, 1000, 100);
    expect(chunks[chunks.length - 1].endsWith(text.slice(-50))).toBe(true);
  });
});

describe('buildIncomingEmailContent', () => {
  it('inclut objet, expéditeur, corps et ticket lié', () => {
    const content = buildIncomingEmailContent({
      subject: 'Panne réseau',
      fromName: 'Jean',
      fromEmail: 'jean@x.ci',
      bodyHtml: '<p>Hello <b>Marcory</b></p>',
      erpTicketId: 42,
      conversationId: 'conv-1',
      receivedAt: new Date('2026-01-02T10:00:00Z'),
    });
    expect(content).toContain('Objet: Panne réseau');
    expect(content).toContain('jean@x.ci');
    expect(content).toContain('Marcory');
    expect(content).toContain('Ticket lié: #42');
    expect(content).not.toContain('<b>');
  });

  it('retombe sur bodyPreview si bodyHtml est vide', () => {
    const content = buildIncomingEmailContent({ subject: 'S', bodyHtml: '', bodyPreview: 'Aperçu seul' });
    expect(content).toContain('Aperçu seul');
  });
});

describe('buildTicketMessageContent', () => {
  it('inclut direction, ticket et résumé', () => {
    const content = buildTicketMessageContent({
      subject: 'Re: Panne',
      sender: 'support@x.ci',
      recipients: ['jean@x.ci'],
      direction: 'OUTBOUND',
      ticketId: 7,
      summary: 'Réponse envoyée',
      bodyHtml: '<p>On investigate</p>',
      timestamp: new Date('2026-01-02T11:00:00Z'),
    });
    expect(content).toContain('Direction: OUTBOUND');
    expect(content).toContain('Ticket: #7');
    expect(content).toContain('Réponse envoyée');
  });
});

describe('indexIncomingEmail', () => {
  beforeEach(() => jest.clearAllMocks());

  it('supprime les anciens chunks avant réindexation', async () => {
    prisma.incomingEmail.findUnique.mockResolvedValue({ id: 5, subject: 'S', fromEmail: 'a@b.c', bodyPreview: 'x' });
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    await indexIncomingEmail(5);
    expect(prisma.emailRagChunk.deleteMany).toHaveBeenCalledWith({
      where: { sourceType: 'INCOMING_EMAIL', sourceId: 5 },
    });
  });

  it('marque direction=INBOUND pour que le filtre direction fonctionne', async () => {
    prisma.incomingEmail.findUnique.mockResolvedValue({ id: 6, subject: 'S', fromEmail: 'a@b.c', bodyPreview: 'x' });
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    await indexIncomingEmail(6);
    // $executeRawUnsafe(sql, sourceType, sourceId, chunkIndex, content, embedding, metadataJson)
    const args = prisma.$executeRawUnsafe.mock.calls[0].slice(1);
    const metadata = JSON.parse(args[args.length - 1]);
    expect(metadata.direction).toBe('INBOUND');
    expect(metadata.source).toBe('IncomingEmail');
  });

  it('retourne null si le mail n existe pas', async () => {
    prisma.incomingEmail.findUnique.mockResolvedValue(null);
    await expect(indexIncomingEmail(999)).resolves.toBeNull();
  });
});

describe('searchEmailRag', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listRerankCandidates.mockResolvedValue([]);
    generateEmbedding.mockResolvedValue(new Array(768).fill(0.01));
  });

  it('retourne un tableau vide si la requête est vide', async () => {
    await expect(searchEmailRag('   ')).resolves.toEqual([]);
  });

  it('mode hybride : les filtres démarrent à $5 (après embedding, query, limit, seuil)', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    await searchEmailRag('caisse', { fromEmail: 'jean' });
    const call = prisma.$queryRawUnsafe.mock.calls[0];
    const sql = call[0];
    const params = call.slice(1);
    expect(sql).toContain('ILIKE $5');
    expect(sql).toContain('LIMIT $3');
    // $1 embedding, $2 query, $3 limit, $4 seuil, puis $5 le filtre
    expect(params).toHaveLength(5);
    expect(params[4]).toBe('%jean%');
  });

  it('deux filtres et plus doivent rester numérotés séquentiellement', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    await searchEmailRag('caisse', { fromEmail: 'jean', ticketId: 7, direction: 'INBOUND' });
    const call = prisma.$queryRawUnsafe.mock.calls[0];
    const sql = call[0];
    const params = call.slice(1);
    expect(sql).toContain('ILIKE $5');
    expect(sql).toContain("'ticketId')::int = $6");
    expect(sql).toContain("'direction' = $7");
    expect(params).toHaveLength(7);
    expect(params[5]).toBe(7);
    expect(params[6]).toBe('INBOUND');
  });

  it('inclut la fin de journée pour dateTo', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    await searchEmailRag('caisse', { dateTo: '2026-09-20' });
    const params = prisma.$queryRawUnsafe.mock.calls[0].slice(1);
    expect(params[4]).toContain('23:59:59.999');
  });

  it('fallback FTS quand aucun embedding : utilise @@ et pas ts_rank > 0', async () => {
    generateEmbedding.mockRejectedValue(new Error('pas de fournisseur'));
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    await searchEmailRag('caisse', {});
    const sql = prisma.$queryRawUnsafe.mock.calls[0][0];
    expect(sql).toContain("@@ plainto_tsquery('french', $1)");
    expect(sql).not.toMatch(/text_rank\s*>\s*0/);  });

  it('applique la coupe relative : écarte la queue de résultats faibles', async () => {
    const rows = [
      { id: 1, content: 'a', combined_score: 0.5 },
      { id: 2, content: 'b', combined_score: 0.05 },
      { id: 3, content: 'c', combined_score: 0.02 },
    ];
    prisma.$queryRawUnsafe.mockResolvedValue(rows);
    const res = await searchEmailRag('caisse', { topK: 5 });
    expect(res.map((r) => r.id)).toEqual([1]);
  });

  it('conserve au moins le meilleur résultat même si son score est modeste', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([{ id: 9, content: 'x', combined_score: 0.13 }]);
    const res = await searchEmailRag('caisse', { topK: 5 });
    expect(res).toHaveLength(1);
  });

  it('respecte topK', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([
      { id: 1, content: 'a', combined_score: 0.9 },
      { id: 2, content: 'b', combined_score: 0.85 },
      { id: 3, content: 'c', combined_score: 0.8 },
    ]);
    const res = await searchEmailRag('caisse', { topK: 2 });
    expect(res).toHaveLength(2);
  });
});
