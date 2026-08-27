/**
 * chunkReload.js
 * ───────────────
 * Détecte les erreurs de chunks Vite périmés (« Failed to fetch dynamically imported module »)
 * et force un rechargement automatique de la page pour obtenir les nouveaux assets.
 *
 * Protection anti-boucle : un rechargement max par onglet (flag dans sessionStorage).
 */

const RELOAD_FLAG = '__chunk_reload_pending';

export function installChunkReloadGuard() {
  // Si un reload a déjà été déclenché dans cet onglet, ne rien faire
  if (sessionStorage.getItem(RELOAD_FLAG)) {
    sessionStorage.removeItem(RELOAD_FLAG);
    return; // on vient de recharger, on ne boucle pas
  }

  window.addEventListener('error', (event) => {
    const msg = event.message || event.error?.message || '';
    if (msg.includes('Failed to fetch dynamically imported module') || msg.includes('Loading chunk')) {
      console.warn('[chunkReload] Chunk périmé détecté — rechargement automatique…');
      sessionStorage.setItem(RELOAD_FLAG, '1');
      window.location.reload();
    }
  });

  // Fallback : les erreurs de promise rejetées (import() échoue)
  window.addEventListener('unhandledrejection', (event) => {
    const reason = String(event.reason || '');
    if (reason.includes('Failed to fetch dynamically imported module') || reason.includes('Loading chunk')) {
      console.warn('[chunkReload] Chunk périmé détecté (promise) — rechargement automatique…');
      sessionStorage.setItem(RELOAD_FLAG, '1');
      window.location.reload();
    }
  });
}
