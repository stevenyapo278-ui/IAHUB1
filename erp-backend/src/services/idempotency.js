// ── Idempotence des actions à effet externe ──────────────────────────────
// Objectif : une action déjà exécutée (email envoyé, ticket créé par l'agent, rapport
// expédié) ne doit JAMAIS être rejouée — ni par un double clic, ni par un retry réseau,
// ni par un crash survenu entre l'effet externe et la mise à jour du statut, ni après
// restauration d'une sauvegarde.
//
// Fonctionnement : une clé déterministe `<scope>:<identifiant métier>` est insérée AVANT
// l'action (état IN_PROGRESS). Un second appel concurrent remonte un conflit 409 ; un appel
// après succès rejoue la réponse mémorisée sans réexécuter le handler. Une clé déjà utilisée
// avec des paramètres différents est refusée (protection contre les collisions/abus).
const crypto = require('crypto');
const prisma = require('../prismaClient');
const { logger } = require('../utils/logger');

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours : couvre une restauration de sauvegarde
const STALE_IN_PROGRESS_MS = 10 * 60 * 1000; // au-delà, on considère le processus mort

class IdempotencyConflictError extends Error {
  constructor(message, code = 'IDEMPOTENCY_CONFLICT') {
    super(message);
    this.name = 'IdempotencyConflictError';
    this.statusCode = 409;
    this.code = code;
  }
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(stableStringify(payload ?? null)).digest('hex');
}

function buildKey(scope, key) {
  return `${scope}:${key}`;
}

/**
 * Exécute `handler` au plus une fois pour une clé donnée.
 *
 * @param {object} options
 * @param {string} options.scope   Portée fonctionnelle (ex. 'ai-draft-send', 'tool-call').
 * @param {string|number} options.key Identifiant métier déterministe.
 * @param {number} [options.userId]
 * @param {*} [options.payload]    Paramètres : deux appels de même clé avec des paramètres
 *                                 différents sont refusés (hash de requête).
 * @param {number} [options.ttlMs]
 * @param {Function} handler       Action à effet externe.
 * @returns {Promise<{replayed: boolean, value: *}>}
 */
async function runIdempotent(options, handler) {
  const {
    scope,
    key,
    userId = null,
    payload = null,
    ttlMs = DEFAULT_TTL_MS,
  } = options || {};

  if (!scope || key === undefined || key === null || key === '') {
    throw new Error('runIdempotent : scope et key sont obligatoires');
  }

  const recordKey = buildKey(scope, key);
  const requestHash = hashPayload(payload);
  const now = new Date();

  const existing = await prisma.idempotencyRecord.findUnique({ where: { key: recordKey } });

  if (existing) {
    if (existing.expiresAt <= now) {
      await prisma.idempotencyRecord.deleteMany({ where: { key: recordKey } });
    } else {
      if (existing.requestHash !== requestHash) {
        throw new IdempotencyConflictError(
          'Une action différente a déjà été exécutée avec cette clé d’idempotence.'
        );
      }
      if (existing.state === 'COMPLETED') {
        return { replayed: true, value: existing.responseBody?.value ?? null };
      }
      if (existing.state === 'IN_PROGRESS' && now.getTime() - existing.updatedAt.getTime() < STALE_IN_PROGRESS_MS) {
        throw new IdempotencyConflictError('Cette action est déjà en cours d’exécution.', 'IDEMPOTENCY_IN_PROGRESS');
      }
      // IN_PROGRESS périmé (processus interrompu) ou FAILED : on reprend la main.
      const claimed = await prisma.idempotencyRecord.updateMany({
        where: { id: existing.id, state: existing.state, requestHash },
        data: { state: 'IN_PROGRESS', updatedAt: now, expiresAt: new Date(now.getTime() + ttlMs) },
      });
      if (claimed.count !== 1) {
        throw new IdempotencyConflictError('Cette action est déjà en cours d’exécution.', 'IDEMPOTENCY_IN_PROGRESS');
      }
      return executeAndStore({ recordKey, requestHash, handler, ttlMs });
    }
  }

  try {
    await prisma.idempotencyRecord.create({
      data: {
        key: recordKey,
        scope,
        userId: userId === null ? null : Number(userId),
        requestHash,
        state: 'IN_PROGRESS',
        expiresAt: new Date(now.getTime() + ttlMs),
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      // Course entre deux instances : l'autre a gagné, on retombe sur la lecture.
      return runIdempotent(options, handler);
    }
    throw err;
  }

  return executeAndStore({ recordKey, requestHash, handler, ttlMs });
}

async function executeAndStore({ recordKey, requestHash, handler, ttlMs }) {
  const now = new Date();
  try {
    const value = await handler();
    await prisma.idempotencyRecord.updateMany({
      where: { key: recordKey, requestHash },
      data: {
        state: 'COMPLETED',
        responseBody: { value: value === undefined ? null : value },
        expiresAt: new Date(now.getTime() + ttlMs),
      },
    });
    return { replayed: false, value };
  } catch (err) {
    // L'action a échoué : on autorise une nouvelle tentative en libérant la clé.
    await prisma.idempotencyRecord
      .updateMany({ where: { key: recordKey, requestHash }, data: { state: 'FAILED' } })
      .catch((dbErr) => logger.warn(`[idempotency] Libération impossible : ${dbErr.message}`));
    throw err;
  }
}

/**
 * Purge des enregistrements expirés (appelée par le scheduler de purge).
 */
async function cleanupExpiredIdempotency() {
  const deleted = await prisma.idempotencyRecord.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  if (deleted.count > 0) {
    logger.info(`[idempotency] ${deleted.count} enregistrement(s) expiré(s) purgé(s)`);
  }
  return deleted.count;
}

module.exports = {
  IdempotencyConflictError,
  runIdempotent,
  hashPayload,
  cleanupExpiredIdempotency,
  DEFAULT_TTL_MS,
};
