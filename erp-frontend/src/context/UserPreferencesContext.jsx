/**
 * UserPreferencesContext — Moteur de personnalisation dynamique utilisateur.
 *
 * Stocke et persiste dans localStorage (avec fallback gracieux) :
 *   - dashboardLayout : widgets visibles, ordre, spans de grille
 *   - tablePreferences : densité, vue par défaut, colonnes visibles par page
 *   - pinnedShortcuts : raccourcis épinglés dans le header/sidebar
 *   - layoutDensity : compact / comfortable / spacious
 *   - soundNotifications : on/off
 *
 * Ce contexte est séparé de ThemeContext (skins/thème/dark mode) pour
 * maintenir une séparation des responsabilités.
 */

import { createContext, useContext, useState, useCallback, useMemo } from 'react';

const UserPreferencesContext = createContext(null);

// ── Clé localStorage ────────────────────────────────────────────────────────
const STORAGE_KEY = 'userPreferences';

// ── Defaults ────────────────────────────────────────────────────────────────
const DEFAULT_DASHBOARD_LAYOUT = {
  viewMode: 'bento', // 'bento' | 'grid' | 'list'
  visibleWidgets: [
    'kpi_tiles',
    'ticket_trends',
    'recent_activity',
    'ai_pipeline',
    'top_techs',
    'sla_compliance',
    'category_breakdown',
  ],
  kpiOrder: [
    'open_tickets',
    'p1_tickets',
    'avg_response_time',
    'csat_score',
    'ai_processed',
    'unassigned',
  ],
  widgetGridSpan: {
    kpi_tiles: 12,
    ticket_trends: 8,
    recent_activity: 4,
    ai_pipeline: 6,
    top_techs: 6,
    sla_compliance: 6,
    category_breakdown: 6,
  },
};

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
  dashboardLayout: { ...DEFAULT_DASHBOARD_LAYOUT },
  tablePreferences: { ...DEFAULT_TABLE_PREFERENCES },
  pinnedShortcuts: ['/tickets', '/inbox', '/email-drafts'],
  soundNotifications: true,
  layoutDensity: 'comfortable', // 'compact' | 'comfortable' | 'spacious'
};

// ── Helpers ─────────────────────────────────────────────────────────────────
// Migrer les anciens paths obsolètes vers les routes actuelles
const PATH_MIGRATIONS = {
  '/validation-center': '/email-drafts',
};

function loadPreferences() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Migrer les pinnedShortcuts avec des paths obsolètes
      const pinnedShortcuts = (parsed.pinnedShortcuts || DEFAULT_PREFERENCES.pinnedShortcuts).map(
        (p) => PATH_MIGRATIONS[p] || p
      );
      return {
        ...DEFAULT_PREFERENCES,
        ...parsed,
        pinnedShortcuts,
        dashboardLayout: { ...DEFAULT_DASHBOARD_LAYOUT, ...parsed.dashboardLayout },
        tablePreferences: { ...DEFAULT_TABLE_PREFERENCES, ...parsed.tablePreferences },
      };
    }
  } catch { /* storage unavailable */ }
  return { ...DEFAULT_PREFERENCES };
}

function savePreferences(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch { /* storage unavailable */ }
}

