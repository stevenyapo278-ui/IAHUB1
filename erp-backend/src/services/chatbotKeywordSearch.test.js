const prisma = require('../prismaClient');
const { buildSearchQuery } = require('./chatbotService');

jest.mock('../prismaClient', () => ({
  ticket: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), groupBy: jest.fn() },
  user: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  aiProvider: { findMany: jest.fn() },
  aiModel: { findMany: jest.fn() },
  systemSettings: { findUnique: jest.fn(), upsert: jest.fn() },
  ticketCategory: { findMany: jest.fn() },
  team: { findMany: jest.fn() },
  location: { findMany: jest.fn() },
}));

describe('Chatbot keyword search — fix sauvegarde #73', () => {
  it('REQUESTER cherchant "sauvegarde" trouve le ticket même sans être demandeur', () => {
    const user = { sub: 999, role: 'REQUESTER' };
    const where = buildSearchQuery({ keyword: 'sauvegarde' }, user);
    // Doit être global : OR contient le mot-clé, pas de AND restrictif
    expect(where.OR).toBeDefined();
    expect(where.AND).toBeUndefined();
    const hasTitleFilter = where.OR.some((c) => c.title && c.title.contains);
    expect(hasTitleFilter).toBe(true);
    // Ne doit PAS filtrer par rôle — la recherche mot-clé est globale
    const hasRoleFilter = JSON.stringify(where).includes('999');
    expect(hasRoleFilter).toBe(false);
  });

  it('TECHNICIAN cherchant "sauvegarde" — idem global', () => {
    const user = { sub: 42, role: 'TECHNICIAN' };
    const where = buildSearchQuery({ keyword: 'sauvegarde' }, user);
    expect(where.OR).toBeDefined();
    expect(where.AND).toBeUndefined();
  });

  it('ADMIN cherchant "sauvegarde" — global aussi', () => {
    const user = { sub: 1, role: 'ADMIN' };
    const where = buildSearchQuery({ keyword: 'sauvegarde' }, user);
    expect(where.OR).toBeDefined();
    expect(where.AND).toBeUndefined();
  });

  it('Sans mot-clé, REQUESTER voit seulement ses tickets', () => {
    const user = { sub: 999, role: 'REQUESTER' };
    const where = buildSearchQuery({}, user);
    expect(where.OR).toBeDefined();
    expect(JSON.stringify(where.OR)).toContain('999');
  });

  it('Sans mot-clé, ADMIN voit tout (pas de filtre rôle)', () => {
    const user = { sub: 1, role: 'ADMIN' };
    const where = buildSearchQuery({}, user);
    expect(where.OR).toBeUndefined();
  });
});
