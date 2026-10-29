const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../prismaClient', () => ({
  ticketAttachment: {
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  emailRagChunk: { deleteMany: jest.fn(), create: jest.fn() },
  $executeRawUnsafe: jest.fn(),
}));
jest.mock('../utils/embeddings', () => ({
  generateEmbedding: jest.fn().mockResolvedValue(new Array(768).fill(0.01)),
  toVectorLiteral: jest.fn(() => '[0.01]'),
}));
jest.mock('../utils/documentExtract', () => ({
  extractText: jest.fn(),
  isTextExtractable: jest.fn(),
  MAX_EXTRACT_CHARS: 20000,
}));
jest.mock('./mailAnalyzer', () => ({
  analyzeImageAttachments: jest.fn(),
  getActiveProviders: jest.fn(),
}));

const prisma = require('../prismaClient');
const { extractText, isTextExtractable } = require('../utils/documentExtract');
const { analyzeImageAttachments, getActiveProviders } = require('./mailAnalyzer');
const { generateEmbedding } = require('../utils/embeddings');
const { indexTicketAttachment, backfillAttachmentIndex, neutralizePromptTags } = require('./attachmentIndexer');

let tmpDir;
let fileCounter = 0;

function makeFile(content = 'contenu') {
  fileCounter += 1;
  const filepath = path.join(tmpDir, `pj-${fileCounter}.bin`);
  fs.writeFileSync(filepath, content);
  return filepath;
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pj-index-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.ticketAttachment.updateMany.mockResolvedValue({ count: 1 });
  prisma.emailRagChunk.deleteMany.mockResolvedValue({ count: 0 });
  prisma.emailRagChunk.create.mockResolvedValue({});
  prisma.$executeRawUnsafe.mockResolvedValue(1);
  getActiveProviders.mockResolvedValue([{ name: 'gemini' }]);
});