// ── Provider ────────────────────────────────────────────────────────────────
export function UserPreferencesProvider({ children }) {
  const [prefs, setPrefs] = useState(loadPreferences);

  // ── Dashboard layout ────────────────────────────────────────────────────
  const setDashboardLayout = useCallback((updates) => {
    setPrefs((prev) => {
      const next = {
        ...prev,
        dashboardLayout: { ...prev.dashboardLayout, ...updates },
      };
      savePreferences(next);
      return next;
    });
  }, []);

  const toggleWidget = useCallback((widgetId) => {
    setPrefs((prev) => {
      const visible = prev.dashboardLayout.visibleWidgets;
      const nextVisible = visible.includes(widgetId)
        ? visible.filter((w) => w !== widgetId)
        : [...visible, widgetId];
      const next = {
        ...prev,
        dashboardLayout: { ...prev.dashboardLayout, visibleWidgets: nextVisible },
      };
      savePreferences(next);
      return next;
    });
  }, []);

  const reorderWidgets = useCallback((fromIndex, toIndex) => {
    setPrefs((prev) => {
      const widgets = [...prev.dashboardLayout.visibleWidgets];
      const [moved] = widgets.splice(fromIndex, 1);
      widgets.splice(toIndex, 0, moved);
      const next = {
        ...prev,
        dashboardLayout: { ...prev.dashboardLayout, visibleWidgets: widgets },
      };
      savePreferences(next);
      return next;
    });
  }, []);

  const setWidgetSpan = useCallback((widgetId, span) => {
    setPrefs((prev) => {
      const next = {
        ...prev,
        dashboardLayout: {
          ...prev.dashboardLayout,
          widgetGridSpan: { ...prev.dashboardLayout.widgetGridSpan, [widgetId]: span },
        },
      };
      savePreferences(next);
      return next;
    });
  }, []);

  const setKpiOrder = useCallback((order) => {
    setPrefs((prev) => {
      const next = {
        ...prev,
        dashboardLayout: { ...prev.dashboardLayout, kpiOrder: order },
      };
      savePreferences(next);
      return next;
    });
  }, []);

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
      savePreferences(next);
      return next;
    });
  }, []);

  const setTableDensity = useCallback((density) => {
    setPrefs((prev) => {
      const next = {
        ...prev,
        tablePreferences: { ...prev.tablePreferences, density },
      };
      savePreferences(next);
      return next;
    });
  }, []);

  // ── Pinned shortcuts ────────────────────────────────────────────────────
  const toggleShortcut = useCallback((path) => {
    setPrefs((prev) => {
      const exists = prev.pinnedShortcuts.includes(path);
      const nextShortcuts = exists
        ? prev.pinnedShortcuts.filter((s) => s !== path)
        : [...prev.pinnedShortcuts, path];
      const next = { ...prev, pinnedShortcuts: nextShortcuts };
      savePreferences(next);
      return next;
    });
  }, []);

  const reorderShortcuts = useCallback((fromIndex, toIndex) => {
    setPrefs((prev) => {
      const shortcuts = [...prev.pinnedShortcuts];
      const [moved] = shortcuts.splice(fromIndex, 1);
      shortcuts.splice(toIndex, 0, moved);
      const next = { ...prev, pinnedShortcuts: shortcuts };
      savePreferences(next);
      return next;
    });
  }, []);

  // ── Layout density ──────────────────────────────────────────────────────
  const setLayoutDensity = useCallback((density) => {
    setPrefs((prev) => {
      const next = { ...prev, layoutDensity: density };
      savePreferences(next);
      return next;
    });
  }, []);

  // ── Sound notifications ─────────────────────────────────────────────────
  const toggleSoundNotifications = useCallback(() => {
    setPrefs((prev) => {
      const next = { ...prev, soundNotifications: !prev.soundNotifications };
      savePreferences(next);
      return next;
    });
  }, []);

  // ── Reset all preferences ───────────────────────────────────────────────
  const resetPreferences = useCallback(() => {
    const defaults = { ...DEFAULT_PREFERENCES };
    setPrefs(defaults);
    savePreferences(defaults);
  }, []);

  // ── Value memoized ──────────────────────────────────────────────────────
  const value = useMemo(() => ({
    // Dashboard
    dashboardLayout: prefs.dashboardLayout,
    setDashboardLayout,
    toggleWidget,
    reorderWidgets,
    setWidgetSpan,
    setKpiOrder,
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
    // Reset
    resetPreferences,
  }), [
    prefs, setDashboardLayout, toggleWidget, reorderWidgets, setWidgetSpan,
    setKpiOrder, setTablePreferences, setTableDensity, toggleShortcut,
    reorderShortcuts, setLayoutDensity, toggleSoundNotifications, resetPreferences,
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

// ── Widget metadata (for CustomizerDrawer and Dashboard) ────────────────────
export const DASHBOARD_WIDGETS = [
  { id: 'kpi_tiles',        label: 'Tuiles KPI',         icon: 'BarChart3',     description: 'Indicateurs clés (tickets ouverts, P1, SLA…)' },
  { id: 'ticket_trends',    label: 'Tendances tickets',   icon: 'TrendingUp',    description: 'Graphique des tendances sur 30 jours' },
  { id: 'recent_activity',  label: 'Activité récente',    icon: 'Activity',      description: 'Dernières actions et modifications' },
  { id: 'ai_pipeline',      label: 'Pipeline IA',         icon: 'Sparkles',      description: 'Statistiques du traitement automatique' },
  { id: 'top_techs',        label: 'Top techniciens',     icon: 'Users',         description: 'Classement des techniciens par performance' },
  { id: 'sla_compliance',   label: 'Conformité SLA',      icon: 'Clock',         description: 'Taux de respect des SLA par priorité' },
  { id: 'category_breakdown', label: 'Répartition catégories', icon: 'PieChart', description: 'Distribution des tickets par catégorie' },
];
