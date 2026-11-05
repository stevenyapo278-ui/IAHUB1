import { useState, useEffect } from 'react';

/**
 * ─── useXmas — source unique de vérité pour la décoration de Noël ────────────
 *
 * Combine :
 *   1. la préférence personnelle (localStorage, clé `xmas_prefs_v2`)
 *   2. le réglage admin (`xmasForceEnabled` via /system-settings/public)
 *
 * Toute modification passe par `writeXmasPrefs()` qui persiste ET diffuse
 * l'événement `xmas-prefs-changed` → tous les abonnés (AnimatedBackground,
 * MainLayout, LayoutSettings) se resynchronisent, dans tous les onglets.
 */

export const XMAS_STORAGE_KEY = 'xmas_prefs_v2';

/** Fallback : VITE_XMAS_ENABLED active le thème pour tout le monde au 1er chargement. */
function envDefaultActive() {
  try {
    return import.meta.env.VITE_XMAS_ENABLED === 'true';
  } catch {
    return false;
  }
}

export const DEFAULT_XMAS = {
  active: envDefaultActive(),
  color: '#0067ff',
  speed: 1,
  nightMode: false,
  emoji: '🎄',
  emojiLabel: 'treeFull',
  // Décorations (toutes optionnelles, activées par défaut)
  snow: true,          // neige plein écran en canvas (3 plans de profondeur)
  santaHat: true,      // bonnet de Père Noël sur le logo de la sidebar
  confetti: true,      // confettis quand un ticket passe à Résolu / Fermé
  palette: false,      // palette festive vert sapin / or (désactivée par défaut)
};

export function readXmasPrefs() {
  if (typeof window === 'undefined') return { ...DEFAULT_XMAS };
  try {
    const raw = localStorage.getItem(XMAS_STORAGE_KEY);
    if (raw) return { ...DEFAULT_XMAS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_XMAS };
}

/** Persiste un patch + notifie tous les onglets/composants abonnés. */
export function writeXmasPrefs(patch) {
  const next = { ...readXmasPrefs(), ...patch };
  try {
    localStorage.setItem(XMAS_STORAGE_KEY, JSON.stringify(next));
  } catch { /* quota / mode privé */ }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('xmas-prefs-changed'));
  }
  return next;
}

export function useXmas() {
  const [prefs, setPrefs] = useState(readXmasPrefs);
  // null = pas encore chargé, false = admin n'a pas forcé, true = admin force
  const [adminForced, setAdminForced] = useState(null);

  // Réglage admin (endpoint public, sans token)
  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000/api'}/system-settings/public`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('non ok'))))
      .then((data) => { if (!cancelled) setAdminForced(!!data.xmasForceEnabled); })
      .catch(() => { if (!cancelled) setAdminForced(false); });
    return () => { cancelled = true; };
  }, []);

  // Réagit aux changements (même onglet ou autre onglet)
  useEffect(() => {
    const sync = () => setPrefs(readXmasPrefs());
    window.addEventListener('storage', sync);
    window.addEventListener('xmas-prefs-changed', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('xmas-prefs-changed', sync);
    };
  }, []);

  const active = adminForced === true || !!prefs.active;

  return {
    active,
    adminForced,
    prefs,
    color: prefs.color || DEFAULT_XMAS.color,
    speed: Number(prefs.speed) || 1,
    nightMode: !!prefs.nightMode,
    emoji: prefs.emoji || DEFAULT_XMAS.emoji,
    snow: prefs.snow !== false,
    santaHat: prefs.santaHat !== false,
    confetti: prefs.confetti !== false,
    palette: !!prefs.palette,
  };
}

export default useXmas;
