import { useEffect, useState } from 'react';
import api from '../api/client';

// Cache module-level : le réglage autonome est stable à l'échelle d'une session utilisateur,
// on évite de refaire un GET /system-settings à chaque composant qui en a besoin.
let cachedPromise = null;

// Hook partagé pour lire les réglages système (GET /system-settings, accessible à tout
// utilisateur authentifié). Expose notamment autonomousMode, qui pilote l'affichage des
// sections GLPI de l'UI en mode autonome (plateforme utilisée comme e-ticketing sans GLPI).
export default function useSystemSettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  function refresh() {
    cachedPromise = null;
    cachedPromise = api.get('/system-settings')
      .then(({ data }) => {
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
    if (!cachedPromise) {
      cachedPromise = api.get('/system-settings')
        .then(({ data }) => {
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
  }, []);

  return { settings, autonomousMode: settings?.autonomousMode === true, loading, error, refresh };
}
