// Suivi d'activité réelle de l'utilisateur (souris, clavier, tactile, navigation d'onglet).
//
// Le backend ne prolonge la session que sur les requêtes marquées `X-User-Activity: 1`.
// Sans ce marqueur, un onglet laissé ouvert qui ne fait que du polling (notifications,
// tickets) ne maintient pas artificiellement la session en vie : après le délai
// d'inactivité, la prochaine action réelle renvoie 401 et redirige vers /login.

const ACTIVITY_WINDOW_MS = 2 * 60 * 1000; // une action « récente » vaut activité
let lastActivityAt = typeof Date !== 'undefined' ? Date.now() : 0;

function markActive() {
  lastActivityAt = Date.now();
}

if (typeof window !== 'undefined') {
  const events = ['pointerdown', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];
  for (const event of events) {
    window.addEventListener(event, markActive, { passive: true, capture: true });
  }
  // Revenir sur l'onglet est une action utilisateur explicite.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') markActive();
  });
}

export function isUserActive() {
  return Date.now() - lastActivityAt < ACTIVITY_WINDOW_MS;
}

export function getLastActivityAt() {
  return lastActivityAt;
}
