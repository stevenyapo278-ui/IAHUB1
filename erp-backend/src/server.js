require('dotenv').config();
const app = require('./app');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { initSocket } = require('./utils/socket');
const { syncAllProviders } = require('./utils/modelSync');
const { syncGlpiTickets } = require('./utils/glpiSync');
const { runEmailPipeline } = require('./services/emailPipeline');
const { syncTeamsFromGlpi, syncCategoriesFromGlpi, syncLocationsFromGlpi, syncUsersFromGlpi, syncAssetsFromGlpi } = require('./services/glpiTicketCreator');
const { getSystemSettings } = require('./services/systemSettings');
const { runDraftReminderScheduler } = require('./services/draftReminderScheduler');
const { runReminderScheduler } = require('./services/reminderScheduler');
const { checkAndSendDailySummary } = require('./services/dailySummary');
const { withHealthTracking } = require('./services/schedulerHealth');
const { seedPermissionGroups } = require('./services/permissionGroupSeeder');
const { runSlaMonitor } = require('./services/slaService');
const { runDueDateMonitor } = require('./services/dueDateService');
const { logger } = require('./utils/logger');

// Validation des variables d'environnement critiques au démarrage
const REQUIRED_ENV_VARS = ['JWT_SECRET', 'DATABASE_URL'];
const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  logger.error(`Variables d'environnement manquantes : ${missing.join(', ')}`);
  logger.error('Copiez .env.example vers .env et remplissez les valeurs requises.');
  process.exit(1);
}

const PORT = process.env.PORT || 4000;

// Vérifications supplémentaires non-bloquantes
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  logger.warn('JWT_SECRET est court (< 16 caractères) — utilisez une chaîne longue et aléatoire en production.');
}
if (process.env.CORS_ORIGIN === '*') {
  logger.warn('CORS_ORIGIN=* — restreignez ceci en production pour des raisons de sécurité.');
}
const FALLBACK_CHECK_DELAY_MS = 60 * 1000; // si l'intervalle configuré est 0 (désactivé), on revérifie le réglage chaque minute
const DRAFT_REMINDER_CHECK_INTERVAL_MS = 5 * 60 * 1000; // vérifie toutes les 5 min quels brouillons dépassent le délai configuré (draftReminderDelayMinutes)
const TICKET_REMINDER_CHECK_INTERVAL_MS = 60 * 60 * 1000; // vérifie toutes les heures quels tickets WAITING_FOR_USER dépassent les délais de ReminderConfig (en jours, donc pas besoin d'une fréquence plus fine)
const DAILY_SUMMARY_CHECK_INTERVAL_MS = 60 * 1000; // vérifie chaque minute si l'heure configurée (dailySummaryTime, ex "18:00") est atteinte

// TLS optionnel : si TLS_CERT_PATH et TLS_KEY_PATH pointent vers des fichiers existants,
// le serveur écoute en HTTPS, sinon il retombe en HTTP (développement local).
const tlsCertPath = process.env.TLS_CERT_PATH;
const tlsKeyPath = process.env.TLS_KEY_PATH;
let server;
let protocol = 'http';
if (tlsCertPath && tlsKeyPath && fs.existsSync(tlsCertPath) && fs.existsSync(tlsKeyPath)) {
  try {
    server = https.createServer(
      { cert: fs.readFileSync(tlsCertPath), key: fs.readFileSync(tlsKeyPath) },
      app
    );
    protocol = 'https';
    logger.info(`HTTPS activé — certificat : ${tlsCertPath}`);
  } catch (err) {
    logger.error(`Impossible de charger le certificat TLS, retour en HTTP : ${err.message}`);
    server = http.createServer(app);
  }
} else {
  server = http.createServer(app);
}
initSocket(server);

server.listen(PORT, () => {
  logger.info(`Backend ERP démarré (${protocol}) sur le port ${PORT}`);
  seedPermissionGroups().catch((err) => logger.error(`[Seeder] Error seeding permission groups: ${err.message}`));
  if (process.env.NODE_ENV === 'production') {
    logger.info(`Frontend attendu sur : ${process.env.FRONTEND_URL || 'http://localhost:' + PORT}`);
  }
});

async function syncGlpiTeamsAndCategories() {
  await syncTeamsFromGlpi();
  await syncCategoriesFromGlpi();
  await syncUsersFromGlpi();
}

async function syncGlpiLocationsOnly() {
  await syncLocationsFromGlpi();
}

async function syncGlpiAssetsOnly() {
  await syncAssetsFromGlpi();
}

// Lance périodiquement `syncFn`, en relisant à chaque cycle la fréquence configurée via
// `getIntervalSeconds(settings)` (Paramètres > Automatisation > Fréquences de synchronisation).
// Un changement dans l'UI s'applique donc au prochain cycle, sans redémarrer le serveur.
// intervalSeconds <= 0 = synchro auto désactivée pour cette tâche (les boutons manuels restent disponibles).
// Chaque exécution est suivie via withHealthTracking : 3 échecs consécutifs déclenchent un email
// d'alerte aux admins (cooldown 6h), au lieu de ne laisser la trace que dans les logs serveur.
function scheduleSync(name, syncFn, getIntervalSeconds) {
  const trackedSyncFn = withHealthTracking(name, syncFn);
  async function tick() {
    let intervalSeconds = 0;
    try {
      const settings = await getSystemSettings();
      intervalSeconds = getIntervalSeconds(settings);
      if (intervalSeconds > 0) {
        await trackedSyncFn();
      }
    } catch (err) {
      logger.error(`Erreur synchro ${name}:`, { error: err.message, stack: err.stack });
    } finally {
      const nextDelayMs = intervalSeconds > 0 ? intervalSeconds * 1000 : FALLBACK_CHECK_DELAY_MS;
      setTimeout(tick, nextDelayMs);
    }
  }
  tick();
}

