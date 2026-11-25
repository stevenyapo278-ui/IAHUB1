const mockTicketFindFirst = jest.fn();
const mockTicketMessageFindFirst = jest.fn();

jest.mock('../prismaClient', () => ({
  ticket: { findFirst: (...args) => mockTicketFindFirst(...args) },
  ticketMessage: { findFirst: (...args) => mockTicketMessageFindFirst(...args) },
}));

const { findExistingTicket } = require('./conversationMatcher');

describe('conversationMatcher — un ticket CLOSED ne reçoit plus de nouveaux emails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTicketFindFirst.mockReset();
    mockTicketMessageFindFirst.mockReset();
    mockTicketMessageFindFirst.mockResolvedValue(null);
  });

  it('rattache un email au ticket actif du fil', async () => {
    mockTicketFindFirst.mockResolvedValueOnce({ id: 10, title: 'Ticket actif', status: 'OPEN' });

    await expect(findExistingTicket({ conversationId: 'conv-1' })).resolves.toEqual({
      ticketId: 10,
      method: 'CONVERSATION_ID',
    });
    expect(mockTicketMessageFindFirst).not.toHaveBeenCalled();
  });

  it('ne renvoie jamais un ticket CLOSED : le mail devient une nouvelle demande', async () => {
    mockTicketFindFirst.mockImplementation(async ({ where }) => {
      if (where.status === 'CLOSED') return { id: 5, title: 'Ancien ticket', status: 'CLOSED' };
      return null; // aucun ticket actif
    });

    await expect(findExistingTicket({ conversationId: 'conv-close' })).resolves.toEqual({
      ticketId: null,
      method: 'NEW_TICKET_FROM_CLOSED',
      closedTicketId: 5,
      closedTicketTitle: 'Ancien ticket',
      closedTicketStatus: 'CLOSED',
    });
  });

  it('détecte un ticket CLOSED via In-Reply-To et demande une nouvelle demande', async () => {
    mockTicketMessageFindFirst.mockResolvedValueOnce({
      ticketId: 7,
      ticket: { id: 7, title: 'Ticket fermé', status: 'CLOSED' },
    });

    await expect(findExistingTicket({ inReplyTo: 'msg-original' })).resolves.toEqual({
      ticketId: null,
      method: 'NEW_TICKET_FROM_CLOSED',
      closedTicketId: 7,
      closedTicketTitle: 'Ticket fermé',
      closedTicketStatus: 'CLOSED',
    });
  });

  it('rattache un In-Reply-To à un ticket encore actif', async () => {
    mockTicketMessageFindFirst.mockResolvedValueOnce({
      ticketId: 8,
      ticket: { id: 8, title: 'Ticket actif', status: 'OPEN' },
    });

    await expect(findExistingTicket({ inReplyTo: 'msg-original' })).resolves.toEqual({
      ticketId: 8,
      method: 'IN_REPLY_TO',
    });
  });

  it('continue de rattacher les tickets SOLVED (seul CLOSED déclenche une nouvelle demande)', async () => {
    mockTicketFindFirst.mockResolvedValueOnce({ id: 9, title: 'Ticket résolu', status: 'SOLVED' });

    await expect(findExistingTicket({ conversationId: 'conv-solved' })).resolves.toEqual({
      ticketId: 9,
      method: 'CONVERSATION_ID',
    });
  });

  it('détecte le ticket CLOSED historique via les TicketMessages (sans outlookConversationId)', async () => {
    mockTicketFindFirst.mockResolvedValue(null);
    mockTicketMessageFindFirst.mockImplementation(async ({ where }) => {
      if (where.ticket) return null; // aucun message rattaché à un ticket actif
      return { ticketId: 6, ticket: { id: 6, title: 'Ticket legacy', status: 'CLOSED' } };
    });

    await expect(findExistingTicket({ conversationId: 'conv-legacy' })).resolves.toEqual({
      ticketId: null,
      method: 'NEW_TICKET_FROM_CLOSED',
      closedTicketId: 6,
      closedTicketTitle: 'Ticket legacy',
      closedTicketStatus: 'CLOSED',
    });
  });

  it('retourne null quand aucun ticket ne correspond', async () => {
    mockTicketFindFirst.mockResolvedValue(null);

    await expect(findExistingTicket({ conversationId: 'conv-inconnue' })).resolves.toBeNull();
  });
});
