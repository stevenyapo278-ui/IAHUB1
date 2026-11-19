#!/usr/bin/env node
/**
 * Mise en place de Budibase comme miroir des déclarations de comptes applicatifs.
 *
 *   node scripts/setupBudibase.js
 *
 * Le script est idempotent : il réutilise l'application et la table existantes,
 * et ne recrée que ce qui manque. Il affiche à la fin les valeurs à saisir dans
 * « Paramètres → Autres intégrations → Budibase ».
 *
 * Variables d'environnement (ou erp-backend/.env) :
 *   BUDIBASE_URL       défaut : http://localhost:10000
 *   BUDIBASE_EMAIL     compte admin du builder
 *   BUDIBASE_PASSWORD  mot de passe du compte admin
 *   BUDIBASE_APP_NAME  défaut : Comptes applicatifs
 *   BUDIBASE_TABLE     défaut : declarations
 *
 * Piège v4.0.1 : la validation de ligne utilise validate.js, qui ne connaît pas les
 * types `json` ni `datetime`. Les contraintes de ces colonnes doivent donc être
 * réduites à { presence: false }, sinon l'insertion renvoie
 * « validate.validators.type.types.<type> must be a function ».
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const BASE_URL = String(process.env.BUDIBASE_URL || 'http://localhost:10000').replace(/\/+$/, '');
const EMAIL = process.env.BUDIBASE_EMAIL || '';
const PASSWORD = process.env.BUDIBASE_PASSWORD || '';
const APP_NAME = process.env.BUDIBASE_APP_NAME || 'Comptes applicatifs';
const TABLE_NAME = process.env.BUDIBASE_TABLE || 'declarations';

let cookies = '';

async function api(path, { method = 'GET', body, appId } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookies) headers.Cookie = cookies;
  if (appId) headers['x-budibase-app-id'] = appId;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  if (setCookie.length > 0) cookies = setCookie.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

async function login() {
  if (!EMAIL || !PASSWORD) {
    throw new Error('BUDIBASE_EMAIL et BUDIBASE_PASSWORD sont requis.');
  }
  // Initialise le premier admin si l'instance est vierge (route publique unique).
  await api('/api/global/users/init', {
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD, tenantId: 'default' },
  }).catch(() => {});
  const res = await api('/api/global/auth/default/login', {
    method: 'POST',
    body: { username: EMAIL, password: PASSWORD },
  });
  if (!res.ok) throw new Error(`Connexion Budibase échouée (${res.status}).`);
}

async function ensureApp() {
  // `status=all` est indispensable : sans filtre, Budibase ne liste que les apps publiées.
  const res = await api('/api/applications?status=all');
  if (!res.ok) throw new Error(`Liste des applications indisponible (${res.status}).`);
  const existing = (res.data || []).find((app) => app.name === APP_NAME);
  if (existing) return existing.instance?._id || existing.appId;

  const created = await api('/api/applications', { method: 'POST', body: { name: APP_NAME } });
  if (!created.ok) throw new Error(`Création de l’application échouée (${created.status}).`);
  return created.data.appId;
}

function buildSchema() {
  const text = (name, presence = false) => ({
    name, type: 'string', constraints: { type: 'string', length: null, presence },
  });
  // JSON/datetime : surtout NE PAS mettre `type` dans les contraintes (bug v4.0.1).
  const json = (name) => ({ name, type: 'json', constraints: { presence: false } });
  const datetime = (name) => ({ name, type: 'datetime', constraints: { presence: false } });
  return {
    ticketTitle: text('ticketTitle', true),
    ticketId: { name: 'ticketId', type: 'number', constraints: { type: 'number', presence: false } },
    ticketStatus: text('ticketStatus'),
    applicationNames: text('applicationNames'),
    applications: json('applications'),
    accounts: json('accounts'),
    accountsCount: { name: 'accountsCount', type: 'number', constraints: { type: 'number', presence: false } },
    operations: json('operations'),
    hasRightsUpdate: { name: 'hasRightsUpdate', type: 'boolean', constraints: { type: 'boolean', presence: false } },
    source: text('source'),
    aiConfidence: { name: 'aiConfidence', type: 'number', constraints: { type: 'number', presence: false } },
    createdByEmail: text('createdByEmail'),
    declaredAt: datetime('declaredAt'),
    idempotencyKey: text('idempotencyKey'),
  };
}

async function ensureTable(appId) {
  const res = await api('/api/tables', { appId });
  if (!res.ok) throw new Error(`Liste des tables indisponible (${res.status}).`);
  const existing = (res.data || []).find((table) => table.name === TABLE_NAME);
  if (existing) {
    // Répare les schémas créés avec les contraintes fautives.
    const full = await api(`/api/tables/${existing._id}`, { appId });
    if (full.ok) {
      let changed = false;
      for (const key of ['applications', 'accounts', 'operations', 'declaredAt']) {
        const column = full.data.schema?.[key];
        if (column?.constraints?.type) {
          column.constraints = { ...column.constraints };
          delete column.constraints.type;
          changed = true;
        }
      }
      if (changed) await api('/api/tables', { method: 'POST', appId, body: full.data });
    }
    return existing._id;
  }

  const created = await api('/api/tables', {
    method: 'POST',
    appId,
    body: {
      name: TABLE_NAME,
      primaryDisplay: 'ticketTitle',
      schema: buildSchema(),
    },
  });
  if (!created.ok) throw new Error(`Création de la table échouée (${created.status}) : ${JSON.stringify(created.data).slice(0, 200)}`);
  return created.data._id;
}

async function ensureApiKey() {
  // Réutilise la clé existante : en régénérer une invaliderait la configuration ERP.
  const existing = await api('/api/global/self/api_key');
  if (existing.ok && existing.data?.apiKey) return existing.data.apiKey;

  const res = await api('/api/global/self/api_key', { method: 'POST' });
  if (!res.ok || !res.data?.apiKey) {
    throw new Error(`Génération de la clé API échouée (${res.status}).`);
  }
  return res.data.apiKey;
}

async function main() {
  console.log(`Budibase : ${BASE_URL}`);
  await login();
  console.log('  ✓ connecté');

  const appId = await ensureApp();
  console.log(`  ✓ application : ${appId}`);

  const tableId = await ensureTable(appId);
  console.log(`  ✓ table « ${TABLE_NAME} » : ${tableId}`);

  const apiKey = await ensureApiKey();
  console.log('  ✓ clé API générée');

  // Contrôle de bout en bout : insertion puis suppression d'une ligne de probe.
  const headers = {
    'Content-Type': 'application/json',
    'x-budibase-api-key': apiKey,
    'x-budibase-app-id': appId,
  };
  const probe = await fetch(`${BASE_URL}/api/public/v1/tables/${tableId}/rows`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ticketTitle: '__probe__', ticketId: 0 }),
  });
  if (!probe.ok) {
    const text = await probe.text().catch(() => '');
    throw new Error(`Écriture de test refusée (${probe.status}) : ${text.slice(0, 200)}`);
  }
  const row = await probe.json();
  const rowId = row?.data?._id;
  if (rowId) {
    await fetch(`${BASE_URL}/api/public/v1/tables/${tableId}/rows/${rowId}`, { method: 'DELETE', headers });
  }
  console.log('  ✓ écriture/lecture vérifiée');

  console.log('\nÀ saisir dans Paramètres → Autres intégrations → Budibase :');
  console.log(`  URL de base : ${BASE_URL}`);
  console.log(`  App ID      : ${appId}`);
  console.log(`  Table ID    : ${tableId}`);
  console.log(`  Clé API     : ${apiKey}`);
  console.log('  Chemin      : /api/public/v1/tables/{tableId}/rows');
  console.log('\nLa clé n’est affichée qu’une fois côté Budibase : copiez-la maintenant.');
}

main().catch((err) => {
  console.error(`\n[setupBudibase] ${err.message}`);
  process.exit(1);
});
