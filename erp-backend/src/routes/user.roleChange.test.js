// Test d'intégration du changement de rôle (PATCH /users/:id) — le vrai handler
// Express est exécuté avec un Prisma en mémoire, afin de vérifier de bout en bout :
//   1. le rôle est bien écrit en base,
//   2. le groupe de droits suit le rôle (RBAC « groupe suit le rôle »),
//   3. une rétrogradation vers un rôle sans groupe détache les groupes à rôle
//      (aucun privilège résiduel — un REQUESTER ne garde pas les droits technicien),
//   4. les gardes-fous hiérarchiques (canAssignRole / canActOnTarget) bloquent
//      les élévations et modifications interdites,
//   5. emitUserUpdated est émis → la session de l'utilisateur se rafraîchit en direct.
jest.mock('../prismaClient', () => {
  // Mini-base mémoire : juste ce que le PATCH et syncRolePermissionGroup consomment.
  const db = { users: [], groups: [] };
  return {
    __db: db,
    user: {
      findUnique: jest.fn(async ({ where }) => {
        if (where.email !== undefined) return db.users.find((u) => u.email === where.email) || null;
        return db.users.find((u) => u.id === where.id) || null;
      }),
      findMany: jest.fn(async () => db.users),
      // Fidèle au vrai Prisma : lit l'enregistrement, applique les changements sur une
      // COPIE et remplace l'entrée — l'objet retourné (et toute référence antérieure,
      // comme `target` dans le handler) n'est jamais muté en place.
      update: jest.fn(async ({ where, data }) => {
        const idx = db.users.findIndex((x) => x.id === where.id);
        if (idx === -1) {
          const e = new Error('Record not found');
          e.code = 'P2025';
          throw e;
        }
        const updated = { ...db.users[idx], permissionGroups: [...(db.users[idx].permissionGroups || [])] };
        for (const [key, value] of Object.entries(data)) {
          if (key === 'permissionGroups' && value?.set) {
            updated.permissionGroups = value.set.map((g) => {
              const grp = db.groups.find((x) => x.id === g.id);
              return { id: g.id, name: grp ? grp.name : '' };
            });
          } else if (key === 'permissionGroups' && value?.disconnect) {
            const ids = value.disconnect.map((g) => g.id);
            updated.permissionGroups = updated.permissionGroups.filter((g) => !ids.includes(g.id));
          } else {
            updated[key] = value;
          }
        }
        db.users[idx] = updated;
        return { ...updated };
      }),
      create: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    ticket: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    reassignmentLog: { create: jest.fn() },
    permissionGroup: {
      findUnique: jest.fn(async ({ where }) => db.groups.find((g) => g.name === where.name) || null),
      findMany: jest.fn(async ({ where }) => {
        const names = where?.name?.in || [];
        return db.groups.filter((g) => names.includes(g.name));
      }),
      count: jest.fn().mockResolvedValue(0),
    },
    passwordResetToken: { findFirst: jest.fn(), deleteMany: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  };
});

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => next(),
  authorizeAdmin: (_req, _res, next) => next(),
  authorize: (_req, _res, next) => next(),
}));
jest.mock('../services/emailSender', () => ({ sendTemporaryPasswordEmail: jest.fn() }));
jest.mock('../services/auditLogService', () => ({ auditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../utils/socket', () => ({ emitUserUpdated: jest.fn(), emitTicketAssigned: jest.fn() }));
jest.mock('../services/cacheStore', () => ({ clear: jest.fn(), get: jest.fn(() => null), set: jest.fn(), createKey: jest.fn(() => 'k') }));
jest.mock('../utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }, childLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }));
jest.mock('../services/ldapDirectory', () => ({ isLdapSyncConfigured: jest.fn(() => false), syncLdapDirectory: jest.fn() }));

const prisma = require('../prismaClient');
const { __db: db } = require('../prismaClient');
const router = require('./user.routes');
const { emitUserUpdated } = require('../utils/socket');

// Récupère le handler final (après les validators express-validator) d'une route donnée
function getHandler(method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`Route ${method} ${path} introuvable`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function makeReq({ user, params = {}, body = {} }) {
  return {
    user,
    params,
    body,
    headers: {},
    requestId: 'test-req',
    protocol: 'http',
    get: () => undefined,
  };
}

function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.body = payload; return res; });
  return res;
}

let nextId = 100;
function seedUser({ role, email = `user${Math.random()}@prosuma.ci`, isActive = true, authProvider = 'local', permissionGroups = [] }) {
  const u = { id: ++nextId, email, fullName: `User ${nextId}`, role, isActive, authProvider, permissionGroups, teamId: null };
  db.users.push(u);
  return u;
}
function seedGroup(name) {
  const g = { id: ++nextId, name, permissions: ['tickets.view'] };
  db.groups.push(g);
  return g;
}

describe('PATCH /users/:id — changement de rôle de bout en bout', () => {
  let patchHandler;

  beforeAll(() => {
    patchHandler = getHandler('patch', '/:id');
  });

  beforeEach(() => {
    db.users.length = 0;
    db.groups.length = 0;
    jest.clearAllMocks();
    seedGroup('Équipe Hotline');     // groupe par défaut du rôle HOTLINE
    seedGroup('Techniciens');        // groupe par défaut du rôle TECHNICIAN
  });

  test('SUPERADMIN promeut REQUESTER → TECHNICIAN : rôle écrit + groupe déplacé + socket émis', async () => {
    const admin = seedUser({ role: 'SUPERADMIN' });
    const target = seedUser({ role: 'REQUESTER' });

    const res = makeRes();
    await patchHandler(makeReq({ user: admin, params: { id: String(target.id) }, body: { role: 'TECHNICIAN' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.role).toBe('TECHNICIAN');
    // eslint-disable-next-line no-console
  console.log('PG calls:', JSON.stringify(prisma.permissionGroup.findUnique.mock.calls));
    // eslint-disable-next-line no-console
  console.log('UPD data:', JSON.stringify(prisma.user.update.mock.calls.map((c) => c[0].data)));

    // Vérité en base : rôle changé…
    const inDb = db.users.find((u) => u.id === target.id);
    expect(inDb.role).toBe('TECHNICIAN');
    // …et groupe de droits aligné sur le nouveau rôle
    expect(inDb.permissionGroups.map((g) => g.name)).toEqual(['Techniciens']);
    // La session de l'utilisateur est notifiée en direct
    expect(emitUserUpdated).toHaveBeenCalledWith(target.id);
  });

  test('Rétrogradation TECHNICIAN → REQUESTER : les droits technicien sont retirés (pas de privilège résiduel)', async () => {
    const admin = seedUser({ role: 'SUPERADMIN' });
    const techGroup = db.groups.find((g) => g.name === 'Techniciens');
    const target = seedUser({ role: 'TECHNICIAN', permissionGroups: [{ id: techGroup.id, name: 'Techniciens' }] });

    const res = makeRes();
    await patchHandler(makeReq({ user: admin, params: { id: String(target.id) }, body: { role: 'REQUESTER' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.role).toBe('REQUESTER');
    const inDb = db.users.find((u) => u.id === target.id);
    expect(inDb.role).toBe('REQUESTER');
    expect(inDb.permissionGroups).toEqual([]); // plus aucun droit technicien résiduel
  });

  test('Promotion vers HOTLINE déplace dans le groupe « Équipe Hotline »', async () => {
    const admin = seedUser({ role: 'SUPERADMIN' });
    const target = seedUser({ role: 'REQUESTER' });

    const res = makeRes();
    await patchHandler(makeReq({ user: admin, params: { id: String(target.id) }, body: { role: 'HOTLINE' } }), res);

    expect(res.statusCode).toBe(200);
    const inDb = db.users.find((u) => u.id === target.id);
    expect(inDb.role).toBe('HOTLINE');
    expect(inDb.permissionGroups.map((g) => g.name)).toEqual(['Équipe Hotline']);
  });

  test('ADMIN ne peut pas attribuer le rôle ADMIN (403)', async () => {
    const admin = seedUser({ role: 'ADMIN' });
    const target = seedUser({ role: 'REQUESTER' });

    const res = makeRes();
    await patchHandler(makeReq({ user: admin, params: { id: String(target.id) }, body: { role: 'ADMIN' } }), res);

    expect(res.statusCode).toBe(403);
    const inDb = db.users.find((u) => u.id === target.id);
    expect(inDb.role).toBe('REQUESTER'); // inchangé
  });

  test('ADMIN ne peut pas modifier un compte ADMIN existant (403)', async () => {
    const admin = seedUser({ role: 'ADMIN' });
    const otherAdmin = seedUser({ role: 'ADMIN' });

    const res = makeRes();
    await patchHandler(makeReq({ user: admin, params: { id: String(otherAdmin.id) }, body: { role: 'TECHNICIAN' } }), res);

    expect(res.statusCode).toBe(403);
    expect(db.users.find((u) => u.id === otherAdmin.id).role).toBe('ADMIN');
  });

  test('Groupe par défaut absent : le changement de rôle réussit quand même (best effort)', async () => {
    const admin = seedUser({ role: 'SUPERADMIN' });
    const target = seedUser({ role: 'REQUESTER' });
    db.groups.length = 0; // plus aucun groupe en base

    const res = makeRes();
    await patchHandler(makeReq({ user: admin, params: { id: String(target.id) }, body: { role: 'TECHNICIAN' } }), res);

    expect(res.statusCode).toBe(200);
    expect(db.users.find((u) => u.id === target.id).role).toBe('TECHNICIAN');
  });
});