describe('indexTicketAttachment', () => {
  it('indexe le texte d\'un PDF avec les métadonnées du ticket et du mail', async () => {
    const localFilepath = makeFile('pdf');
    const attachment = {
      id: 42,
      ticketId: 7,
      filename: 'rapport.pdf',
      mimeType: 'application/pdf',
      localFilepath,
      incomingEmailId: 3,
      createdAt: new Date('2026-10-01T10:00:00Z'),
      incomingEmail: {
        id: 3, subject: 'Panne caisse', fromEmail: 'client@prosuma.ci', fromName: 'Client',
        receivedAt: new Date('2026-10-01T09:00:00Z'), conversationId: 'conv-1', erpTicketId: 7,
      },
    };
    prisma.ticketAttachment.findUnique.mockResolvedValue(attachment);
    prisma.ticketAttachment.update.mockImplementation(({ data }) => ({ ...attachment, ...data }));
    isTextExtractable.mockReturnValue(true);
    extractText.mockResolvedValue('Ticket 9876 : imprimante hors service');

    const result = await indexTicketAttachment(42);

    expect(result.status).toBe('DONE');
    expect(result.extraction).toBe('TEXTE');
    // statut réservé avant traitement (empêche un double traitement)
    expect(prisma.ticketAttachment.updateMany).toHaveBeenCalledWith({
      where: { id: 42, extractionStatus: 'PENDING' },
      data: { extractionStatus: 'PROCESSING' },
    });
    expect(prisma.ticketAttachment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 42 },
        data: expect.objectContaining({ extractionStatus: 'DONE', extractedText: 'Ticket 9876 : imprimante hors service' }),
      })
    );
    expect(prisma.emailRagChunk.deleteMany).toHaveBeenCalledWith({ where: { sourceType: 'ATTACHMENT', sourceId: 42 } });
    const [sql, sourceType, sourceId, chunkIndex, content, , metadata] = prisma.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain('"EmailRagChunk"');
    expect(sourceType).toBe('ATTACHMENT');
    expect(sourceId).toBe(42);
    expect(chunkIndex).toBe(0);
    expect(content).toContain('imprimante hors service');
    const meta = JSON.parse(metadata);
    expect(meta).toMatchObject({ ticketId: 7, attachmentId: 42, filename: 'rapport.pdf', source: 'TicketAttachment' });
    expect(generateEmbedding).toHaveBeenCalled();
  });

  it('fait l\'OCR Vision d\'une image et retire l\'en-tête de l\'analyse', async () => {
    const localFilepath = makeFile('png');
    const attachment = {
      id: 43, ticketId: 8, filename: 'capture.png', mimeType: 'image/png',
      localFilepath, incomingEmailId: null, createdAt: new Date(), incomingEmail: null,
    };
    prisma.ticketAttachment.findUnique.mockResolvedValue(attachment);
    prisma.ticketAttachment.update.mockImplementation(({ data }) => ({ ...attachment, ...data }));
    analyzeImageAttachments.mockResolvedValue(
      '--- [ANALYSE VISION DES CAPTURES D\'ÉCRAN] ---\n[Contenu extrait de la capture d\'écran "capture.png"] :\nErreur 0x80070005 sur l\'écran de caisse'
    );

    const result = await indexTicketAttachment(43);

    expect(result.status).toBe('DONE');
    expect(result.extraction).toBe('VISION');
    const savedText = prisma.ticketAttachment.update.mock.calls
      .map(([arg]) => arg.data.extractedText)
      .find(Boolean);
    expect(savedText).toBe('Erreur 0x80070005 sur l\'écran de caisse');
  });

  it('laisse la pièce jointe PENDING si aucun fournisseur vision n\'est actif', async () => {
    const localFilepath = makeFile('png');
    prisma.ticketAttachment.findUnique.mockResolvedValue({
      id: 44, ticketId: 8, filename: 'capture.png', mimeType: 'image/png',
      localFilepath, incomingEmailId: null, createdAt: new Date(), incomingEmail: null,
    });
    getActiveProviders.mockResolvedValue([]);

    const result = await indexTicketAttachment(44);

    expect(result.status).toBe('PENDING');
    expect(prisma.ticketAttachment.update).toHaveBeenCalledWith({
      where: { id: 44 },
      data: { extractionStatus: 'PENDING', extractionError: 'Aucun fournisseur IA vision disponible' },
    });
    expect(analyzeImageAttachments).not.toHaveBeenCalled();
  });

  it('marque SKIPPED un fichier absent du disque', async () => {
    prisma.ticketAttachment.findUnique.mockResolvedValue({
      id: 45, ticketId: 8, filename: 'perdu.pdf', mimeType: 'application/pdf',
      localFilepath: path.join(tmpDir, 'inexistant.pdf'), incomingEmail: null,
    });

    const result = await indexTicketAttachment(45);

    expect(result.status).toBe('SKIPPED');
    expect(prisma.ticketAttachment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ extractionStatus: 'SKIPPED' }) })
    );
  });

  it('ignore une pièce jointe déjà traitée ou en cours', async () => {
    prisma.ticketAttachment.updateMany.mockResolvedValue({ count: 0 });

    const result = await indexTicketAttachment(46);

    expect(result).toBeNull();
    expect(prisma.ticketAttachment.findUnique).not.toHaveBeenCalled();
  });

  it('marque SKIPPED un type non supporté sans appeler d\'extraction', async () => {
    const localFilepath = makeFile('bin');
    prisma.ticketAttachment.findUnique.mockResolvedValue({
      id: 47, ticketId: 9, filename: 'archive.zip', mimeType: 'application/zip',
      localFilepath, incomingEmail: null,
    });
    isTextExtractable.mockReturnValue(false);

    const result = await indexTicketAttachment(47);

    expect(result.status).toBe('SKIPPED');
    expect(extractText).not.toHaveBeenCalled();
  });
});

describe('backfillAttachmentIndex', () => {
  it('traite les pièces jointes en attente et s\'arrête si le fournisseur vision manque', async () => {
    const localFilepath = makeFile('png');
    const image = {
      id: 50, ticketId: 10, filename: 'capture.png', mimeType: 'image/png',
      localFilepath, incomingEmail: null,
    };
    prisma.ticketAttachment.findMany.mockResolvedValue([{ id: 50 }, { id: 51 }]);
    prisma.ticketAttachment.findUnique.mockImplementation(({ where }) => (
      where.id === 50
        ? Promise.resolve(image)
        : Promise.resolve({ ...image, id: 51 })
    ));
    prisma.ticketAttachment.update.mockImplementation(({ where, data }) => ({ ...image, id: where.id, ...data }));
    getActiveProviders.mockResolvedValue([]);

    const stats = await backfillAttachmentIndex({ batchSize: 5 });

    expect(prisma.ticketAttachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { extractionStatus: 'PENDING', localFilepath: { not: null } } })
    );
    expect(stats.waitingProvider).toBe(1);
    expect(stats.processed).toBe(1);
    // le 2e identifiant n'est pas traité : inutile sans fournisseur vision
    expect(prisma.ticketAttachment.updateMany).toHaveBeenCalledTimes(1);
  });
});
