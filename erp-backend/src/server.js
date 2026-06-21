require('dotenv').config();
const app = require('./app');
const { syncAllProviders } = require('./utils/modelSync');
const { syncGlpiTickets } = require('./utils/glpiSync');
const { runEmailPipeline } = require('./services/emailPipeline');
const { syncTeamsFromGlpi, syncCategoriesFromGlpi } = require('./services/glpiTicketCreator');
const { getSystemSettings } = require('./services/systemSettings');
const { runDraftReminderScheduler } = require('./services/draftReminderScheduler');

const PORT = process.env.PORT || 4000;
const FALLBACK_CHECK_DELAY_MS = 60 * 1000; // si l'intervalle configuré est 0 (désactivé), on revérifie le réglage chaque minute
const DRAFT_REMINDER_CHECK_INTERVAL_MS = 5 * 60 * 1000; // vérifie toutes les 5 min quels brouillons dépassent le délai configuré (draftReminderDelayMinutes)

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
function scheduleSync(name, syncFn, getIntervalSeconds) {
  async function tick() {
    let intervalSeconds = 0;
    try {
      const settings = await getSystemSettings();
      intervalSeconds = getIntervalSeconds(settings);
      if (intervalSeconds > 0) {
        await syncFn();
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
runDraftReminderScheduler().catch((err) => console.error('Erreur relance brouillons IA:', err));
setInterval(() => {
  runDraftReminderScheduler().catch((err) => console.error('Erreur relance brouillons IA:', err));
}, DRAFT_REMINDER_CHECK_INTERVAL_MS);
