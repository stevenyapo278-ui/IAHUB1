const mockIncomingEmailFindMany = jest.fn();
const mockIncomingEmailFindUnique = jest.fn();
const mockTicketMessageFindMany = jest.fn();

jest.mock('../prismaClient', () => ({
  incomingEmail: {
    findMany: (...args) => mockIncomingEmailFindMany(...args),
    findUnique: (...args) => mockIncomingEmailFindUnique(...args),
  },
  ticketMessage: {
    findMany: (...args) => mockTicketMessageFindMany(...args),
  },
}));

const { listThreads, getThread, buildThreads } = require('./inboxThreading');

function email(id, { conversationId = null, status = 'DONE', subject = `Sujet ${id}`, fromEmail = `a${id}@x.com`, receivedAt = new Date(`2026-08-01T0${id}:00:00Z`) } = {}) {
  const iso = receivedAt.toISOString();
  return { id, conversationId, status, subject, fromEmail, fromName: `Nom ${id}`, bodyPreview: `aperçu ${id}`, aiPriority: 'P3', receivedAt: iso };
}

function sent(msgId, conversationId, { subject = 'Re:', timestamp = new Date('2026-08-01T01:30:00Z'), sender = 'hotline@erp.local', recipients = ['a1@x.com'] } = {}) {
  return { id: msgId, ticketId: 1, direction: 'OUTBOUND', conversationId, subject, sender, recipients, body: 'body', timestamp };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildThreads', () => {
  it('regroupe les emails partageant le même conversationId et ajoute la jambe envoyée', () => {
    const emails = [
      email(1, { conversationId: 'CONV-1', subject: 'Sujet A', receivedAt: new Date('2026-08-01T01:00:00Z') }),
      email(2, { conversationId: 'CONV-1', subject: 'Re: Sujet A', receivedAt: new Date('2026-08-01T02:00:00Z') }),
      email(3, { conversationId: null }),
    ];
    const sents = [sent(10, 'CONV-1')];

    const threads = buildThreads(emails, sents, { status: null, q: null });

    expect(threads).toHaveLength(2);
    const conv = threads.find((t) => t.id === 'CONV-1');
    expect(conv.count).toBe(3); // 2 emails + 1 envoyé
    expect(conv.sentCount).toBe(1);
    expect(conv.inboundCount).toBe(2);
    expect(conv.latest.subject).toBe('Re: Sujet A');
    expect(conv.messages.map((m) => m.kind)).toEqual(['inbound', 'sent', 'inbound']);
  });

  it('les emails sans conversationId forment chacun un fil isolé', () => {
    const threads = buildThreads([email(1, { conversationId: null }), email(2, { conversationId: null })], [], { status: null, q: null });
    expect(threads).toHaveLength(2);
    expect(threads[0].id.startsWith('single-')).toBe(true);
    expect(threads[0].conversationId).toBeNull();
  });

  it('trie les fils du plus récent au plus ancien', () => {
    const threads = buildThreads([
      email(1, { conversationId: 'A', receivedAt: new Date('2026-08-01T01:00:00Z') }),
      email(2, { conversationId: 'B', receivedAt: new Date('2026-08-01T09:00:00Z') }),
    ], [], { status: null, q: null });
    expect(threads[0].id).toBe('B');
  });

  it('applique le filtre de statut (au moins un message du fil le respecte)', () => {
    const threads = buildThreads([
      email(1, { conversationId: 'A', status: 'PENDING' }),
      email(2, { conversationId: 'A', status: 'DONE' }),
      email(3, { conversationId: 'B', status: 'DONE' }),
    ], [], { status: 'PENDING', q: null });
    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe('A');
  });

  it('la recherche matche sur n importe quel message du fil et remonte tout le fil', () => {
    const threads = buildThreads([
      email(1, { conversationId: 'X', subject: 'VPN down', fromEmail: 'nobody@x.com' }),
      email(2, { conversationId: 'X', subject: 'Re: suite', fromEmail: 'someone@x.com' }),
      email(3, { conversationId: 'Y', subject: 'Imprimante', fromEmail: 'nobody@x.com' }),
    ], [], { status: null, q: 'imprimante' });
    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe('Y');
  });
});

describe('listThreads', () => {
  it('charge emails + jambes envoyées puis pagine les fils', async () => {
    mockIncomingEmailFindMany.mockResolvedValue([
      email(1, { conversationId: 'C1', receivedAt: new Date('2026-08-01T01:00:00Z') }),
      email(2, { conversationId: 'C1', receivedAt: new Date('2026-08-01T02:00:00Z') }),
      email(3, { conversationId: 'C2', receivedAt: new Date('2026-08-01T01:00:00Z') }),
    ]);
    mockTicketMessageFindMany.mockResolvedValue([sent(9, 'C1')]);

    const result = await listThreads({ status: null, q: null, page: 1, limit: 25 });
    expect(result.total).toBe(2);
    expect(mockTicketMessageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ direction: 'OUTBOUND' }) })
    );
  });
});

describe('getThread', () => {
  it('retourne null si le fil n existe pas', async () => {
    mockIncomingEmailFindUnique.mockResolvedValue(null);
    const res = await getThread('single-999');
    expect(res).toBeNull();
  });

  it('rassemble un email isolé via single-<id>', async () => {
    mockIncomingEmailFindUnique.mockResolvedValue(email(7, { conversationId: null }));
    mockTicketMessageFindMany.mockResolvedValue([]);
    const thread = await getThread('single-7');
    expect(thread.id).toBe('single-7');
    expect(thread.count).toBe(1);
  });

  it('rassemble une conversation via sa clé conversationId', async () => {
    mockIncomingEmailFindMany.mockResolvedValue([
      email(1, { conversationId: 'CV', receivedAt: new Date('2026-08-01T01:00:00Z') }),
      email(2, { conversationId: 'CV', receivedAt: new Date('2026-08-01T02:00:00Z') }),
    ]);
    mockTicketMessageFindMany.mockResolvedValue([]);
    const thread = await getThread('CV');
    expect(thread).not.toBeNull();
    expect(thread.count).toBe(2);
  });
});