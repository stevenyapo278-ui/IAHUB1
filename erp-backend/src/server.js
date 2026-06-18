require('dotenv').config();
const app = require('./app');
const { syncAllProviders } = require('./utils/modelSync');
const { syncGlpiTickets } = require('./utils/glpiSync');

const PORT = process.env.PORT || 4000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

app.listen(PORT, () => {
  console.log(`ERP backend listening on port ${PORT}`);
});

// Synchronisation quotidienne automatique des modèles IA disponibles
setInterval(() => {
  syncAllProviders().catch((err) => console.error('Erreur synchro modèles IA:', err));
}, ONE_DAY_MS);

// Synchronisation périodique des tickets GLPI
setInterval(() => {
  syncGlpiTickets().catch((err) => console.error('Erreur synchro GLPI:', err));
}, FIVE_MINUTES_MS);
