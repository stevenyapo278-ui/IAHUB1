// Stockage du jeton d'accès UNIQUEMENT en mémoire (jamais dans localStorage).
//
// Le refresh token vit dans un cookie HttpOnly inacessible au JavaScript : même en cas
// de XSS, un attaquant ne peut pas exfiltrer de session longue durée. Ce module est isolé
// pour être importé par axios, Socket.IO, le chat SSE et la session vocale sans créer de
// dépendance circulaire.

let accessToken = null;

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token) {
  accessToken = token || null;
  // Prévient Socket.IO et les autres consommateurs (session vocale, SSE) que le jeton
  // a changé. Après un changement de mot de passe, le serveur a coupé les sockets :
  // cet événement permet de se reconnecter immédiatement avec le nouveau jeton.
  if (typeof window !== 'undefined' && accessToken) {
    window.dispatchEvent(new CustomEvent('auth:token-refreshed', { detail: { token: accessToken } }));
  }
}

export function clearAccessToken() {
  accessToken = null;
}
