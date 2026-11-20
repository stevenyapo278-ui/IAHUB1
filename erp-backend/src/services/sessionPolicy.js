const prisma = require('../prismaClient');

// ── Politique de session ────────────────────────────────────────────────────
// Source de vérité, par ordre de priorité :
//   1. réglage UI (Paramètres > Avancé > Sessions) — colonnes SystemSettings ;
//   2. variable d'environnement (AUTH_IDLE_TIMEOUT_MINUTES / AUTH_SESSION_MAX_HOURS) ;
//   3. défaut codé en dur (8 h d'inactivité, plafond absolu de 12 h).
//
// Les valeurs UI sont mises en cache 60 s en mémoire pour que les contrôles
// d'authentification (middleware, refresh, socket) restent synchrones et rapides.
// Le cache est réécrit immédiatement après un PATCH /advanced-settings, et un
// redémarrage n'est donc jamais nécessaire. Le TTL permet aux autres instances
// backend de finir par voir le changement.

const DEFAULT_IDLE_TIMEOUT_MINUTES = 480; // 8 h
const DEFAULT_SESSION_MAX_HOURS = 12;
const CACHE_TTL_MS = 60 * 1000;

// 10 ans : valeur « infinie » assez grande pour une Date valide et un cookie
// dont le maxAge reste représentable (utilisée quand le plafond est désactivé).
const UNLIMITED_SESSION_MS = 10 * 365 * 24 * 60 * 60 * 1000;

let uiValues = { idleTimeoutMinutes: null, maxHours: null, loadedAt: 0 };
let inflight = null;

function parseEnvNumber(raw) {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  if (text === '') return null;
  const parsed = Number.parseFloat(text);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function envIdleTimeoutMinutes() {
  const parsed = parseEnvNumber(process.env.AUTH_IDLE_TIMEOUT_MINUTES);
  return parsed === null ? DEFAULT_IDLE_TIMEOUT_MINUTES : parsed;
}

function envSessionMaxHours() {
  const parsed = parseEnvNumber(process.env.AUTH_SESSION_MAX_HOURS);
  return parsed === null ? DEFAULT_SESSION_MAX_HOURS : parsed;
}

// Une valeur UI valide est un entier >= 0 (0 = contrôle désactivé).
// `null` / `undefined` = aucune surcharge UI → on retombe sur l'environnement.
function normalizeUiValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

async function refreshSessionPolicy() {
  if (inflight) return inflight;
  inflight = (async () => {
    // Pas de base configurée (tests unitaires, scripts) : on reste sur env/défaut
    // sans tenter de connexion Prisma.
    if (!process.env.DATABASE_URL) {
      uiValues = { ...uiValues, loadedAt: Date.now() };
      return uiValues;
    }
    try {
      // Optional chaining : les tests unitaires mockent un client Prisma partiel.
      const row = (await prisma.systemSettings?.findUnique?.({
        where: { id: 1 },
        select: { sessionIdleTimeoutMinutes: true, sessionMaxHours: true },
      })) ?? null;
      uiValues = {
        idleTimeoutMinutes: row?.sessionIdleTimeoutMinutes ?? null,
        maxHours: row?.sessionMaxHours ?? null,
        loadedAt: Date.now(),
      };
    } catch {
      // Base indisponible : on conserve les dernières valeurs connues (ou le
      // fallback environnement/défaut) et on ne réessaiera qu'après le TTL.
      uiValues = { ...uiValues, loadedAt: Date.now() };
    }
    return uiValues;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

// Recharge en arrière-plan quand le cache a expiré, sans bloquer l'appelant.
function ensureFresh() {
  if (inflight) return;
  if (uiValues.loadedAt && Date.now() - uiValues.loadedAt < CACHE_TTL_MS) return;
  refreshSessionPolicy().catch(() => {});
}

// Résout la politique effective (UI > env > défaut). Synchrone : utilisable
// directement dans les comparaisons du middleware d'authentification.
function getSessionPolicy() {
  ensureFresh();
  const uiIdle = normalizeUiValue(uiValues.idleTimeoutMinutes);
  const uiMax = normalizeUiValue(uiValues.maxHours);
  return {
    idleTimeoutMinutes: uiIdle === null ? envIdleTimeoutMinutes() : uiIdle,
    maxHours: uiMax === null ? envSessionMaxHours() : uiMax,
    idleSource: uiIdle === null ? 'env' : 'ui',
    maxSource: uiMax === null ? 'env' : 'ui',
    defaults: {
      idleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MINUTES,
      maxHours: DEFAULT_SESSION_MAX_HOURS,
    },
  };
}

// Applique immédiatement les valeurs renvoyées par un PATCH /advanced-settings
// (évite d'attendre le prochain TTL, y compris pour la session en cours).
function applySessionPolicy(settings) {
  uiValues = {
    idleTimeoutMinutes: settings?.sessionIdleTimeoutMinutes ?? null,
    maxHours: settings?.sessionMaxHours ?? null,
    loadedAt: Date.now(),
  };
}

function getIdleTimeoutMinutes() {
  return getSessionPolicy().idleTimeoutMinutes;
}

function getSessionMaxHours() {
  return getSessionPolicy().maxHours;
}

// 0 = pas de contrôle d'inactivité. `Infinity` rend toutes les comparaisons
// `now - lastActivityAt > seuil` fausses, sans branche supplémentaire.
function getIdleTimeoutMs() {
  const minutes = getIdleTimeoutMinutes();
  return minutes <= 0 ? Number.POSITIVE_INFINITY : minutes * 60 * 1000;
}

// 0 = pas de plafond absolu : on renvoie une durée très grande (10 ans) pour
// que `new Date(...)`, `expiresAt` et le cookie restent valides.
function getSessionMaxAgeMs() {
  const hours = getSessionMaxHours();
  return hours <= 0 ? UNLIMITED_SESSION_MS : hours * 60 * 60 * 1000;
}

module.exports = {
  DEFAULT_IDLE_TIMEOUT_MINUTES,
  DEFAULT_SESSION_MAX_HOURS,
  UNLIMITED_SESSION_MS,
  getSessionPolicy,
  applySessionPolicy,
  refreshSessionPolicy,
  getIdleTimeoutMinutes,
  getSessionMaxHours,
  getIdleTimeoutMs,
  getSessionMaxAgeMs,
};
