/**
 * CustomizerDrawer — Tiroir de personnalisation de l'expérience utilisateur.
 *
 * Accessible via une icône d'engrenage dans le Header.
 * Gère :
 *   - Widgets du dashboard (afficher/masquer, réordonner)
 *   - Densité des tables (compact/comfortable)
 *   - Raccourcis épinglés (ajouter/supprimer/réordonner)
 *   - Notifications sonores
 *   - Réinitialisation des préférences
 *
 * Séparé de LayoutSettings (skins/thème/disposition sidebar).
 */

import { useState } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import {
  Settings2,
  X,
  Check,
  GripVertical,
  Eye,
  EyeOff,
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  Volume2,
  VolumeX,
  RotateCcw,
  LayoutDashboard,
  Table2,
  Pin,
  BarChart3,
  TrendingUp,
  Activity,
  Sparkles,
  Users,
  Clock,
  PieChart,
  Link2,
} from 'lucide-react';
import { useUserPreferences, DASHBOARD_WIDGETS } from '../context/UserPreferencesContext';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'tables', label: 'Tables', icon: Table2 },
  { id: 'shortcuts', label: 'Raccourcis', icon: Pin },
];

const ICON_MAP = {
  BarChart3,
  TrendingUp,
  Activity,
  Sparkles,
  Users,
  Clock,
  PieChart,
};

const DENSITY_OPTIONS = [
  { id: 'compact', label: 'Compact', description: 'Lignes serrées, moins d\'espace' },
  { id: 'comfortable', label: 'Confortable', description: 'Espacement standard' },
];

const COMMON_SHORTCUTS = [
  { path: '/tickets', label: 'Tickets', icon: '🎫' },
  { path: '/tickets?new=1', label: 'Nouveau ticket', icon: '➕' },
  { path: '/inbox', label: 'Inbox', icon: '📥' },
  { path: '/email-drafts', label: 'Validation', icon: '✅' },
  { path: '/assets', label: 'Assets', icon: '💻' },
  { path: '/knowledge-base', label: 'Base connaissances', icon: '📚' },
  { path: '/dashboard', label: 'Dashboard', icon: '📊' },
  { path: '/users', label: 'Utilisateurs', icon: '👥' },
  { path: '/teams', label: 'Équipes', icon: '🏢' },
  { path: '/categories', label: 'Catégories', icon: '📁' },
  { path: '/locations', label: 'Lieux', icon: '📍' },
  { path: '/activity-logs', label: 'Journaux', icon: '📋' },
  { path: '/technician-stats', label: 'Stats techs', icon: '📈' },
  { path: '/settings', label: 'Paramètres', icon: '⚙️' },
];

