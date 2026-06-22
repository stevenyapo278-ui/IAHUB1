import { createContext, useContext, useEffect, useState } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });

  async function login(email, password) {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
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

  // Rafraîchit les permissions effectives au chargement de l'app (pas seulement au login) : si un
  // admin retire un droit à un groupe pendant qu'un utilisateur est déjà connecté, ça se reflète
  // au prochain chargement de page plutôt que de rester figé jusqu'à la prochaine reconnexion.
  useEffect(() => {
    if (!localStorage.getItem('token')) return;
    api.get('/auth/me')
      .then(({ data }) => {
        const refreshed = { id: data.id, email: data.email, fullName: data.fullName, role: data.role, teamId: data.teamId, permissions: data.permissions, mustChangePassword: data.mustChangePassword };
        localStorage.setItem('user', JSON.stringify(refreshed));
        setUser(refreshed);
      })
      // Token invalide/expiré ou compte supprimé (404) : la session locale est périmée, on la
      // purge plutôt que de laisser l'utilisateur "connecté" avec un user obsolète qui ferait
      // échouer silencieusement tous les appels API suivants (cf. bug observé : /auth/me 404 en
      // boucle après suppression/recréation d'un compte côté serveur).
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setUser(null);
      });
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, clearMustChangePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
