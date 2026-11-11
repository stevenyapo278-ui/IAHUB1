#!/usr/bin/env node
/**
 * Chiffrement des secrets existants en base (migration ponctuelle).
 *
 *   node scripts/encryptSecrets.js status
 *       → compte les secrets encore en clair (sans afficher les valeurs)
 *   node scripts/encryptSecrets.js encrypt
 *       → chiffre tous les secrets en clair avec SECRETS_ENCRYPTION_KEY
 *
 * Prérequis : SECRETS_ENCRYPTION_KEY doit être défini (32 octets, ex. openssl rand -base64 32)
 * dans l'environnement ou dans erp-backend/.env. Sauvegarder la base avant de lancer.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const prisma = require('../src/prismaClient');
const { isEncryptionEnabled, isEncrypted } = require('../src/utils/secretsCrypto');

async function status() {
  const [apiConfigs, aiKeys, emailAccounts] = await Promise.all([
    prisma.$queryRaw`SELECT id, "serviceName", "apiKey", extra FROM "ApiConfig"`,
    prisma.$queryRaw`SELECT id, label, "apiKey" FROM "AiKey"`,
    prisma.$queryRaw`SELECT id, "emailAddress", "clientSecret", "refreshToken", password FROM "EmailAccount"`,
  ]);

  const rows = [];
  for (const c of apiConfigs) {
    if (c.apiKey) rows.push({ table: 'ApiConfig', ref: `${c.serviceName} #${c.id}`, field: 'apiKey', encrypted: isEncrypted(c.apiKey) });
    const appToken = c.extra && typeof c.extra === 'object' ? c.extra.appToken : null;
    if (appToken) rows.push({ table: 'ApiConfig', ref: `${c.serviceName} #${c.id}`, field: 'extra.appToken', encrypted: isEncrypted(appToken) });
  }
  for (const k of aiKeys) {
    if (k.apiKey) rows.push({ table: 'AiKey', ref: `${k.label} #${k.id}`, field: 'apiKey', encrypted: isEncrypted(k.apiKey) });
  }
  for (const a of emailAccounts) {
    for (const field of ['clientSecret', 'refreshToken', 'password']) {
      if (a[field]) rows.push({ table: 'EmailAccount', ref: `${a.emailAddress} #${a.id}`, field, encrypted: isEncrypted(a[field]) });
    }
  }

  const plain = rows.filter((r) => !r.encrypted);
  console.log(`Clé de chiffrement : ${isEncryptionEnabled() ? 'présente' : 'ABSENTE'}`);
  console.log(`Secrets trouvés : ${rows.length} — en clair : ${plain.length} — chiffrés : ${rows.length - plain.length}`);
  for (const r of plain) console.log(`  ⚠️  ${r.table} ${r.ref} → ${r.field}`);
  return plain.length;
}

async function encryptAll() {
  if (!isEncryptionEnabled()) {
    throw new Error('SECRETS_ENCRYPTION_KEY est absent : impossible de chiffrer. Définissez la variable (openssl rand -base64 32).');
  }

  const apiConfigs = await prisma.apiConfig.findMany();
  for (const c of apiConfigs) {
    const hasAppToken = c.extra && typeof c.extra === 'object' && c.extra.appToken;
    if (c.apiKey || hasAppToken) {
      await prisma.apiConfig.update({
        where: { id: c.id },
        data: {
          ...(c.apiKey ? { apiKey: c.apiKey } : {}),
          ...(hasAppToken ? { extra: c.extra } : {}),
        },
      });
    }
  }

  const aiKeys = await prisma.aiKey.findMany();
  for (const k of aiKeys) {
    if (k.apiKey) await prisma.aiKey.update({ where: { id: k.id }, data: { apiKey: k.apiKey } });
  }

  const emailAccounts = await prisma.emailAccount.findMany();
  for (const a of emailAccounts) {
    const data = {};
    if (a.clientSecret) data.clientSecret = a.clientSecret;
    if (a.refreshToken) data.refreshToken = a.refreshToken;
    if (a.password) data.password = a.password;
    if (Object.keys(data).length) await prisma.emailAccount.update({ where: { id: a.id }, data });
  }

  console.log('✅ Secrets chiffrés. Vérifiez avec : node scripts/encryptSecrets.js status');
}

(async () => {
  const command = process.argv[2] || 'status';
  try {
    if (command === 'status') {
      const plain = await status();
      if (plain > 0) process.exitCode = 2;
    } else if (command === 'encrypt') {
      await encryptAll();
    } else {
      console.log('Commandes : status | encrypt');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
})();