export default function CustomizerDrawer({ open, onClose }) {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-black/30 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 z-[91] w-[380px] max-w-[90vw] flex flex-col bg-surface border-l border-border shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 shrink-0 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-primary text-primary-foreground">
                  <Settings2 className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-foreground">Personnalisation</h2>
                  <p className="text-[11px] text-muted-foreground">Widgets, tables & raccourcis</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-surface-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 px-4 py-2 shrink-0 border-b border-border">
              {TABS.map((tab) => {
                const TabIcon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-surface-muted'
                    }`}
                  >
                    <TabIcon className="w-3.5 h-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {activeTab === 'dashboard' && <DashboardTab />}
              {activeTab === 'tables' && <TablesTab />}
              {activeTab === 'shortcuts' && <ShortcutsTab />}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Dashboard Tab ─────────────────────────────────────────────────────────
function DashboardTab() {
  const {
    dashboardLayout, toggleWidget, reorderWidgets,
    setWidgetSpan, setKpiOrder, setDashboardLayout,
  } = useUserPreferences();

  return (
    <div className="space-y-5">
      {/* Widget visibility */}
      <div>
        <label className="text-xs font-semibold mb-2 block text-foreground">
          Widgets du tableau de bord
        </label>
        <p className="text-[10px] text-muted-foreground mb-3">
          Affichez ou masquez les widgets de votre dashboard.
        </p>

        <Reorder.Group
          axis="y"
          values={dashboardLayout.visibleWidgets}
          onReorder={(newOrder) => {
            // Reorder: update visibleWidgets with new order
            setDashboardLayout({ visibleWidgets: newOrder });
          }}
          className="space-y-1.5"
        >
          {DASHBOARD_WIDGETS.map((widget) => {
            const isVisible = dashboardLayout.visibleWidgets.includes(widget.id);
            const IconComp = ICON_MAP[widget.icon] || BarChart3;
            return (
              <Reorder.Item
                key={widget.id}
                value={widget.id}
                className={`flex items-center gap-2.5 p-2.5 rounded-xl border transition-all ${
                  isVisible
                    ? 'bg-surface-container border-border'
                    : 'bg-surface border-border/50 opacity-60'
                }`}
              >
                <GripVertical className="w-3.5 h-3.5 text-muted-foreground/50 cursor-grab shrink-0" />
                <IconComp className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-foreground block">{widget.label}</span>
                  <span className="text-[10px] text-muted-foreground block truncate">{widget.description}</span>
                </div>
                <button
                  onClick={() => toggleWidget(widget.id)}
                  className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                    isVisible
                      ? 'bg-primary/10 text-primary'
                      : 'bg-surface-muted text-muted-foreground'
                  }`}
                  title={isVisible ? 'Masquer' : 'Afficher'}
                >
                  {isVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
              </Reorder.Item>
            );
          })}
        </Reorder.Group>
      </div>

      {/* KPI order */}
      <div>
        <label className="text-xs font-semibold mb-2 block text-foreground">
          Ordre des KPI
        </label>
        <div className="space-y-1">
          {dashboardLayout.kpiOrder.map((kpiId, index) => (
            <div key={kpiId} className="flex items-center gap-2 p-2 rounded-lg bg-surface-container border border-border">
              <span className="w-5 h-5 rounded bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">
                {index + 1}
              </span>
              <span className="text-xs font-medium text-foreground flex-1">
                {formatKpiLabel(kpiId)}
              </span>
              <div className="flex gap-0.5">
                <button
                  onClick={() => {
                    if (index === 0) return;
                    const newOrder = [...dashboardLayout.kpiOrder];
                    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
                    setKpiOrder(newOrder);
                  }}
                  disabled={index === 0}
                  className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ArrowUp className="w-3 h-3" />
                </button>
                <button
                  onClick={() => {
                    if (index === dashboardLayout.kpiOrder.length - 1) return;
                    const newOrder = [...dashboardLayout.kpiOrder];
                    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
                    setKpiOrder(newOrder);
                  }}
                  disabled={index === dashboardLayout.kpiOrder.length - 1}
                  className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ArrowDown className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Tables Tab ─────────────────────────────────────────────────────────────
function TablesTab() {
  const { tablePreferences, setTableDensity } = useUserPreferences();

  return (
    <div className="space-y-5">
      {/* Density */}
      <div>
        <label className="text-xs font-semibold mb-2 block text-foreground">
          Densité des tables
        </label>
        <p className="text-[10px] text-muted-foreground mb-3">
          Contrôle l'espacement des lignes dans toutes les tables.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {DENSITY_OPTIONS.map((opt) => {
            const isActive = tablePreferences.density === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setTableDensity(opt.id)}
                className={`relative flex flex-col items-center gap-1 p-3 rounded-xl border transition-all ${
                  isActive
                    ? 'bg-primary/5 border-primary'
                    : 'bg-surface-container border-border hover:border-border'
                }`}
              >
                {isActive && (
                  <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                    <Check className="w-2.5 h-2.5" />
                  </span>
                )}
                <span className="text-xs font-semibold text-foreground">{opt.label}</span>
                <span className="text-[10px] text-muted-foreground text-center">{opt.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Preview */}
      <div className="rounded-xl border border-border bg-surface-container p-4">
        <p className="text-xs font-semibold mb-2 text-foreground">Aperçu</p>
        <div className={`space-y-0 ${tablePreferences.density === 'compact' ? 'text-[11px]' : 'text-xs'}`}>
          {['Ticket #1234 — Problème réseau', 'Ticket #1235 — Imprimante bloquée', 'Ticket #1236 — Accès refusé'].map((text, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 border-b border-border/50 ${
                tablePreferences.density === 'compact' ? 'py-1 px-2' : 'py-2 px-3'
              } ${i === 2 ? 'border-b-0' : ''}`}
            >
              <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
              <span className="text-foreground truncate">{text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Sound notifications */}
      <SoundToggle />
    </div>
  );
}

// ── Shortcuts Tab ──────────────────────────────────────────────────────────
function ShortcutsTab() {
  const { pinnedShortcuts, toggleShortcut, reorderShortcuts } = useUserPreferences();

  return (
    <div className="space-y-5">
      {/* Current pinned shortcuts */}
      <div>
        <label className="text-xs font-semibold mb-2 block text-foreground">
          Raccourcis épinglés
        </label>
        <p className="text-[10px] text-muted-foreground mb-3">
          Apparaissent dans le header pour un accès rapide.
        </p>

        {pinnedShortcuts.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground/60">
            <Pin className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-xs">Aucun raccourci épinglé</p>
            <p className="text-[10px] mt-1">Ajoutez-en depuis la liste ci-dessous</p>
          </div>
        ) : (
          <Reorder.Group
            axis="y"
            values={pinnedShortcuts}
            onReorder={reorderShortcuts}
            className="space-y-1.5"
          >
            {pinnedShortcuts.map((path) => {
              const shortcut = COMMON_SHORTCUTS.find((s) => s.path === path);
              return (
                <Reorder.Item
                  key={path}
                  value={path}
                  className="flex items-center gap-2.5 p-2.5 rounded-xl border border-border bg-surface-container"
                >
                  <GripVertical className="w-3.5 h-3.5 text-muted-foreground/50 cursor-grab shrink-0" />
                  <span className="text-base shrink-0">{shortcut?.icon || '📄'}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-semibold text-foreground block">{shortcut?.label || path}</span>
                    <span className="text-[10px] text-muted-foreground block truncate">{path}</span>
                  </div>
                  <button
                    onClick={() => toggleShortcut(path)}
                    className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                    title="Retirer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </Reorder.Item>
              );
            })}
          </Reorder.Group>
        )}
      </div>

      {/* Available shortcuts to add */}
      <div>
        <label className="text-xs font-semibold mb-2 block text-foreground">
          Ajouter un raccourci
        </label>
        <div className="space-y-1">
          {COMMON_SHORTCUTS.filter((s) => !pinnedShortcuts.includes(s.path)).map((shortcut) => (
            <button
              key={shortcut.path}
              onClick={() => toggleShortcut(shortcut.path)}
              className="w-full flex items-center gap-2.5 p-2 rounded-lg text-left hover:bg-surface-muted transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-base shrink-0">{shortcut.icon}</span>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-foreground">{shortcut.label}</span>
                <span className="text-[10px] text-muted-foreground block truncate">{shortcut.path}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Sound Toggle (shared) ──────────────────────────────────────────────────
function SoundToggle() {
  const { soundNotifications, toggleSoundNotifications } = useUserPreferences();

  return (
    <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-surface-container">
      <div className="flex items-center gap-2.5">
        {soundNotifications ? (
          <Volume2 className="w-4 h-4 text-muted-foreground" />
        ) : (
          <VolumeX className="w-4 h-4 text-muted-foreground" />
        )}
        <div>
          <span className="text-xs font-semibold text-foreground">Notifications sonores</span>
          <p className="text-[10px] text-muted-foreground">Jouer un son pour les alertes</p>
        </div>
      </div>
      <button
        onClick={toggleSoundNotifications}
        className={`relative w-10 h-5 rounded-full transition-colors ${
          soundNotifications ? 'bg-primary' : 'bg-border'
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full transition-transform bg-white shadow-sm ${
            soundNotifications ? 'left-[22px]' : 'left-[2px]'
          }`}
        />
      </button>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
function formatKpiLabel(kpiId) {
  const labels = {
    open_tickets: 'Tickets ouverts',
    p1_tickets: 'Tickets P1',
    avg_response_time: 'Temps de réponse moyen',
    csat_score: 'Score CSAT',
    ai_processed: 'Traités par IA',
    unassigned: 'Non assignés',
  };
  return labels[kpiId] || kpiId;
}
