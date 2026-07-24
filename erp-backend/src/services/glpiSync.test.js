const prisma = require('../prismaClient');

// Mock dependencies
jest.mock('../prismaClient', () => ({
  apiConfig: { findUnique: jest.fn() },
  systemSettings: { findUnique: jest.fn() },
  user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  team: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  glpiLocation: { upsert: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
  ticketCategory: { upsert: jest.fn(), findUnique: jest.fn() },
  $executeRawUnsafe: jest.fn(),
}));

const { syncLocationsFromGlpi, syncUsersFromGlpi } = require('./glpiTicketCreator');

describe('GLPI Sync & Active Directory Resolution Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  describe('syncLocationsFromGlpi', () => {
    it('retourne null si GLPI n\'est pas configuré', async () => {
      prisma.systemSettings.findUnique.mockResolvedValue({ activeGlpiInstance: 'glpi' });
      prisma.apiConfig.findUnique.mockResolvedValue(null);

      const result = await syncLocationsFromGlpi();
      expect(result).toBeNull();
    });

    it('synchronise correctement les lieux avec pagination et mise à jour tickets', async () => {
      prisma.systemSettings.findUnique.mockResolvedValue({ activeGlpiInstance: 'glpi' });
      prisma.apiConfig.findUnique.mockResolvedValue({
        baseUrl: 'http://glpi.test/apirest.php',
        apiKey: 'user_token',
        isActive: true,
        extra: { appToken: 'app_token' },
      });

      // initSession response
      global.fetch.mockImplementation((url) => {
        if (url.includes('/initSession')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ session_token: 'test_token' }) });
        }
        if (url.includes('/killSession')) {
          return Promise.resolve({ ok: true });
        }
        if (url.includes('/Location')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([
              { id: 1, name: 'Siège', completename: 'Siège > Bâtiment A' },
              { id: 2, name: 'Usine', completename: 'Zone Industrielle > Usine 1' },
            ]),
          });
        }
        return Promise.resolve({ ok: false });
      });

      prisma.glpiLocation.upsert.mockResolvedValue({});
      prisma.$executeRawUnsafe.mockResolvedValue({});

      const result = await syncLocationsFromGlpi();
      expect(result).toBe(2);
      expect(prisma.glpiLocation.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.$executeRawUnsafe).toHaveBeenCalled();
    });
  });

  describe('syncUsersFromGlpi & Active Directory Resolution', () => {
    it('résout les utilisateurs Active Directory et crée les comptes techniciens', async () => {
      prisma.systemSettings.findUnique.mockResolvedValue({ activeGlpiInstance: 'glpi' });
      prisma.apiConfig.findUnique.mockResolvedValue({
        baseUrl: 'http://glpi.test/apirest.php',
        apiKey: 'user_token',
        isActive: true,
        extra: { appToken: 'app_token' },
      });

      global.fetch.mockImplementation((url) => {
        if (url.includes('/initSession')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ session_token: 'test_token' }) });
        }
        if (url.includes('/killSession')) {
          return Promise.resolve({ ok: true });
        }
        if (url.includes('/UserEmail')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([
              { id: 10, users_id: 1, email: 'tech1@prosuma.ci', is_default: 1 },
            ]),
          });
        }
        if (url.includes('/User')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([
              { id: 1, name: 'jdupont', realname: 'Dupont', firstname: 'Jean' },
              { id: 2, name: 'p.martin@prosuma.ci', realname: 'Martin', firstname: 'Paul' }, // UPN AD
            ]),
          });
        }
        return Promise.resolve({ ok: false });
      });

      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }) => Promise.resolve({ id: data.glpiId, ...data }));

      const result = await syncUsersFromGlpi({ createMissing: true });
      expect(result).toBe(2);
      expect(prisma.user.create).toHaveBeenCalledTimes(2);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'tech1@prosuma.ci',
            role: 'REQUESTER',
            glpiId: 1,
          }),
        })
      );
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'p.martin@prosuma.ci',
            role: 'REQUESTER',
            glpiId: 2,
          }),
        })
      );
    });
  });
});
