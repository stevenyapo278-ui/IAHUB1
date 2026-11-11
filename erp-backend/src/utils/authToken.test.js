const jwt = require('jsonwebtoken');
const { signAccessToken, verifyAccessToken, getAccessTokenTtl, getSessionMaxAgeMs } = require('./authToken');

const ENV_BACKUP = {};
const TEST_ENV = {
  JWT_SECRET: 'test_secret_suffisamment_long_pour_les_tests',
  JWT_EXPIRES_IN: '15m',
  AUTH_SESSION_MAX_HOURS: '12',
};

beforeAll(() => {
  for (const key of Object.keys(TEST_ENV)) {
    ENV_BACKUP[key] = process.env[key];
    process.env[key] = TEST_ENV[key];
  }
});

afterAll(() => {
  for (const [key, value] of Object.entries(ENV_BACKUP)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const SESSION_ID = 'sess_test';

const USER = {
  id: 42,
  email: 'user@example.com',
  role: 'TECHNICIAN',
  roles: ['TECHNICIAN', 'REQUESTER'],
  teamId: 7,
  tokenVersion: 3,
};

describe('authToken', () => {
  test('signe un jeton avec les claims de session et de révocation', () => {
    const token = signAccessToken(USER, { sessionId: SESSION_ID });
    const payload = verifyAccessToken(token);

    expect(payload.sub).toBe(42);
    expect(payload.role).toBe('TECHNICIAN');
    expect(payload.roles).toEqual(['TECHNICIAN', 'REQUESTER']);
    expect(payload.tv).toBe(3);
    expect(payload.sid).toBe(SESSION_ID);
    expect(payload.sst).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });

  test('conserve le début de session lors d’un renouvellement', () => {
    const sessionStart = Math.floor(Date.now() / 1000) - 3600;
    const token = signAccessToken(USER, { sessionStart, sessionId: SESSION_ID });
    expect(verifyAccessToken(token).sst).toBe(sessionStart);
  });

  test('normalise un sessionStart de type Date en secondes UNIX', () => {
    const sessionStart = new Date();
    const token = signAccessToken(USER, { sessionStart, sessionId: SESSION_ID });
    const payload = verifyAccessToken(token);
    expect(payload.sst).toBe(Math.floor(sessionStart.getTime() / 1000));
  });

  test('rejette un jeton sans tv/sst (jetons antérieurs au durcissement)', () => {
    const legacy = jwt.sign({ sub: 42, role: 'TECHNICIAN' }, process.env.JWT_SECRET, { expiresIn: '2h' });
    expect(() => verifyAccessToken(legacy)).toThrow(/obsolète/i);
    try {
      verifyAccessToken(legacy);
    } catch (err) {
      expect(err.code).toBe('TOKEN_OUTDATED');
    }
  });

  test('rejette une session au-delà du plafond absolu, même si le jeton est récent', () => {
    const staleSession = Math.floor(Date.now() / 1000) - 13 * 3600;
    const token = jwt.sign(
      { sub: 42, role: 'TECHNICIAN', sid: SESSION_ID, tv: 3, sst: staleSession },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );
    expect(() => verifyAccessToken(token)).toThrow(/Session expirée/i);
    try {
      verifyAccessToken(token);
    } catch (err) {
      expect(err.code).toBe('SESSION_EXPIRED');
    }
  });

  test('applique une durée d’accès courte par défaut', () => {
    expect(getAccessTokenTtl()).toBe('15m');
    const token = signAccessToken(USER, { sessionId: SESSION_ID });
    const decoded = jwt.decode(token);
    expect(decoded.exp - decoded.iat).toBe(15 * 60);
  });

  test('plafonne la session à 12 h par défaut', () => {
    expect(getSessionMaxAgeMs()).toBe(12 * 60 * 60 * 1000);
  });
});