scheduleSync('tickets GLPI', syncGlpiTickets, (s) => s.glpiTicketsSyncIntervalSeconds);
scheduleSync('emails entrants', runEmailPipeline, (s) => s.emailSyncIntervalSeconds);
scheduleSync('équipes/catégories GLPI', syncGlpiTeamsAndCategories, (s) => s.glpiTeamsCategoriesSyncIntervalMinutes * 60);
scheduleSync('lieux GLPI', syncGlpiLocationsOnly, (s) => s.glpiLocationsSyncIntervalMinutes * 60);
scheduleSync('assets GLPI', syncGlpiAssetsOnly, () => 24 * 3600);
scheduleSync('modèles IA', syncAllProviders, (s) => s.aiModelsSyncIntervalHours * 3600);

// File de retry GLPI : rejoue les actions différées qui ont échoué (ex. clôture validée par la
// Hotline pendant une indisponibilité GLPI) — toutes les 5 minutes, backoff exponentiel interne.
const { processGlpiSyncRetries } = require('./services/glpiSyncRetry');
scheduleSync('retry GLPI', processGlpiSyncRetries, () => 300);

// Santé des suggestions de clôture : si le taux d'acceptation par la Hotline passe sous 50 %
// sur la fenêtre de 30 jours (3 contrôles consécutifs), alerte email aux admins — la détection
// de résolution IA dérive et chaque faux positif coûte du temps humain.
async function checkClosureSuggestionHealth() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const groups = await prisma.ticketEvent.groupBy({
    by: ['type'],
    where: { createdAt: { gte: since }, type: { in: ['CLOSURE_VALIDATED', 'CLOSURE_REJECTED'] } },
    _count: { _all: true },
  });
  const validated = groups.find((g) => g.type === 'CLOSURE_VALIDATED')?._count._all || 0;
  const rejected = groups.find((g) => g.type === 'CLOSURE_REJECTED')?._count._all || 0;
  const total = validated + rejected;
  if (total >= 5 && validated / total < 0.5) {
    throw new Error(
      `Taux d'acceptation des clôtures suggérées sous 50 % sur 30 j (${validated}/${total} acceptées). Vérifier la classification IA (prompt analyzeIntent, fournisseur IA).`
    );
  }
}
scheduleSync('santé suggestions de clôture', checkClosureSuggestionHealth, () => 6 * 3600);

// Moteur SLA (outil de ticketing) : détecte les dépassements de délai de réponse des tickets
// actifs et notifie (socket + notification persistée + email au technicien assigné).
// Fréquence configurable dans Paramètres > Automatisation (slaMonitorIntervalSeconds, 0 = désactivé).
scheduleSync('SLA', runSlaMonitor, (s) => s.slaMonitorIntervalSeconds);

// Échéances manuelles des tickets (dueDate) : détecte les échéances dépassées et notifie
// (socket + notification persistée + email au technicien). Fréquence configurable dans
// Paramètres > Automatisation (dueDateMonitorIntervalSeconds, 0 = désactivé).
scheduleSync('échéances tickets', runDueDateMonitor, (s) => s.dueDateMonitorIntervalSeconds);

// Relance des brouillons AiEmailDraft en attente (Paramètres > Automatisation > Relance des
// brouillons) — le délai d'attente avant relance est configurable, mais la vérification elle-même
// tourne à fréquence fixe (5 min) : c'est runDraftReminderScheduler qui décide, par brouillon,
// si le délai configuré est dépassé.
const trackedDraftReminder = withHealthTracking('relance brouillons IA', runDraftReminderScheduler);
trackedDraftReminder().catch((err) => logger.error('Erreur relance brouillons IA:', { error: err.message, stack: err.stack }));
setInterval(() => {
  trackedDraftReminder().catch((err) => logger.error('Erreur relance brouillons IA:', { error: err.message, stack: err.stack }));
}, DRAFT_REMINDER_CHECK_INTERVAL_MS);

// Relance des tickets WAITING_FOR_USER selon ReminderConfig (J+2/J+5/J+10/J+15) — moteur déjà
// existant et complet (relance, pré-clôture, clôture auto), mais jusqu'ici jamais déclenché
// automatiquement : seulement via le bouton manuel "Lancer le scheduler" (Paramètres > Automatisation).
const trackedTicketReminder = withHealthTracking('relance tickets en attente', runReminderScheduler);
trackedTicketReminder().catch((err) => logger.error('Erreur relance tickets en attente:', { error: err.message, stack: err.stack }));
setInterval(() => {
  trackedTicketReminder().catch((err) => logger.error('Erreur relance tickets en attente:', { error: err.message, stack: err.stack }));
}, TICKET_REMINDER_CHECK_INTERVAL_MS);

// Récapitulatif quotidien des tickets ouverts (Paramètres > Automatisation > Récapitulatif
// quotidien) — vérifie chaque minute si l'heure configurée est atteinte, ne déclenche l'envoi
// qu'une fois par jour (dailySummaryLastSentDate empêche les renvois si le serveur tourne plus
// d'une minute pendant l'heure cible, ou redémarre le même jour après l'heure prévue).
const trackedDailySummary = withHealthTracking('récapitulatif quotidien', checkAndSendDailySummary);
setInterval(() => {
  trackedDailySummary().catch((err) => logger.error('Erreur récapitulatif quotidien:', { error: err.message, stack: err.stack }));
}, DAILY_SUMMARY_CHECK_INTERVAL_MS);
