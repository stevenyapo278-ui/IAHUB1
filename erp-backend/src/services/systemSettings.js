const prisma = require('../prismaClient');

// Lit toujours en base (pas de cache) : ces réglages changent rarement, mais doivent être
// appliqués immédiatement dès qu'un admin bascule un toggle dans Paramètres > Automatisation.
async function getSystemSettings() {
  const settings = await prisma.systemSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  return settings;
}

// Construit une URL absolue à partir d'un "host" saisi par l'admin (Paramètres > Automatisation) :
// une IP ou un nom de domaine ("192.168.1.10", "support.prosuma.ci"), avec ou sans port
// ("192.168.1.10:8080"). Si l'admin tape explicitement "https://...", le protocole est préservé ;
// sinon on déduit https:// pour les ports 443/8443 et http:// pour le reste.
function buildUrlFromHost(host, defaultPort) {
  const trimmed = host.trim().replace(/\/+$/, '');
  const explicitProtocol = trimmed.match(/^(https?):\/\//i);
  const withoutProtocol = trimmed.replace(/^https?:\/\//i, '');
  const portMatch = withoutProtocol.match(/:(\d+)$/);
  const hasPort = !!portMatch;
  const port = hasPort ? parseInt(portMatch[1], 10) : null;
  let protocol = 'http://';
  let resolvedPort = port || defaultPort;
  if (explicitProtocol) {
    protocol = explicitProtocol[1].toLowerCase() + '://';
    if (!hasPort) {
      resolvedPort = protocol === 'https://' ? 443 : defaultPort;
    }
  } else if (port === 443 || port === 8443) {
    protocol = 'https://';
  }
  const hostOnly = withoutProtocol.replace(/:\d+$/, '');
  const portSuffix = hasPort ? `:${port}` : `:${resolvedPort}`;
  return `${protocol}${hostOnly}${portSuffix}`;
}

// Résout l'URL absolue du backend : priorité au réglage UI (Paramètres > Automatisation), sinon
// la variable d'environnement BACKEND_URL, sinon localhost en dernier recours. Centralisé ici
// pour que tous les endroits qui génèrent des liens/ressources absolus (logo de signature, etc.)
// se basent sur la même source de vérité, modifiable sans rebuild quand le serveur change d'adresse.
function resolveBackendUrl(settings) {
  if (settings?.backendUrl) return buildUrlFromHost(settings.backendUrl, 4000);
  return process.env.BACKEND_URL || 'http://localhost:4000';
}

// Même logique pour l'URL absolue du frontend (liens d'approbation, de réinitialisation de mot de passe...).
function resolveFrontendUrl(settings) {
  if (settings?.frontendUrl) return buildUrlFromHost(settings.frontendUrl, 3000);
  return process.env.FRONTEND_URL || 'http://localhost:3000';
}

// Le champ saisi par l'admin n'est qu'une IP/domaine (+port optionnel), pas une URL — on retire
// un éventuel protocole/slash final tapé par erreur pour rester cohérent avec ce que reconstruit
// resolveBackendUrl/resolveFrontendUrl à l'usage.
function normalizeHost(value) {
  if (!value) return null;
  const trimmed = value.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return trimmed || null;
}

module.exports = { getSystemSettings, resolveBackendUrl, resolveFrontendUrl, normalizeHost };
