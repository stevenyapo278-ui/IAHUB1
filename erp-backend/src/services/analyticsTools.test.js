const prisma = require('../prismaClient');
const {
  getTopLocationsStats,
  analyzeRootCause,
} = require('./analyticsTools');

jest.mock('../prismaClient', () => ({
  ticket: { findMany: jest.fn() },
}));

describe('getTopLocationsStats', () => {
  beforeEach(() => jest.clearAllMocks());

  it('groupe par locationName (pas de relation location sur Ticket)', async () => {
    prisma.ticket.findMany.mockResolvedValue([
      { id: 1, priority: 'P1', status: 'OPEN', createdAt: new Date(), locationId: 10, locationName: 'CENTRALE > MARCORY' },
      { id: 2, priority: 'P3', status: 'SOLVED', createdAt: new Date(), locationId: 10, locationName: 'CENTRALE > MARCORY' },
      { id: 3, priority: 'P2', status: 'NEW', createdAt: new Date(), locationId: null, locationName: null },
    ]);

    const stats = await getTopLocationsStats({ period: '30d', limit: 5 });

    // Aucune requête sur une relation `location` inexistante
    const whereKeys = Object.keys(prisma.ticket.findMany.mock.calls[0][0].where || {});
    expect(whereKeys).not.toContain('location');

    expect(stats.rankings[0]).toMatchObject({
      locationName: 'CENTRALE > MARCORY',
      totalTickets: 2,
      urgentTickets: 1,
      resolvedTickets: 1,
    });
    expect(stats.rankings[1]).toMatchObject({ locationName: 'Non spécifié / Magasin Inconnu', totalTickets: 1 });
  });

  it('filtre par mot-clé via locationName/title/content', async () => {
    prisma.ticket.findMany.mockResolvedValue([]);
    await getTopLocationsStats({ filterKeyword: 'asten', period: '30d' });

    const where = prisma.ticket.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { title: { contains: 'asten', mode: 'insensitive' } },
      { content: { contains: 'asten', mode: 'insensitive' } },
      { locationName: { contains: 'asten', mode: 'insensitive' } },
    ]);
  });

  it('trie par tickets P1 (critiques) quand sortByUrgent=true', async () => {
    prisma.ticket.findMany.mockResolvedValue([
      { id: 1, priority: 'P3', status: 'OPEN', createdAt: new Date(), locationId: 1, locationName: 'MAG A' },
      { id: 2, priority: 'P3', status: 'OPEN', createdAt: new Date(), locationId: 1, locationName: 'MAG A' },
      { id: 3, priority: 'P3', status: 'OPEN', createdAt: new Date(), locationId: 1, locationName: 'MAG A' },
      { id: 4, priority: 'P1', status: 'OPEN', createdAt: new Date(), locationId: 2, locationName: 'MAG B' },
    ]);

    const stats = await getTopLocationsStats({ sortByUrgent: true, limit: 5 });
    expect(stats.rankings[0].locationName).toBe('MAG B'); // 1 P1 bat 3 P3
    expect(stats.rankings[0].urgentTickets).toBe(1);
  });

  it('trie par total décroissant par défaut', async () => {
    prisma.ticket.findMany.mockResolvedValue([
      { id: 1, priority: 'P3', status: 'OPEN', createdAt: new Date(), locationId: 1, locationName: 'MAG A' },
      { id: 2, priority: 'P3', status: 'OPEN', createdAt: new Date(), locationId: 1, locationName: 'MAG A' },
      { id: 3, priority: 'P1', status: 'OPEN', createdAt: new Date(), locationId: 2, locationName: 'MAG B' },
    ]);

    const stats = await getTopLocationsStats({ limit: 5 });
    expect(stats.rankings[0].locationName).toBe('MAG A');
  });
});

describe('analyzeRootCause', () => {
  beforeEach(() => jest.clearAllMocks());

  it('filtre sur locationName (pas de relation location) et expose subject', async () => {
    prisma.ticket.findMany.mockResolvedValue([
      { id: 7, title: 'VPN down', content: 'Le VPN ne répond plus', category: 'Réseau', status: 'OPEN', createdAt: new Date(), locationName: 'MARCORY' },
    ]);

    const result = await analyzeRootCause({ locationName: 'marcory' });

    const call = prisma.ticket.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ locationName: { contains: 'marcory', mode: 'insensitive' } });

    expect(result.sampleCount).toBe(1);
    expect(result.ticketsSample[0]).toMatchObject({ id: 7, subject: 'VPN down', category: 'Réseau' });
  });

  it('combine locationName + filterKeyword via AND', async () => {
    prisma.ticket.findMany.mockResolvedValue([]);
    await analyzeRootCause({ locationName: 'MARCORY', filterKeyword: 'vpn' });

    const where = prisma.ticket.findMany.mock.calls[0][0].where;
    // locationName (AND) + OR title/content (AND) — conditions de premier niveau combinées par Prisma
    expect(where).toEqual({
      locationName: { contains: 'MARCORY', mode: 'insensitive' },
      OR: [
        { title: { contains: 'vpn', mode: 'insensitive' } },
        { content: { contains: 'vpn', mode: 'insensitive' } },
      ],
    });
  });
});
