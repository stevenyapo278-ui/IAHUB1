// Tests des helpers de session : hachage opaque, limite de sessions, purge.
// Prisma et Socket.IO sont mockés : aucune base requise.

jest.mock('../prismaClient', () => ({
  authSession: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  passwordResetToken: {
    deleteMany: jest.fn(),
  },
}));

jest.mock('./socket', () => ({
  disconnectSession: jest.fn(),
  disconnectUserSessions: jest.fn(),
}));

const crypto = require('crypto');
const prisma = require('../prismaClient');
const {
  REFRESH_COOKIE,
  getIdleTimeoutMs,
  getMaxSessions,
  hashRefreshToken,
  hashOpaqueToken,
  cookieOptions,
  createAuthSession,
  findSessionByRefreshToken,
  cleanupExpiredAuthSessions,
} = require('./authSession');

describe('authSession — hachage et configuration', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  it('hache les jetons en SHA-256 hexadécimal, de façon déterministe', () => {
    const token = 'refresh-token-abc';
    const expected = crypto.createHash('sha256').update(token).digest('hex');

    expect(hashRefreshToken(token)).toBe(expected);
    expect(hashRefreshToken(token)).toHaveLength(64);
    // Les tokens de reset utilisent le même hachage opaque.
    expect(hashOpaqueToken).toBe(hashRefreshToken);
  });

  it('applique la limite de sessions par défaut puis la variable d’environnement', () => {
    delete process.env.AUTH_MAX_SESSIONS;
    expect(getMaxSessions()).toBe(10);

    process.env.AUTH_MAX_SESSIONS = '3';
    expect(getMaxSessions()).toBe(3);

    // 0 = illimité (valeur acceptée explicitement)
    process.env.AUTH_MAX_SESSIONS = '0';
    expect(getMaxSessions()).toBe(0);

    process.env.AUTH_MAX_SESSIONS = 'invalide';
    expect(getMaxSessions()).toBe(10);
  });

  it('lit le timeout d’inactivité depuis l’environnement', () => {
    delete process.env.AUTH_IDLE_TIMEOUT_MINUTES;
    expect(getIdleTimeoutMs()).toBe(30 * 60 * 1000);

    process.env.AUTH_IDLE_TIMEOUT_MINUTES = '15';
    expect(getIdleTimeoutMs()).toBe(15 * 60 * 1000);
  });

  it('configure le cookie de refresh en HttpOnly avec un SameSite sûr', () => {
    delete process.env.AUTH_COOKIE_SAMESITE;
    const options = cookieOptions(1000);
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/api/auth' });

    process.env.AUTH_COOKIE_SAMESITE = 'valeur-bidon';
    expect(cookieOptions().sameSite).toBe('lax');
    expect(REFRESH_COOKIE).toBe('ia_hub_refresh');
  });
});

describe('authSession — limite de sessions actives', () => {
  afterEach(() => {
    delete process.env.AUTH_MAX_SESSIONS;
    jest.clearAllMocks();
  });

  it('révoque les sessions les plus anciennes au-delà de la limite', async () => {
    process.env.AUTH_MAX_SESSIONS = '2';
    prisma.authSession.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }, { id: 's3' }]);
    prisma.authSession.updateMany.mockResolvedValue({ count: 2 });
    prisma.authSession.create.mockImplementation(({ data }) => ({ id: 'new', ...data }));

    const { session, token } = await createAuthSession({ userId: 7, tokenVersion: 1 });

    // 3 sessions actives, limite 2 → il faut en libérer 2 pour en créer une nouvelle.
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['s1', 's2'] }, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(session.id).toBe('new');
    // Le token en clair n'est jamais stocké : seul son hash l'est.
    expect(session.tokenHash).toBe(hashRefreshToken(token));
    expect(session.tokenHash).not.toBe(token);
  });

  it('ne révoque rien quand la limite n’est pas atteinte', async () => {
    process.env.AUTH_MAX_SESSIONS = '5';
    prisma.authSession.findMany.mockResolvedValue([{ id: 's1' }]);
    prisma.authSession.create.mockResolvedValue({ id: 'new' });

    await createAuthSession({ userId: 7 });
    expect(prisma.authSession.updateMany).not.toHaveBeenCalled();
  });

  it('ne purge rien quand AUTH_MAX_SESSIONS=0 (illimité)', async () => {
    process.env.AUTH_MAX_SESSIONS = '0';
    prisma.authSession.create.mockResolvedValue({ id: 'new' });

    await createAuthSession({ userId: 7 });
    expect(prisma.authSession.findMany).not.toHaveBeenCalled();
  });
});

describe('authSession — recherche et purge', () => {
  afterEach(() => jest.clearAllMocks());

  it('recherche une session par token courant ou précédent (détection de rejeu)', async () => {
    const token = 'ancien-token-tourne';
    prisma.authSession.findFirst.mockResolvedValue({ id: 's1' });

    await findSessionByRefreshToken(token);

    expect(prisma.authSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ tokenHash: hashRefreshToken(token) }, { previousTokenHash: hashRefreshToken(token) }] },
      })
    );
  });

  it('renvoie null sans token sans interroger la base', async () => {
    expect(await findSessionByRefreshToken(null)).toBe(null);
    expect(prisma.authSession.findFirst).not.toHaveBeenCalled();
  });

  it('purge les sessions et tokens de reset expirés depuis plus de 7 jours', async () => {
    prisma.authSession.deleteMany.mockResolvedValue({ count: 4 });
    prisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 2 });

    const result = await cleanupExpiredAuthSessions();

    expect(result).toEqual({ sessions: 4, resetTokens: 2 });
    const sessionWhere = prisma.authSession.deleteMany.mock.calls[0][0].where;
    const cutoff = sessionWhere.OR[0].expiresAt.lt;
    expect(cutoff).toBeInstanceOf(Date);
    expect(Date.now() - cutoff.getTime()).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
  });
});
