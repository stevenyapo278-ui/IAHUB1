const mockFindUnique = jest.fn();
jest.mock('../prismaClient', () => ({
  ticketCategory: { findUnique: (...args) => mockFindUnique(...args) },
}));

const { categoryToGlpiId, glpiIdToCategory } = require('./glpiMapping');

describe('categoryToGlpiId', () => {
  beforeEach(() => mockFindUnique.mockReset());

  it('retourne null si aucune catégorie fournie', async () => {
    expect(await categoryToGlpiId(null)).toBeNull();
    expect(await categoryToGlpiId('')).toBeNull();
  });

  it('utilise la table TicketCategory en priorité si elle connaît la catégorie', async () => {
    mockFindUnique.mockResolvedValue({ glpiCategoryId: 42 });
    expect(await categoryToGlpiId('Logiciel')).toBe(42);
  });

  it('retombe sur le mapping statique si la catégorie n\'est pas encore synchronisée', async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await categoryToGlpiId('Logiciel')).toBe(1);
    expect(await categoryToGlpiId('Réseau')).toBe(3);
  });

  it('retourne null pour une catégorie totalement inconnue', async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await categoryToGlpiId('Catégorie inexistante')).toBeNull();
  });
});

describe('glpiIdToCategory', () => {
  beforeEach(() => mockFindUnique.mockReset());

  it('retourne null si aucun id fourni', async () => {
    expect(await glpiIdToCategory(null)).toBeNull();
  });

  it('utilise la table TicketCategory en priorité', async () => {
    mockFindUnique.mockResolvedValue({ name: 'Imprimantes' });
    expect(await glpiIdToCategory(99)).toBe('Imprimantes');
  });

  it('retombe sur le mapping statique si l\'id n\'est pas encore synchronisé', async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await glpiIdToCategory(2)).toBe('Matériel');
  });

  it('retourne null pour un id totalement inconnu', async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await glpiIdToCategory(999)).toBeNull();
  });
});
