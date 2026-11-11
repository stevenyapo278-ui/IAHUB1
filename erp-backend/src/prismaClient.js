const { PrismaClient } = require('@prisma/client');
const { encryptSecret, decryptSecret } = require('./utils/secretsCrypto');

const prisma = new PrismaClient();

// ── Chiffrement transparent des secrets au repos ──────────────────────────
// Les routes et services continuent de lire/écrire des valeurs en clair : le middleware
// chiffre avant l'écriture et déchiffre après la lecture. Une fuite de dump PostgreSQL
// n'expose donc plus directement les clés API, tokens GLPI ou secrets OAuth.
//
// Les valeurs historiques non préfixées (« enc:v1: » absent) restent lisibles : la migration
// scripts/encryptSecrets.js les convertit progressivement.
const SECRET_FIELDS = {
  ApiConfig: ['apiKey'],
  AiKey: ['apiKey'],
  EmailAccount: ['clientSecret', 'refreshToken', 'password'],
};

function encryptSecretData(model, data) {
  if (!data || typeof data !== 'object') return data;
  const copy = { ...data };

  for (const field of SECRET_FIELDS[model]) {
    if (typeof copy[field] === 'string' && copy[field] !== '') {
      copy[field] = encryptSecret(copy[field]);
    }
  }

  // ApiConfig : le token GLPI « App Token » vit dans la colonne JSON `extra`.
  if (model === 'ApiConfig' && copy.extra && typeof copy.extra === 'object' && !Array.isArray(copy.extra)) {
    copy.extra = { ...copy.extra };
    if (typeof copy.extra.appToken === 'string' && copy.extra.appToken !== '') {
      copy.extra.appToken = encryptSecret(copy.extra.appToken);
    }
  }

  return copy;
}

function decryptSecretRow(model, row) {
  if (!row || typeof row !== 'object') return row;
  if (Array.isArray(row)) return row.map((r) => decryptSecretRow(model, r));

  const copy = { ...row };
  for (const field of SECRET_FIELDS[model]) {
    if (typeof copy[field] === 'string' && copy[field] !== '') {
      copy[field] = decryptSecret(copy[field]);
    }
  }
  if (model === 'ApiConfig' && copy.extra && typeof copy.extra === 'object' && !Array.isArray(copy.extra)) {
    copy.extra = { ...copy.extra };
    if (typeof copy.extra.appToken === 'string' && copy.extra.appToken !== '') {
      copy.extra.appToken = decryptSecret(copy.extra.appToken);
    }
  }
  return copy;
}

prisma.$use(async (params, next) => {
  const model = params.model;
  if (!model || !SECRET_FIELDS[model]) return next(params);

  const { action, args } = params;
  const writeActions = new Set(['create', 'update', 'upsert', 'updateMany', 'createMany']);
  if (writeActions.has(action) && args) {
    if (Array.isArray(args.data)) {
      args.data = args.data.map((d) => encryptSecretData(model, d));
    } else if (args.data) {
      args.data = encryptSecretData(model, args.data);
    }
    if (action === 'upsert') {
      if (args.create) args.create = encryptSecretData(model, args.create);
      if (args.update) args.update = encryptSecretData(model, args.update);
    }
  }

  const result = await next(params);
  return decryptSecretRow(model, result);
});

module.exports = prisma;
