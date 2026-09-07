import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

// Cache navigateur (localStorage) : les réglages système (notamment navigationConfig
// qui pilote la visibilité des pages par rôle) sont disponibles de façon SYNCHRONE au
// chargement — sans ça, la sidebar s'affiche avec les défauts le temps du GET
// /system-settings, puis les items masqués disparaissent (flash visuel).
// Stratégie stale-while-revalidate : affichage instantané depuis le cache + rafraîchissement
// silencieux en arrière-plan à chaque montage.
const CACHE_KEY = 'system_settings_cache';

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    /* quota dépassé ou mode privé : le cache est un optimisation, pas une nécessité */
  }
}

let cachedPromise = null;

// Hook partagé pour lire les réglages système (GET /system-settings, accessible à tout
// utilisateur authentifié). Expose notamment autonomousMode, qui pilote l'affichage des
// sections GLPI de l'UI en mode autonome (plateforme utilisée comme e-ticketing sans GLPI).
export default function useSystemSettings() {
  // Init synchrone depuis le cache → pas de flash de configuration par défaut
  const [settings, setSettings] = useState(readCache);
  const [loading, setLoading] = useState(() => !readCache());
  const [error, setError] = useState('');
  const { user } = useAuth();

  // Détecte un changement d'utilisateur (déconnexion/reconnexion dans le même onglet) :
  // la config mise en cache appartient alors à la session précédente → forcer un rechargement.
  const prevUserIdRef = useRef(null);
  const firstMountRef = useRef(true);

  function refresh() {
    cachedPromise = null;
    cachedPromise = api.get('/system-settings')
      .then(({ data }) => {
        writeCache(data);
        setSettings(data);
        return data;
      })
      .catch((err) => {
        setError(err.response?.data?.error || 'Erreur de chargement des réglages');
        return null;
      })
      .finally(() => setLoading(false));
    return cachedPromise;
  }

  useEffect(() => {
    const isFirstMount = firstMountRef.current;
    firstMountRef.current = false;
    const userChanged = prevUserIdRef.current !== user?.id;
    prevUserIdRef.current = user?.id;

    if (!isFirstMount && userChanged && user) {
      // Changement d'utilisateur → recharger (la config en cache est celle de la session précédente)
      refresh();
    } else if (!cachedPromise) {
      cachedPromise = api.get('/system-settings')
        .then(({ data }) => {
          writeCache(data);
          setSettings(data);
          return data;
        })
        .catch((err) => {
          setError(err.response?.data?.error || 'Erreur de chargement des réglages');
          return null;
        })
        .finally(() => setLoading(false));
    } else {
      cachedPromise
        .then((data) => { if (data) setSettings(data); })
        .finally(() => setLoading(false));
    }

    // Une autre page (ex : SUPERADMIN qui sauvegarde la config navigation) signale
    // un changement → recharger immédiatement dans les vues déjà montées. Le serveur
    // relaie aussi ce signal via Socket.IO (SocketContext → événement window) pour que
    // TOUS les onglets ouverts (pas seulement celui de l'admin) se mettent à jour.
    function onSettingsUpdated() { refresh(); }
    window.addEventListener('system-settings:updated', onSettingsUpdated);
    return () => window.removeEventListener('system-settings:updated', onSettingsUpdated);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return { settings, autonomousMode: settings?.autonomousMode === true, loading, error, refresh };
}

// Invalide le cache navigateur (ex : après modification de navigationConfig par le SUPERADMIN)
export function clearSystemSettingsCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
  cachedPromise = null;
}