import axios from 'axios';
import { getAccessToken, setAccessToken, clearAccessToken } from './tokenStore';
import { isUserActive } from '../utils/activity';

const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const api = axios.create({
  baseURL,
  // Indispensable pour que le cookie HttpOnly de refresh (ia_hub_refresh) soit
  // envoyé/reçu, y compris quand le front et l'API sont sur des origines distinctes.
  withCredentials: true,
});

// Client dédié au refresh : il ne passe PAS par les intercepteurs d'api (sinon une
// erreur 401 sur /auth/refresh déclencherait un refresh récursif).
const refreshClient = axios.create({ baseURL, withCredentials: true });

// Un seul refresh à la fois : plusieurs requêtes qui reçoivent 401 simultanément
// (rafale de polling au réveil de l'onglet) partagent la même promesse. Sans ça, la
// rotation du refresh token côté serveur invaliderait toutes les requêtes sauf une.
let refreshPromise = null;

export function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = refreshClient
    .post('/auth/refresh', null, isUserActive() ? { headers: { 'X-User-Activity': '1' } } : undefined)
    .then(({ data }) => {
      const token = data?.token || null;
      setAccessToken(token);
      return token;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

export function clearClientSession() {
  clearAccessToken();
  localStorage.removeItem('user');
}

// Redirige vers l'écran de connexion en conservant la page courante (comme ProtectedRoute).
export function redirectToLogin() {
  clearClientSession();
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    const from = `${window.location.pathname}${window.location.search || ''}`;
    const redirect = from && from !== '/' ? `?redirect=${encodeURIComponent(from)}` : '';
    window.location.href = `/login${redirect}`;
  }
}

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Seules les actions réelles prolongent la session côté serveur (timeout d'inactivité).
  if (isUserActive()) {
    config.headers['X-User-Activity'] = '1';
  }
  // Empêche le navigateur de servir des copies locales périmées pour les lectures.
  // En combinaison avec Cache-Control: no-cache, private côté serveur, toute requête
  // GET contacte systématiquement le backend (qui répond depuis son cache in-memory
  // si disponible, sinon depuis la DB). Cela garantit la cohérence immédiate après
  // une suppression/modification sans attendre l'expiration du TTL navigateur.
  if (!config.method || config.method.toLowerCase() === 'get') {
    config.headers['Cache-Control'] = 'no-cache';
    config.headers['Pragma'] = 'no-cache';
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status;
    const config = error.config;

    // 429 = quota de l'API momentanément épuisé. Pour les GET (polling : listes de
    // tickets, badges, notifications), on réessaie UNE seule fois après le délai
    // indiqué par le serveur (Retry-After, sinon 15 s) au lieu d'afficher une
    // erreur et de laisser les intervalles pilonner immédiatement le serveur.
    if (
      status === 429 && config && !config._retried429 &&
      (!config.method || config.method.toLowerCase() === 'get')
    ) {
      config._retried429 = true;
      const retryAfterSec = parseInt(error.response?.headers?.['retry-after'], 10);
      const delayMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0 && retryAfterSec <= 120
        ? retryAfterSec * 1000
        : 15000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return api(config);
    }

    const url = config?.url || '';
    const isAuthEndpoint = url.startsWith('/auth/login') || url.startsWith('/auth/refresh') || url.startsWith('/auth/logout');
    const isStaleSession = status === 401 || (status === 404 && url === '/auth/me');

    // 401 = jeton d'accès expiré (durée courte) : on tente UNE fois un refresh silencieux
    // via le cookie HttpOnly, puis on rejoue la requête initiale. Le refresh token est
    // tourné côté serveur à chaque appel.
    if (status === 401 && config && !config._retriedAuth && !isAuthEndpoint) {
      config._retriedAuth = true;
      try {
        const token = await refreshAccessToken();
        if (token) return api(config);
      } catch {
        // Cookie absent/expiré/révoqué : la session est réellement terminée.
      }
    }

    // Session définitivement invalide (refresh impossible, compte supprimé) : on purge
    // l'état local et on renvoie vers /login. 429 / 5xx ne déconnectent PAS.
    if (isStaleSession) {
      redirectToLogin();
    }
    return Promise.reject(error);
  }
);

export default api;
