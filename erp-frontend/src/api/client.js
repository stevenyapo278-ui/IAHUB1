import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
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
  (error) => {
    // 401 = token invalide/expiré ; 404 sur /auth/me spécifiquement = le compte du token n'existe
    // plus côté serveur (supprimé/recréé) — dans les deux cas la session locale est périmée et doit
    // être purgée, sinon l'utilisateur reste "connecté" avec un user obsolète qui fait échouer tous
    // les appels suivants sans jamais revenir à l'écran de connexion.
    const isStaleSession = error.response?.status === 401 || (error.response?.status === 404 && error.config?.url === '/auth/me');
    if (isStaleSession) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
