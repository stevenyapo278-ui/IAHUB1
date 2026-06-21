require('dotenv').config();
const app = require('./app');
const { syncAllProviders } = require('./utils/modelSync');
const { syncGlpiTickets } = require('./utils/glpiSync');
const { runEmailPipeline } = require('./services/emailPipeline');
const { syncTeamsFromGlpi, syncCategoriesFromGlpi } = require('./services/glpiTicketCreator');
const { getSystemSettings } = require('./services/systemSettings');
const { runDraftReminderScheduler } = require('./services/draftReminderScheduler');
const { runReminderScheduler } = require('./services/reminderScheduler');
const { checkAndSendDailySummary } = require('./services/dailySummary');
const { withHealthTracking } = require('./services/schedulerHealth');

const PORT = process.env.PORT || 4000;
const FALLBACK_CHECK_DELAY_MS = 60 * 1000; // si l'intervalle configuré est 0 (désactivé), on revérifie le réglage chaque minute
const DRAFT_REMINDER_CHECK_INTERVAL_MS = 5 * 60 * 1000; // vérifie toutes les 5 min quels brouillons dépassent le délai configuré (draftReminderDelayMinutes)
const TICKET_REMINDER_CHECK_INTERVAL_MS = 60 * 60 * 1000; // vérifie toutes les heures quels tickets WAITING_FOR_USER dépassent les délais de ReminderConfig (en jours, donc pas besoin d'une fréquence plus fine)
const DAILY_SUMMARY_CHECK_INTERVAL_MS = 60 * 1000; // vérifie chaque minute si l'heure configurée (dailySummaryTime, ex "18:00") est atteinte

app.listen(PORT, () => {
  console.log(`ERP backend listening on port ${PORT}`);
});

async function syncGlpiTeamsAndCategories() {
  await syncTeamsFromGlpi();
  await syncCategoriesFromGlpi();
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
      console.error(`Erreur synchro ${name}:`, err);
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
scheduleSync('modèles IA', syncAllProviders, (s) => s.aiModelsSyncIntervalHours * 3600);

// Relance des brouillons AiEmailDraft en attente (Paramètres > Automatisation > Relance des
// brouillons) — le délai d'attente avant relance est configurable, mais la vérification elle-même
// tourne à fréquence fixe (5 min) : c'est runDraftReminderScheduler qui décide, par brouillon,
// si le délai configuré est dépassé.
const trackedDraftReminder = withHealthTracking('relance brouillons IA', runDraftReminderScheduler);
trackedDraftReminder().catch((err) => console.error('Erreur relance brouillons IA:', err));
setInterval(() => {
  trackedDraftReminder().catch((err) => console.error('Erreur relance brouillons IA:', err));
}, DRAFT_REMINDER_CHECK_INTERVAL_MS);

// Relance des tickets WAITING_FOR_USER selon ReminderConfig (J+2/J+5/J+10/J+15) — moteur déjà
// existant et complet (relance, pré-clôture, clôture auto), mais jusqu'ici jamais déclenché
// automatiquement : seulement via le bouton manuel "Lancer le scheduler" (Paramètres > Automatisation).
const trackedTicketReminder = withHealthTracking('relance tickets en attente', runReminderScheduler);
trackedTicketReminder().catch((err) => console.error('Erreur relance tickets en attente:', err));
setInterval(() => {
  trackedTicketReminder().catch((err) => console.error('Erreur relance tickets en attente:', err));
}, TICKET_REMINDER_CHECK_INTERVAL_MS);

// Récapitulatif quotidien des tickets ouverts (Paramètres > Automatisation > Récapitulatif
// quotidien) — vérifie chaque minute si l'heure configurée est atteinte, ne déclenche l'envoi
// qu'une fois par jour (dailySummaryLastSentDate empêche les renvois si le serveur tourne plus
// d'une minute pendant l'heure cible, ou redémarre le même jour après l'heure prévue).
const trackedDailySummary = withHealthTracking('récapitulatif quotidien', checkAndSendDailySummary);
setInterval(() => {
  trackedDailySummary().catch((err) => console.error('Erreur récapitulatif quotidien:', err));
}, DAILY_SUMMARY_CHECK_INTERVAL_MS);
