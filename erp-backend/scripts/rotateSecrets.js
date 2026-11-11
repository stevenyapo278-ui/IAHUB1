#!/usr/bin/env node
/**
 * Outillage de rotation des secrets — Projet IA Hub
 *
 * Ne stocke ni n'affiche jamais un secret en clair : les valeurs sont lues depuis
 * l'environnement et seules les 4 dernières caractères sont montrées dans l'inventaire.
 *
 * Commandes :
 *   node scripts/rotateSecrets.js list [--max-age-days 90]
 *   node scripts/rotateSecrets.js check [--max-age-days 90]
 *   node scripts/rotateSecrets.js rotate-glpi
 *       (GLPI_NEW_USER_TOKEN + GLPI_NEW_APP_TOKEN dans l'environnement)
 *   node scripts/rotateSecrets.js rotate-ai-key --key-id 3
 *       (AI_NEW_API_KEY dans l'environnement)
 *   node scripts/rotateSecrets.js revoke-sessions [--email user@exemple.ci | --all]
 *
 * Prérequis : DATABASE_URL valide (le .env du backend est chargé automatiquement).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const prisma = require('../src/prismaClient');

const MAX_AGE_DAYS_DEFAULT = 90;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function mask(secret) {
  if (!secret) return '—';
  if (secret.length <= 4) return '****';
  return `${'*'.repeat(Math.min(secret.length - 4, 8))}${secret.slice(-4)}`;
}

function ageDays(date) {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function formatAge(date) {
  const days = ageDays(date);
  if (days === null) return '—';
  return `${days} j`;
}

async function inventory() {
  const [apiConfigs, aiKeys, emailAccounts] = await Promise.all([
    prisma.apiConfig.findMany({ orderBy: { serviceName: 'asc' } }),
    prisma.aiKey.findMany({
      include: { provider: { select: { name: true } }, model: { select: { name: true } } },
      orderBy: { id: 'asc' },
    }),
    prisma.emailAccount.findMany({ orderBy: { id: 'asc' } }),
  ]);

  const rows = [];

  for (const c of apiConfigs) {
    rows.push({
      type: 'GLPI / intégration',
      ref: `${c.serviceName} (#${c.id})`,
      secret: `User Token ${mask(c.apiKey)}${c.extra?.appToken ? ` · App Token ${mask(c.extra.appToken)}` : ''}`,
      updatedAt: c.updatedAt,
    });
  }

  for (const k of aiKeys) {
    rows.push({
      type: 'Clé fournisseur IA',
      ref: `${k.provider?.name || k.providerId} / ${k.label} (#${k.id})${k.model?.name ? ` — ${k.model.name}` : ''}`,
      secret: mask(k.apiKey),
      updatedAt: k.updatedAt,
    });
  }

  for (const a of emailAccounts) {
    const parts = [];
    if (a.clientSecret) parts.push(`Client Secret ${mask(a.clientSecret)}`);
    if (a.password) parts.push(`Mot de passe ${mask(a.password)}`);
    if (a.refreshToken) parts.push(`Refresh token ${mask(a.refreshToken)}`);
    rows.push({
      type: 'Compte email',
      ref: `${a.emailAddress} (#${a.id})`,
      secret: parts.length ? parts.join(' · ') : '—',
      updatedAt: a.updatedAt,
    });
  }

  return rows;
}

async function cmdList(args) {
  const maxAge = Number(args['max-age-days']) || MAX_AGE_DAYS_DEFAULT;
  const rows = await inventory();
  if (rows.length === 0) {
    console.log('Aucun secret configuré en base.');
    return 0;
  }

  console.log(`Inventaire des secrets (seuil de rotation : ${maxAge} jours)\n`);
  console.log(`${'TYPE'.padEnd(24)} ${'RÉFÉRENCE'.padEnd(48)} ${'SECRET (masqué)'.padEnd(42)} MISE À JOUR`);
  console.log('-'.repeat(140));
  let stale = 0;
  for (const r of rows) {
    const days = ageDays(r.updatedAt);
    const flag = days !== null && days > maxAge ? ' ⚠️ À TOURNER' : '';
    if (flag) stale += 1;
    console.log(
      `${r.type.padEnd(24)} ${r.ref.slice(0, 48).padEnd(48)} ${r.secret.slice(0, 42).padEnd(42)} ${formatAge(r.updatedAt)}${flag}`
    );
  }
  console.log(`\n${rows.length} secret(s) — ${stale} dépassent ${maxAge} jours.`);
  return { stale, maxAge };
}

async function cmdCheck(args) {
  const result = await cmdList(args);
  if (result?.stale > 0) process.exitCode = 2;
}

async function testGlpiConnection(baseUrl, userToken, appToken) {
  if (!baseUrl) throw new Error('URL GLPI absente de la configuration');
  const url = baseUrl.replace(/\/+$/, '');
  const res = await fetch(`${url}/initSession`, {
    headers: { 'App-Token': appToken, Authorization: `user_token ${userToken}` },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.session_token) {
    throw new Error(`Test GLPI échoué (${res.status}) : ${Array.isArray(data) ? data[1] : 'réponse invalide'}`);
  }
  await fetch(`${url}/killSession`, {
    headers: { 'App-Token': appToken, 'Session-Token': data.session_token },
  }).catch(() => {});
}

async function cmdRotateGlpi() {
  const userToken = process.env.GLPI_NEW_USER_TOKEN;
  const appToken = process.env.GLPI_NEW_APP_TOKEN;
  if (!userToken || !appToken) {
    throw new Error('Définir GLPI_NEW_USER_TOKEN et GLPI_NEW_APP_TOKEN dans l’environnement.');
  }

  const config = await prisma.apiConfig.findUnique({ where: { serviceName: 'glpi' } });
  if (!config) throw new Error('Aucune configuration GLPI (serviceName="glpi") en base.');

  console.log('Test de la nouvelle paire de tokens auprès de GLPI…');
  await testGlpiConnection(config.baseUrl, userToken, appToken);

  await prisma.apiConfig.update({
    where: { id: config.id },
    data: {
      apiKey: userToken,
      extra: { ...(config.extra || {}), appToken },
    },
  });
  console.log('✅ Tokens GLPI (User Token + App Token) mis à jour après test réussi.');
  console.log('   Pense à supprimer les variables GLPI_NEW_* de l’environnement et à révoquer les anciens tokens dans GLPI.');
}

async function cmdRotateAiKey(args) {
  const keyId = Number(args['key-id']);
  const newKey = process.env.AI_NEW_API_KEY;
  if (!keyId || !newKey) {
    throw new Error('Usage : rotate-ai-key --key-id <id> avec AI_NEW_API_KEY dans l’environnement.');
  }
  const existing = await prisma.aiKey.findUnique({ where: { id: keyId } });
  if (!existing) throw new Error(`Clé IA #${keyId} introuvable.`);

  await prisma.aiKey.update({ where: { id: keyId }, data: { apiKey: newKey } });
  console.log(`✅ Clé IA #${keyId} (${existing.label}) mise à jour.`);
  console.log('   Révoque l’ancienne clé dans la console du fournisseur.');
}

async function cmdRevokeSessions(args) {
  const email = args.email;
  const all = args.all === true;
  if (!email && !all) {
    throw new Error('Préciser --email <adresse> ou --all (toutes les sessions).');
  }

  const where = { revokedAt: null };
  if (email) {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new Error(`Utilisateur ${email} introuvable.`);
    where.userId = user.id;
  }
  const result = await prisma.authSession.updateMany({ where, data: { revokedAt: new Date() } });
  console.log(`✅ ${result.count} session(s) révoquée(s).`);
  console.log('   Les requêtes API et les reconnexions socket seront refusées immédiatement.');
  console.log('   Pour couper AUSSI les sockets déjà ouvertes (process séparé), redémarre l’API après la révocation.');
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  try {
    switch (command) {
      case 'list':
        await cmdList(args);
        break;
      case 'check':
        await cmdCheck(args);
        break;
      case 'rotate-glpi':
        await cmdRotateGlpi();
        break;
      case 'rotate-ai-key':
        await cmdRotateAiKey(args);
        break;
      case 'revoke-sessions':
        await cmdRevokeSessions(args);
        break;
      default:
        console.log('Commandes : list | check | rotate-glpi | rotate-ai-key | revoke-sessions');
        process.exitCode = 1;
    }
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
})();
