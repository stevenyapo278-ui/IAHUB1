const prisma = require('../prismaClient');

// File de retry des actions de synchro GLPI différées (ex. clôture validée par la Hotline mais
// GLPI indisponible à ce moment). Rejouées périodiquement (server.js) avec backoff exponentiel,
// jusqu'à maxAttempts (au-delà, la ligne reste tracée pour investigation manuelle).
const DEFAULT_MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 5 * 60 * 1000; // 5 min, multiplié par le nombre de tentatives

// Ajoute (ou réactive si déjà présente) une action en attente de rejeu.
async function enqueueGlpiSyncRetry({ entityType, entityId, action, lastError, maxAttempts = DEFAULT_MAX_ATTEMPTS }) {
  const existing = await prisma.glpiSyncRetry.findFirst({
    where: { entityType, entityId, action },
    orderBy: { id: 'desc' },
  });
  if (existing && existing.attempts >= existing.maxAttempts) {
    return existing; // épuisé : on ne re-pile pas, l'erreur reste tracée pour investigation
  }
  return prisma.glpiSyncRetry.upsert({
    where: { id: existing?.id || -1 },
    update: {
      lastError,
      nextRetryAt: new Date(Date.now() + BASE_BACKOFF_MS * (existing?.attempts || 0)),
    },
    create: {
      entityType,
      entityId,
      action,
      lastError,
      maxAttempts,
      nextRetryAt: new Date(Date.now() + BASE_BACKOFF_MS),
    },
  });
}

// Rejoue les actions échues. Retourne { replayed, failed } pour les logs de santé.
async function processGlpiSyncRetries({ now = new Date() } = {}) {
  const pending = await prisma.glpiSyncRetry.findMany({
    where: { nextRetryAt: { lte: now } },
    orderBy: { id: 'asc' },
    take: 20,
  });

  const result = { replayed: 0, failed: 0 };
  const { updateGlpiTicket } = require('./glpiTicketCreator');

  for (const retry of pending) {
    // uniquement les actions de statut de ticket rejouables pour l'instant
    if (retry.entityType !== 'Ticket' || !retry.action.startsWith('status:')) {
      result.failed += 1;
      continue;
    }
    const status = retry.action.replace('status:', '');
    try {
      await updateGlpiTicket(retry.entityId, { status });
      await prisma.glpiSyncRetry.delete({ where: { id: retry.id } });
      result.replayed += 1;
    } catch (err) {
      const attempts = retry.attempts + 1;
      await prisma.glpiSyncRetry.update({
        where: { id: retry.id },
        data: {
          attempts,
          lastError: err.message,
          nextRetryAt: new Date(Date.now() + BASE_BACKOFF_MS * attempts),
        },
      });
      result.failed += 1;
    }
  }

  return result;
}

module.exports = { enqueueGlpiSyncRetry, processGlpiSyncRetries, DEFAULT_MAX_ATTEMPTS, BASE_BACKOFF_MS };