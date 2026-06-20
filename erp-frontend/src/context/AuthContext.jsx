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

  // Rafraîchit les permissions effectives au chargement de l'app (pas seulement au login) : si un
  // admin retire un droit à un groupe pendant qu'un utilisateur est déjà connecté, ça se reflète
  // au prochain chargement de page plutôt que de rester figé jusqu'à la prochaine reconnexion.
  useEffect(() => {
    if (!localStorage.getItem('token')) return;
    api.get('/auth/me')
      .then(({ data }) => {
        const refreshed = { id: data.id, email: data.email, fullName: data.fullName, role: data.role, teamId: data.teamId, permissions: data.permissions };
        localStorage.setItem('user', JSON.stringify(refreshed));
        setUser(refreshed);
      })
      .catch(() => {});
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
