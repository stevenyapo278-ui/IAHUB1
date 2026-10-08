const mockMessageFindMany = jest.fn();
const mockFollowupFindMany = jest.fn();

jest.mock('../prismaClient', () => ({
  ticketMessage: { findMany: (...args) => mockMessageFindMany(...args) },
  followup: { findMany: (...args) => mockFollowupFindMany(...args) },
}));

const { loadConversationItems, formatHistoryItems, historyLabel } = require('./conversationContext');

describe('conversationContext — historique messages email ∪ suivis ERP', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMessageFindMany.mockResolvedValue([]);
    mockFollowupFindMany.mockResolvedValue([]);
  });

  it("fusionne messages et suivis dans l'ordre chronologique", async () => {
    // Les deux requêtes sont en desc : le tri ascendant se fait après fusion
    mockMessageFindMany.mockResolvedValue([
      { direction: 'INBOUND', body: 'Toujours en panne', sender: 'a@b.ci', timestamp: new Date('2026-01-01T12:00:00Z') },
      { direction: 'OUTBOUND', body: 'Nous nous en occupons', sender: 's@p.ci', timestamp: new Date('2026-01-01T11:00:00Z') },
    ]);
    mockFollowupFindMany.mockResolvedValue([
      { content: '<p>Note : intervention prévue</p>', isPrivate: true, createdAt: new Date('2026-01-01T13:00:00Z'), author: { fullName: 'Karim T.' } },
    ]);

    const items = await loadConversationItems(42, { messages: 5, followups: 5 });

    expect(items.map((i) => i.source)).toEqual(['message', 'message', 'followup']);
    expect(items[0].body).toBe('Nous nous en occupons');
    expect(items[2]).toEqual(expect.objectContaining({
      source: 'followup',
      isPrivate: true,
      author: 'Karim T.',
    }));
    expect(mockMessageFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ticketId: 42 } }));
    expect(mockFollowupFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ticketId: 42 } }));
  });

  it("étiquette chaque intervenant (Demandeur / Support / suivi interne)", async () => {
    mockMessageFindMany.mockResolvedValue([
      { direction: 'INBOUND', body: 'x', timestamp: new Date('2026-01-01T12:00:00Z') },
      { direction: 'OUTBOUND', body: 'y', timestamp: new Date('2026-01-01T13:00:00Z') },
    ]);
    mockFollowupFindMany.mockResolvedValue([
      { content: 'z', isPrivate: false, createdAt: new Date('2026-01-01T14:00:00Z'), author: { fullName: 'Aïcha D.' } },
      { content: 'w', isPrivate: true, createdAt: new Date('2026-01-01T15:00:00Z'), author: null },
    ]);

    const items = await loadConversationItems(1);
    expect(items.map(historyLabel)).toEqual(['Demandeur', 'Support', 'Suivi interne — Aïcha D.', 'Note interne']);
  });

  it("supprime le HTML des suivis avant injection dans le prompt", async () => {
    mockFollowupFindMany.mockResolvedValue([
      { content: '<p><strong>Diagnostic :</strong> switch HS&nbsp;<!--IMAGE_0--></p>', isPrivate: false, createdAt: new Date(), author: null },
    ]);

    const items = await loadConversationItems(1);
    const text = formatHistoryItems(items);

    expect(text).toBe('[Suivi interne] Diagnostic : switch HS');
    expect(text).not.toContain('<p>');
    expect(text).not.toContain('<!--IMAGE_0-->');
  });

  it("retourne une mention par défaut quand il n'y a aucun échange", () => {
    expect(formatHistoryItems([])).toBe('Aucun historique disponible.');
  });
});
