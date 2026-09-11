/**
 * UserPreferencesContext — Moteur de personnalisation dynamique utilisateur.
 *
 * Stocke et persiste dans localStorage (avec fallback gracieux) :
 *   - tablePreferences : densité, vue par défaut, colonnes visibles par page
 *   - pinnedShortcuts : raccourcis épinglés dans le header/sidebar
 *   - layoutDensity : compact / comfortable / spacious
 *   - soundNotifications : on/off
 *
 * Ce contexte est séparé de ThemeContext (skins/thème/dark mode) pour
 * maintenir une séparation des responsabilités.
 * La personnalisation du tableau de bord est gérée par le dashboard lui-même
 * (react-grid-layout, persistée en base via /api/dashboards).
 */

import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { FONT_STACKS, FONT_CSS_VAR, getFontFamily } from '../config/fonts';

const UserPreferencesContext = createContext(null);

// ── Clé localStorage ────────────────────────────────────────────────────────
const STORAGE_KEY = 'userPreferences';

/** Clé scopée par utilisateur connecté : chaque compte a SES préférences */
function storageKeyFor(user) {
  return user?.id ? `${STORAGE_KEY}:${user.id}` : STORAGE_KEY;
}

// ── Defaults ────────────────────────────────────────────────────────────────
const DEFAULT_TABLE_PREFERENCES = {
  density: 'comfortable', // 'compact' | 'comfortable'
  defaultView: 'table',   // 'table' | 'kanban' | 'cards'
  visibleColumns: {
    tickets: ['priority', 'ticket', 'status', 'assignedTo', 'requester', 'createdAt', 'actions'],
    assets: ['name', 'serialNumber', 'model', 'location', 'status'],
    users: ['fullName', 'email', 'role', 'team', 'isActive'],
  },
};

const DEFAULT_PREFERENCES = {
  tablePreferences: { ...DEFAULT_TABLE_PREFERENCES },
  pinnedShortcuts: ['/tickets', '/inbox', '/email-drafts'],
  soundNotifications: true,
  layoutDensity: 'comfortable', // 'compact' | 'comfortable' | 'spacious'
  fontFamily: 'ubuntu', // clé config/fonts.js — police personnalisée par utilisateur
  fontSize: 14, // taille de police en px (12–20)
};

// ── Helpers ─────────────────────────────────────────────────────────────────
// Migrer les anciens paths obsolètes vers les routes actuelles
const PATH_MIGRATIONS = {
  '/validation-center': '/email-drafts',
};

function loadPreferences(user) {
  const scopedKey = storageKeyFor(user);
  let raw = null;
  try { raw = localStorage.getItem(scopedKey); } catch { /* storage unavailable */ }

  // Migration : l'ancienne clé globale (avant le scoping par utilisateur)
  // est rapatriée vers la clé du compte connecté une seule fois.
  if (!raw && user?.id) {
    try {
      const legacy = localStorage.getItem(STORAGE_KEY);
      if (legacy) {
        localStorage.setItem(scopedKey, legacy);
        raw = legacy;
      }
    } catch { /* storage unavailable */ }
  }

  try {
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrer les pinnedShortcuts avec des paths obsolètes
      const pinnedShortcuts = (parsed.pinnedShortcuts || DEFAULT_PREFERENCES.pinnedShortcuts).map(
        (p) => PATH_MIGRATIONS[p] || p
      );
      return {
        ...DEFAULT_PREFERENCES,
        ...parsed,
        pinnedShortcuts,
        fontFamily: FONT_STACKS[parsed.fontFamily] ? parsed.fontFamily : DEFAULT_PREFERENCES.fontFamily,
        tablePreferences: { ...DEFAULT_TABLE_PREFERENCES, ...parsed.tablePreferences },
      };
    }
  } catch { /* storage unavailable */ }
  return { ...DEFAULT_PREFERENCES };
}

function savePreferences(prefs, user) {
  try {
    localStorage.setItem(storageKeyFor(user), JSON.stringify(prefs));
  } catch { /* storage unavailable */ }
}

