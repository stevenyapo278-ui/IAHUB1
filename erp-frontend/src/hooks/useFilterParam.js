import { useSearchParams } from 'react-router-dom';
import { useCallback, useMemo } from 'react';

/**
 * Met à jour plusieurs paramètres d'URL en UNE SEULE navigation.
 * Nécessaire car setSearchParams de react-router n'enchaîne pas les mises à jour :
 * deux appels successifs dans un même handler partent tous deux du dernier état rendu,
 * et le second écrase le premier (valeur perdue). Le updater fonctionnel reçoit toujours
 * le state le plus récent, donc combiner ici est sûr.
 * @param {Object} updates Map clé -> valeur (valeur vide => paramètre supprimé)
 */
export function useFilterParams(defaults = {}) {
  const [searchParams, setSearchParams] = useSearchParams();

  const defaultsKey = useMemo(() => JSON.stringify(defaults), [defaults]);

  const update = useCallback((updates) => {
    setSearchParams((prev) => {
      const defaultsObj = JSON.parse(defaultsKey);
      const next = new URLSearchParams(prev);
      for (const [key, newValue] of Object.entries(updates)) {
        if (!newValue || newValue === defaultsObj[key]) {
          next.delete(key);
        } else {
          next.set(key, newValue);
        }
      }
      return next;
    }, { replace: true });
  }, [defaultsKey, setSearchParams]);

  return update;
}

export function useFilterParam(key, defaultValue = '') {
  const [searchParams, setSearchParams] = useSearchParams();
  const value = searchParams.get(key) ?? defaultValue;

  const setValue = useCallback((newValue) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!newValue || newValue === defaultValue) {
        next.delete(key);
      } else {
        next.set(key, newValue);
      }
      return next;
    }, { replace: true });
  }, [key, defaultValue, setSearchParams]);

  return [value, setValue];
}
