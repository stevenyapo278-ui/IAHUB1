import { createContext, useContext, useEffect, useState } from 'react';
import api, { refreshAccessToken, clearClientSession } from '../api/client';
import { setAccessToken } from '../api/tokenStore';
import { saveSessionLocation, getSessionLocation, clearSessionLocation } from '../utils/sessionLocation';

const AuthContext = createContext(null);

// Champs utilisateur exposés au front (le hash de mot de passe et tokenVersion ne sortent jamais).
function toSessionUser(data) {
  if (!data) return null;
  return {
    id: data.id,
    email: data.email,
    fullName: data.fullName,
    role: data.role,
    roles: data.roles || [data.role],
    teamId: data.teamId,
    permissions: data.permissions,
    mustChangePassword: data.mustChangePassword,
    avatarUrl: data.avatarUrl,
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user');
    try {
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  // false tant que la session n'a pas été confrontée au serveur : évite d'afficher
  // brièvement une page protégée (ou de rediriger vers /login) avant le refresh initial.
  const [authReady, setAuthReady] = useState(false);

  function persistUser(nextUser) {
    if (nextUser) localStorage.setItem('user', JSON.stringify(nextUser));
    else localStorage.removeItem('user');
    setUser(nextUser);
  }

  // ── Restauration de session au chargement ────────────────────────────────
  // Le jeton d'accès n'existe plus dans localStorage (protection XSS) : on le
  // reconstruit silencieusement depuis le cookie HttpOnly, puis on recharge le profil.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await refreshAccessToken();
        if (!token) throw new Error('no refresh token');
        const { data } = await api.get('/auth/me');
        if (cancelled) return;
        if (data?.token) setAccessToken(data.token);
        persistUser(toSessionUser(data));
      } catch (err) {
        if (cancelled) return;
        // 401/404 = cookie absent, expiré ou session révoquée : on purge.
        // Erreur réseau / 5xx au démarrage = transitoire : on conserve l'utilisateur
        // mémorisé et on laisse l'intercepteur retenter le refresh à la prochaine requête,
        // plutôt que de déconnecter tout le monde au moindre redémarrage de l'API.
        const status = err?.response?.status;
        if (status === 401 || status === 404) persistUser(null);
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function login(email, password) {
    const { data } = await api.post('/auth/login', { email, password });
    if (data?.token) setAccessToken(data.token);
    persistUser(data.user);
    setAuthReady(true);
    return data.user;
  }

  async function logout() {
    // Sauvegarder la position actuelle avant de déconnecter
    if (user) {
      saveSessionLocation(user.id, window.location.pathname, window.location.search);
    }
    try {
      // Révoque la session en base et efface le cookie HttpOnly.
      await api.post('/auth/logout');
    } catch {
      // Hors ligne / session déjà expirée : la purge locale suffit.
    }
    clearClientSession();
    // Purge le cache des réglages système : le prochain utilisateur sur ce navigateur
    // doit charger SA configuration de navigation, pas celle de l'utilisateur précédent.
    localStorage.removeItem('system_settings_cache');
    setUser(null);
  }

  function getLastLocation() {
    if (!user) return null;
    const saved = getSessionLocation(user.id);
    if (saved) clearSessionLocation(user.id);
    return saved;
  }

  // Appelé après un changement de mot de passe réussi (écran ForcePasswordChange), pour faire
  // disparaître immédiatement cet écran sans devoir se reconnecter.
  function clearMustChangePassword() {
    setUser((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, mustChangePassword: false };
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    });
  }

  async function switchRole(role) {
    const { data } = await api.post('/auth/switch-role', { role });
    if (data?.token) setAccessToken(data.token);
    persistUser(data.user);
    window.dispatchEvent(new CustomEvent('app:user-updated'));
    return data.user;
  }

  // ── Rafraîchissement périodique du profil/permissions ────────────────────
  // Si un admin retire un droit à un groupe pendant qu'un utilisateur est déjà connecté,
  // ça se reflète au prochain refresh (2 min), au retour sur l'onglet ou sur alerte socket.
  // Le backend relit de toute façon rôle et session en base à chaque requête.
  useEffect(() => {
    if (!authReady || !user?.id) return;

    let cancelled = false;
    function refreshMe() {
      api.get('/auth/me')
        .then(({ data }) => {
          if (cancelled) return;
          if (data.token) setAccessToken(data.token);
          persistUser(toSessionUser(data));
        })
        // 401/404 = session réellement invalide : l'intercepteur purge et redirige.
        // 429 / 5xx / réseau = transitoire, on garde la session pour le prochain refresh.
        .catch(() => {});
    }

    refreshMe();
    const interval = setInterval(refreshMe, 120000);
    const onVisible = () => { if (document.visibilityState === 'visible') refreshMe(); };
    // Le serveur prévient via socket quand le rôle/groupe vient de changer (cf. NotificationContext)
    const onUserUpdated = () => refreshMe();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('app:user-updated', onUserUpdated);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('app:user-updated', onUserUpdated);
    };
  }, [authReady, user?.id]);

  // ── Révocation temps réel ────────────────────────────────────────────────
  // Le backend déconnecte les sockets avec l'événement `auth:revoked` quand la session
  // est révoquée (mot de passe changé, compte désactivé). On termine aussi la session
  // locale immédiatement, sans attendre qu'une requête API échoue.
  useEffect(() => {
    const onRevoked = () => {
      clearClientSession();
      localStorage.removeItem('system_settings_cache');
      setUser(null);
      if (window.location.pathname !== '/login') window.location.href = '/login';
    };
    window.addEventListener('auth:session-revoked', onRevoked);
    return () => window.removeEventListener('auth:session-revoked', onRevoked);
  }, []);

  // Mise à jour locale du profil (photo de profil) sans attendre le prochain refresh /auth/me
  useEffect(() => {
    const onAvatarUpdated = (e) => {
      const updated = e.detail;
      if (!updated?.id) return;
      setUser((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
    };
    window.addEventListener('auth:user-updated', onAvatarUpdated);
    return () => window.removeEventListener('auth:user-updated', onAvatarUpdated);
  }, []);

  return (
    <AuthContext.Provider value={{ user, authReady, login, logout, clearMustChangePassword, switchRole, getLastLocation }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
