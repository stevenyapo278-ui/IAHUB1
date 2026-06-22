import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
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
