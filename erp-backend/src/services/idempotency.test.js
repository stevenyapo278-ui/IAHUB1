// Tests du journal d'idempotence (actions à effet externe).
// Un faux modèle Prisma en mémoire reproduit la contrainte d'unicité et les mises à jour.

jest.mock('../prismaClient', () => {
  const rows = new Map();
  let nextId = 1;

  return {
    __rows: rows,
    idempotencyRecord: {
      findUnique: jest.fn(async ({ where }) => {
        const row = rows.get(where.key);
        return row ? { ...row } : null;
      }),
      create: jest.fn(async ({ data }) => {
        if (rows.has(data.key)) {
          const err = new Error('Unique constraint failed');
          err.code = 'P2002';
          throw err;
        }
        const row = {
          id: nextId++,
          responseBody: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        rows.set(row.key, row);
        return { ...row };
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const row = where.key !== undefined
          ? rows.get(where.key)
          : [...rows.values()].find((r) => r.id === where.id);
        if (!row) return { count: 0 };
        if (where.id !== undefined && row.id !== where.id) return { count: 0 };
        if (where.state !== undefined && row.state !== where.state) return { count: 0 };
        if (where.requestHash !== undefined && row.requestHash !== where.requestHash) return { count: 0 };
        rows.set(row.key, { ...row, ...data, updatedAt: new Date() });
        return { count: 1 };
      }),
      deleteMany: jest.fn(async ({ where }) => {
        if (where.key) {
          const existed = rows.delete(where.key);
          return { count: existed ? 1 : 0 };
        }
        if (where.expiresAt?.lt) {
          let count = 0;
          for (const [key, row] of [...rows.entries()]) {
            if (row.expiresAt < where.expiresAt.lt) {
              rows.delete(key);
              count += 1;
            }
          }
          return { count };
        }
        return { count: 0 };
      }),
    },
  };
});

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const prisma = require('../prismaClient');
const {
  runIdempotent,
  hashPayload,
  IdempotencyConflictError,
  cleanupExpiredIdempotency,
} = require('./idempotency');

describe('idempotency — une action externe n’est jamais rejouée', () => {
  beforeEach(() => {
    prisma.__rows.clear();
    jest.clearAllMocks();
  });

  it('exécute une fois puis rejoue la réponse mémorisée', async () => {
    const handler = jest.fn(async () => ({ emailId: 'msg-1' }));

    const first = await runIdempotent(
      { scope: 'ai-draft-send', key: 42, payload: { content: 'Bonjour' } },
      handler
    );
    const second = await runIdempotent(
      { scope: 'ai-draft-send', key: 42, payload: { content: 'Bonjour' } },
      handler
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(first.replayed).toBe(false);
    expect(first.value).toEqual({ emailId: 'msg-1' });
    expect(second.replayed).toBe(true);
    expect(second.value).toEqual({ emailId: 'msg-1' });
  }, 15000);

  it('refuse la même clé avec des paramètres différents (collision/abus)', async () => {
    const handler = jest.fn(async () => 'ok');
    await runIdempotent(
      { scope: 'ai-draft-send', key: 7, payload: { content: 'A' } },
      handler
    );

    await expect(
      runIdempotent({ scope: 'ai-draft-send', key: 7, payload: { content: 'B' } }, handler)
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(handler).toHaveBeenCalledTimes(1);
  }, 15000);

  it('refuse un second appel pendant que l’action est en cours', async () => {
    const row = {
      id: 1,
      key: 'tool-call:1:create_ticket:abc',
      scope: 'tool-call',
      requestHash: hashPayload({ title: 'PC en panne' }),
      state: 'IN_PROGRESS',
      responseBody: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    };
    prisma.__rows.set(row.key, row);

    await expect(
      runIdempotent(
        { scope: 'tool-call', key: '1:create_ticket:abc', payload: { title: 'PC en panne' } },
        async () => 'jamais'
      )
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS' });
  }, 15000);

  it('libère la clé après un échec pour autoriser une nouvelle tentative', async () => {
    const failing = jest.fn(async () => { throw new Error('SMTP indisponible'); });
    await expect(
      runIdempotent({ scope: 'ai-draft-send', key: 9, payload: null }, failing)
    ).rejects.toThrow('SMTP indisponible');

    const retry = await runIdempotent(
      { scope: 'ai-draft-send', key: 9, payload: null },
      async () => 'envoyé'
    );
    expect(retry.replayed).toBe(false);
    expect(retry.value).toBe('envoyé');
  }, 15000);

  it('purge les enregistrements expirés et réexécute l’action ensuite', async () => {
    const handler = jest.fn(async () => 'valeur');
    await runIdempotent({ scope: 'ai-draft-send', key: 11, payload: null, ttlMs: 1 }, handler);

    const row = prisma.__rows.get('ai-draft-send:11');
    row.expiresAt = new Date(Date.now() - 1000);

    const purged = await cleanupExpiredIdempotency();
    expect(purged).toBe(1);
    expect(prisma.__rows.size).toBe(0);
  }, 15000);

  it('exige une portée et une clé', async () => {
    await expect(runIdempotent({ scope: '', key: 1 }, async () => {})).rejects.toThrow();
    await expect(runIdempotent({ scope: 'x' }, async () => {})).rejects.toThrow();
  });
});
