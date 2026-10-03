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

const { listThreads, getThread, buildThreads, threadKeyFor } = require('./inboxThreading');

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
    expect(conv.latest.id).toBe(2); // exposition de l'id IncomingEmail (retry, etc.)
    expect(conv.latest.emailId).toBe(2);
    expect(conv.messages.map((m) => m.kind)).toEqual(['inbound', 'sent', 'inbound']);
  });

  it('sans conversationId : regroupe par sujet normalisé (fallback Outlook)', () => {
    const threads = buildThreads([
      email(1, { conversationId: null, subject: 'Problème VPN au bureau', receivedAt: new Date('2026-08-01T01:00:00Z') }),
      email(2, { conversationId: null, subject: 'Re: Problème VPN au bureau', receivedAt: new Date('2026-08-01T02:00:00Z') }),
    ], [], { status: null, q: null });
    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe('subj-problème vpn au bureau');
    expect(threads[0].conversationId).toBeNull(); // clé de repli ≠ conversationId
    expect(threads[0].count).toBe(2);
    expect(threads[0].emailIds).toEqual([1, 2]);
  });

  it('sans conversationId : des sujets distincts restent des fils distincts', () => {
    const threads = buildThreads([
      email(1, { conversationId: null, subject: 'Demande accès VPN' }),
      email(2, { conversationId: null, subject: 'Imprimante bloquée étage 4' }),
    ], [], { status: null, q: null });
    expect(threads).toHaveLength(2);
    expect(threads[0].id).not.toBe(threads[1].id);
    expect(threads.every((t) => t.id.startsWith('subj-'))).toBe(true);
  });

  it('sujet trop court ou vide : email isolé via single-<id>', () => {
    const threads = buildThreads([
      email(1, { conversationId: null, subject: 'ok' }),
      email(2, { conversationId: null, subject: '' }),
    ], [], { status: null, q: null });
    expect(threads).toHaveLength(2);
    expect(threads.map((t) => t.id).sort()).toEqual(['single-1', 'single-2']);
  });

  it('expose emailIds (actions groupées côté client) mais pas pour les envois', () => {
    const threads = buildThreads(
      [email(1, { conversationId: 'C' }), email(2, { conversationId: 'C' })],
      [sent(10, 'C')],
      { status: null, q: null }
    );
    expect(threads[0].emailIds).toEqual([1, 2]);
    expect(threads[0].emailIds).not.toContain(10);
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

  it('rassemble un email isolé via single-<id> (sujet inexploitable)', async () => {
    mockIncomingEmailFindUnique.mockResolvedValue(email(7, { conversationId: null, subject: 'ok' }));
    mockTicketMessageFindMany.mockResolvedValue([]);
    const thread = await getThread('single-7');
    expect(thread.id).toBe('single-7');
    expect(thread.count).toBe(1);
  });

  it('résout une clé de repli subj- en filtrant les emails avec le même helper', async () => {
    mockIncomingEmailFindMany.mockResolvedValue([
      email(1, { conversationId: null, subject: 'Problème VPN au bureau', receivedAt: new Date('2026-08-01T01:00:00Z') }),
      email(2, { conversationId: null, subject: 'Re: Problème VPN au bureau', receivedAt: new Date('2026-08-01T02:00:00Z') }),
      email(3, { conversationId: null, subject: 'Autre sujet totalement différent', receivedAt: new Date('2026-08-01T03:00:00Z') }),
    ]);
    mockTicketMessageFindMany.mockResolvedValue([]);

    const thread = await getThread('subj-problème vpn au bureau');

    expect(thread).not.toBeNull();
    expect(thread.count).toBe(2);
    expect(thread.conversationId).toBeNull();
    expect(thread.emailIds).toEqual([1, 2]);
    // La jambe envoyée n'est rattachée que par conversationId réel (jamais par clé de repli)
    expect(mockTicketMessageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { direction: 'OUTBOUND' } })
    );
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

describe('threadKeyFor — cascade de clés', () => {
  it('priorise le conversationId Outlook', () => {
    expect(threadKeyFor({ id: 1, conversationId: 'AA@conv.microsoft.com', subject: 'Bonjour' })).toBe('AA@conv.microsoft.com');
  });

  it('retire les préfixes Re:/Fwd: répétés et normalise la casse/espaces', () => {
    const base = threadKeyFor({ id: 1, subject: 'Demande de matériel' });
    expect(threadKeyFor({ id: 2, subject: 'Re: Demande de matériel' })).toBe(base);
    expect(threadKeyFor({ id: 3, subject: 'RE: FWD:   Demande   de matériel' })).toBe(base);
    expect(base.startsWith('subj-')).toBe(true);
  });

  it('ignore les sujets trop courts (risque de fusion abusive)', () => {
    expect(threadKeyFor({ id: 1, subject: 'ok' })).toBe('single-1');
    expect(threadKeyFor({ id: 1, subject: '   ' })).toBe('single-1');
    expect(threadKeyFor({ id: 1, subject: null })).toBe('single-1');
  });

  it('tombe sur inReplyTo quand le sujet est inexploitable', () => {
    expect(threadKeyFor({ id: 5, subject: '', inReplyTo: '<abc@mail.local>' })).toBe('ref-<abc@mail.local>');
  });

  it('reste stable pour un même email (clé déterministe, calculable côté client)', () => {
    const e = { id: 9, subject: 'Re: Incident VPN', conversationId: null };
    expect(threadKeyFor(e)).toBe(threadKeyFor(e));
  });
});