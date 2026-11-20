// Tests de la politique de session : priorité UI > env > défaut, bornes et
// désactivation (0). Prisma est mocké : aucune base requise.

jest.mock('../prismaClient', () => ({
  systemSettings: { findUnique: jest.fn() },
}));

const prisma = require('../prismaClient');
const {
  DEFAULT_IDLE_TIMEOUT_MINUTES,
  DEFAULT_SESSION_MAX_HOURS,
  UNLIMITED_SESSION_MS,
  getSessionPolicy,
  applySessionPolicy,
  refreshSessionPolicy,
  getIdleTimeoutMs,
  getSessionMaxAgeMs,
} = require('./sessionPolicy');

const ENV_BACKUP = {
  AUTH_IDLE_TIMEOUT_MINUTES: process.env.AUTH_IDLE_TIMEOUT_MINUTES,
  AUTH_SESSION_MAX_HOURS: process.env.AUTH_SESSION_MAX_HOURS,
  DATABASE_URL: process.env.DATABASE_URL,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ENV_BACKUP)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.systemSettings.findUnique.mockResolvedValue(null);
  // Autorise refreshSessionPolicy() à interroger le client Prisma mocké.
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  delete process.env.AUTH_IDLE_TIMEOUT_MINUTES;
  delete process.env.AUTH_SESSION_MAX_HOURS;
  // Réinitialise le cache mémoire (aucune surcharge UI).
  applySessionPolicy(null);
});

afterAll(restoreEnv);

describe('sessionPolicy — résolution UI > env > défaut', () => {
  test('applique les défauts quand ni l’UI ni l’environnement ne sont renseignés', () => {
    const policy = getSessionPolicy();
    expect(policy.idleTimeoutMinutes).toBe(DEFAULT_IDLE_TIMEOUT_MINUTES);
    expect(policy.maxHours).toBe(DEFAULT_SESSION_MAX_HOURS);
    expect(policy.idleSource).toBe('env');
    expect(policy.maxSource).toBe('env');
    expect(getIdleTimeoutMs()).toBe(DEFAULT_IDLE_TIMEOUT_MINUTES * 60 * 1000);
    expect(getSessionMaxAgeMs()).toBe(DEFAULT_SESSION_MAX_HOURS * 60 * 60 * 1000);
  });

  test('lit l’environnement quand l’UI est vide', () => {
    process.env.AUTH_IDLE_TIMEOUT_MINUTES = '15';
    process.env.AUTH_SESSION_MAX_HOURS = '24';
    const policy = getSessionPolicy();
    expect(policy.idleTimeoutMinutes).toBe(15);
    expect(policy.maxHours).toBe(24);
    expect(getIdleTimeoutMs()).toBe(15 * 60 * 1000);
    expect(getSessionMaxAgeMs()).toBe(24 * 60 * 60 * 1000);
  });

  test('la valeur UI gagne sur l’environnement', () => {
    process.env.AUTH_IDLE_TIMEOUT_MINUTES = '15';
    process.env.AUTH_SESSION_MAX_HOURS = '24';
    applySessionPolicy({ sessionIdleTimeoutMinutes: 60, sessionMaxHours: 6 });
    const policy = getSessionPolicy();
    expect(policy.idleTimeoutMinutes).toBe(60);
    expect(policy.maxHours).toBe(6);
    expect(policy.idleSource).toBe('ui');
    expect(policy.maxSource).toBe('ui');
  });

  test('une valeur UI nulle retombe sur l’environnement (remise à zéro)', () => {
    process.env.AUTH_IDLE_TIMEOUT_MINUTES = '45';
    applySessionPolicy({ sessionIdleTimeoutMinutes: null, sessionMaxHours: null });
    expect(getSessionPolicy().idleTimeoutMinutes).toBe(45);
    expect(getSessionPolicy().idleSource).toBe('env');
  });

  test('0 désactive le contrôle d’inactivité', () => {
    applySessionPolicy({ sessionIdleTimeoutMinutes: 0 });
    expect(getSessionPolicy().idleTimeoutMinutes).toBe(0);
    expect(getIdleTimeoutMs()).toBe(Number.POSITIVE_INFINITY);
  });

  test('0 désactive le plafond absolu avec une durée représentable', () => {
    applySessionPolicy({ sessionMaxHours: 0 });
    expect(getSessionPolicy().maxHours).toBe(0);
    expect(getSessionMaxAgeMs()).toBe(UNLIMITED_SESSION_MS);
    expect(Number.isFinite(getSessionMaxAgeMs())).toBe(true);
    expect(new Date(Date.now() + getSessionMaxAgeMs()).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('sessionPolicy — chargement depuis la base', () => {
  test('recharge les valeurs UI et ignore les valeurs invalides', async () => {
    prisma.systemSettings.findUnique.mockResolvedValue({
      sessionIdleTimeoutMinutes: 90,
      sessionMaxHours: 6,
    });
    await refreshSessionPolicy();
    expect(getSessionPolicy()).toMatchObject({
      idleTimeoutMinutes: 90,
      maxHours: 6,
      idleSource: 'ui',
      maxSource: 'ui',
    });

    prisma.systemSettings.findUnique.mockResolvedValue({
      sessionIdleTimeoutMinutes: -5,
      sessionMaxHours: 1.5,
    });
    await refreshSessionPolicy();
    expect(getSessionPolicy()).toMatchObject({
      idleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MINUTES,
      maxHours: DEFAULT_SESSION_MAX_HOURS,
      idleSource: 'env',
      maxSource: 'env',
    });
  });

  test('conserve les dernières valeurs connues si la base est indisponible', async () => {
    applySessionPolicy({ sessionIdleTimeoutMinutes: 120, sessionMaxHours: 8 });
    prisma.systemSettings.findUnique.mockRejectedValue(new Error('DB down'));
    await expect(refreshSessionPolicy()).resolves.toBeTruthy();
    expect(getSessionPolicy()).toMatchObject({ idleTimeoutMinutes: 120, maxHours: 8 });
  });
});