// ── Provider ────────────────────────────────────────────────────────────────
export function UserPreferencesProvider({ children }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState(() => loadPreferences(user));

  // ── Police utilisateur : appliquée immédiatement sur <html> via --user-font ──
  useEffect(() => {
    document.documentElement.style.setProperty(FONT_CSS_VAR, getFontFamily(prefs.fontFamily));
  }, [prefs.fontFamily]);

  // ── Taille de police : appliquée sur <html> via --user-font-size ──
  useEffect(() => {
    document.documentElement.style.setProperty('--user-font-size', `${prefs.fontSize}px`);
    document.documentElement.style.fontSize = `${prefs.fontSize}px`;
  }, [prefs.fontSize]);

  const setFontFamily = useCallback((fontFamily) => {
    if (!FONT_STACKS[fontFamily]) return;
    setPrefs((prev) => {
      const next = { ...prev, fontFamily };
      savePreferences(next, user);
      return next;
    });
  }, [user]);

  const setFontSize = useCallback((fontSize) => {
    const clamped = Math.min(20, Math.max(12, Number(fontSize) || 14));
    setPrefs((prev) => {
      const next = { ...prev, fontSize: clamped };
      savePreferences(next, user);
      return next;
    });
  }, [user]);

  // ── Table preferences ───────────────────────────────────────────────────
  const setTablePreferences = useCallback((page, updates) => {
    setPrefs((prev) => {
      const next = {
        ...prev,
        tablePreferences: {
          ...prev.tablePreferences,
          [page]: { ...(prev.tablePreferences[page] || {}), ...updates },
        },
      };
      savePreferences(next, user);
      return next;
    });
  }, [user]);

  const setTableDensity = useCallback((density) => {
    setPrefs((prev) => {
      const next = {
        ...prev,
        tablePreferences: { ...prev.tablePreferences, density },
      };
      savePreferences(next, user);
      return next;
    });
  }, [user]);

  // ── Pinned shortcuts ────────────────────────────────────────────────────
  const toggleShortcut = useCallback((path) => {
    setPrefs((prev) => {
      const exists = prev.pinnedShortcuts.includes(path);
      const nextShortcuts = exists
        ? prev.pinnedShortcuts.filter((s) => s !== path)
        : [...prev.pinnedShortcuts, path];
      const next = { ...prev, pinnedShortcuts: nextShortcuts };
      savePreferences(next, user);
      return next;
    });
  }, [user]);

  const reorderShortcuts = useCallback((fromIndex, toIndex) => {
    setPrefs((prev) => {
      const shortcuts = [...prev.pinnedShortcuts];
      const [moved] = shortcuts.splice(fromIndex, 1);
      shortcuts.splice(toIndex, 0, moved);
      const next = { ...prev, pinnedShortcuts: shortcuts };
      savePreferences(next, user);
      return next;
    });
  }, [user]);

  // ── Layout density ──────────────────────────────────────────────────────
  const setLayoutDensity = useCallback((density) => {
    setPrefs((prev) => {
      const next = { ...prev, layoutDensity: density };
      savePreferences(next, user);
      return next;
    });
  }, [user]);

  // ── Sound notifications ─────────────────────────────────────────────────
  const toggleSoundNotifications = useCallback(() => {
    setPrefs((prev) => {
      const next = { ...prev, soundNotifications: !prev.soundNotifications };
      savePreferences(next, user);
      return next;
    });
  }, [user]);

  // ── Reset all preferences ───────────────────────────────────────────────
  const resetPreferences = useCallback(() => {
    const defaults = { ...DEFAULT_PREFERENCES };
    setPrefs(defaults);
    savePreferences(defaults, user);
  }, [user]);

  // ── Value memoized ──────────────────────────────────────────────────────
  const value = useMemo(() => ({
    // Tables
    tablePreferences: prefs.tablePreferences,
    setTablePreferences,
    setTableDensity,
    // Shortcuts
    pinnedShortcuts: prefs.pinnedShortcuts,
    toggleShortcut,
    reorderShortcuts,
    // Density
    layoutDensity: prefs.layoutDensity,
    setLayoutDensity,
    // Sound
    soundNotifications: prefs.soundNotifications,
    toggleSoundNotifications,
    // Police
    fontFamily: prefs.fontFamily,
    setFontFamily,
    // Taille de police
    fontSize: prefs.fontSize,
    setFontSize,
    // Reset
    resetPreferences,
  }), [
    prefs, setTablePreferences, setTableDensity, toggleShortcut,
    reorderShortcuts, setLayoutDensity, toggleSoundNotifications,
    setFontFamily, setFontSize, resetPreferences,
  ]);

  return (
    <UserPreferencesContext.Provider value={value}>
      {children}
    </UserPreferencesContext.Provider>
  );
}

export function useUserPreferences() {
  const ctx = useContext(UserPreferencesContext);
  if (!ctx) throw new Error('useUserPreferences must be used within UserPreferencesProvider');
  return ctx;
}
