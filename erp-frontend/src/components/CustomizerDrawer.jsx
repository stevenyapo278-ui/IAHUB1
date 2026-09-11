/**
 * CustomizerDrawer — Tiroir de personnalisation de l'expérience utilisateur.
 *
 * Accessible via une icône d'engrenage dans le Header.
 * Gère :
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
  Table2,
  Pin,
  MessageCircle,
  Move,
  Type,
} from 'lucide-react';
import { useUserPreferences } from '../context/UserPreferencesContext';
import DEFAULT_VISIBILITY from '../config/navigationDefaults';
import { useAuth } from '../context/AuthContext';
import useSystemSettings from '../hooks/useSystemSettings';
import { hasPermission } from '../utils/permissions';

const TABS = [
  { id: 'tables', label: 'Tables', icon: Table2 },
  { id: 'shortcuts', label: 'Raccourcis', icon: Pin },
  { id: 'chat', label: 'Chat', icon: MessageCircle },
];

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
  { path: '/users', label: 'Utilisateurs', icon: '👥' },
  { path: '/teams', label: 'Équipes', icon: '🏢' },
  { path: '/categories', label: 'Catégories', icon: '📁' },
  { path: '/locations', label: 'Lieux', icon: '📍' },
  { path: '/activity-logs', label: 'Journaux', icon: '📋' },
  { path: '/technician-stats', label: 'Stats techs', icon: '📈' },
  { path: '/settings', label: 'Paramètres', icon: '⚙️' },
];

export default function CustomizerDrawer({ open, onClose }) {
  const [activeTab, setActiveTab] = useState('tables');

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
                  <p className="text-[11px] text-muted-foreground">Tables, raccourcis & notifications</p>
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
            <div className="flex gap-1 px-4 py-2 shrink-0 border-b border-border overflow-x-auto scrollbar-none">
              {TABS.map((tab) => {
                const TabIcon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all whitespace-nowrap shrink-0 ${
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
              {activeTab === 'tables' && <TablesTab />}
              {activeTab === 'shortcuts' && <ShortcutsTab />}
              {activeTab === 'chat' && <ChatTab />}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Tables Tab ─────────────────────────────────────────────────────────────
function TablesTab() {
  const { tablePreferences, setTableDensity, fontSize, setFontSize } = useUserPreferences();

  const FONT_SIZES = [12, 13, 14, 15, 16, 18, 20];

  return (
    <div className="space-y-5">
      {/* Font Size */}
      <div>
        <label className="text-xs font-semibold mb-2 block text-foreground flex items-center gap-2">
          <Type className="w-3.5 h-3.5 text-primary" />
          Taille du texte
        </label>
        <p className="text-[10px] text-muted-foreground mb-3">
          Ajustez la taille de police pour plus de confort de lecture.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={12}
            max={20}
            step={1}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="flex-1 h-1.5 rounded-full appearance-none bg-surface-container-highest cursor-pointer accent-primary"
          />
          <span className="text-xs font-semibold text-primary min-w-[36px] text-center bg-primary/10 rounded-lg px-2 py-1">
            {fontSize}px
          </span>
        </div>
        <div className="flex justify-between mt-1.5 px-0.5">
          {FONT_SIZES.map((size) => (
            <button
              key={size}
              onClick={() => setFontSize(size)}
              className={`text-[9px] px-1 py-0.5 rounded transition-colors ${
                fontSize === size
                  ? 'text-primary font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

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
  const { user } = useAuth();
  const { settings: systemSettings } = useSystemSettings();

  const navConfig = systemSettings?.navigationConfig;

  // All items pour vérification des permissions (doit correspondre à MainLayout.jsx)
  const ALL_NAV_ITEMS = [
    { to: '/', permission: null },
    { to: '/portal', permission: null },
    { to: '/tickets', permission: null },
    { to: '/problems', permission: null, fallbackRoles: ['ADMIN', 'HOTLINE'] },
    { to: '/email-drafts', permission: 'emaildrafts.manage', fallbackRoles: ['ADMIN', 'HOTLINE', 'TECHNICIAN'] },
    { to: '/inbox', permission: 'inbox.sync', fallbackRoles: ['ADMIN', 'HOTLINE', 'TECHNICIAN'] },
    { to: '/knowledge-base', permission: null },
    { to: '/ticket-evolution', permission: null, fallbackRoles: ['ADMIN', 'TECHNICIAN', 'HOTLINE'] },
    { to: '/teams', permission: 'teams.manage', fallbackRoles: ['ADMIN'] },
    { to: '/users', permission: 'users.manage', fallbackRoles: ['ADMIN'] },
    { to: '/technician-stats', permission: null, fallbackRoles: ['ADMIN', 'HOTLINE', 'TECHNICIAN'] },
    { to: '/skills', permission: null, fallbackRoles: ['ADMIN'] },
    { to: '/categories', permission: null, fallbackRoles: ['ADMIN', 'HOTLINE', 'TECHNICIAN'] },
    { to: '/locations', permission: null, fallbackRoles: ['ADMIN', 'HOTLINE'] },
    { to: '/assets', permission: null },
    { to: '/ai-weekly-reports', permission: null, fallbackRoles: ['ADMIN', 'HOTLINE'] },
    { to: '/prompts', permission: 'prompts.manage', fallbackRoles: ['ADMIN'] },
    { to: '/permission-groups', permission: 'users.manage', fallbackRoles: ['ADMIN'] },
    { to: '/settings', permission: ['settings.ai', 'settings.email', 'settings.integrations', 'automation.manage'], fallbackRoles: ['ADMIN'] },
    { to: '/documentation', permission: null },
    { to: '/logs', permission: null, roles: ['ADMIN', 'SUPERADMIN', 'HOTLINE', 'TECHNICIAN'] },
    { to: '/audit', permission: null, fallbackRoles: ['ADMIN'] },
  ];

  function isPathAllowed(path) {
    if (user?.role === 'SUPERADMIN') return true;
    const basePath = path.split('?')[0];
    if (navConfig && navConfig[basePath]) {
      return navConfig[basePath].includes(user?.role);
    }
    const item = ALL_NAV_ITEMS.find((i) => i.to === basePath);
    if (!item) return true;
    if (item.permission !== null) {
      const keys = Array.isArray(item.permission) ? item.permission : [item.permission];
      return keys.some((key) => hasPermission(user, key));
    }
    if (item.fallbackRoles || item.roles) {
      const allowed = item.roles || item.fallbackRoles;
      return allowed.includes(user?.role);
    }
    // Pas de restriction codée en dur → appliquer les défauts partagés (onglet Navigation)
    const defaultRoles = DEFAULT_VISIBILITY[basePath];
    if (defaultRoles) return defaultRoles.includes(user?.role);
    return true;
  }

  // Filtrer les raccourcis disponibles selon les permissions
  const allowedShortcuts = COMMON_SHORTCUTS.filter((s) => isPathAllowed(s.path));
  const allowedPinned = pinnedShortcuts.filter(isPathAllowed);

  // Auto-nettoyer les raccourcis épinglés devenus inaccessibles
  if (allowedPinned.length < pinnedShortcuts.length) {
    pinnedShortcuts.filter((p) => !isPathAllowed(p)).forEach((p) => toggleShortcut(p));
  }

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

        {allowedPinned.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground/60">
            <Pin className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-xs">Aucun raccourci épinglé</p>
            <p className="text-[10px] mt-1">Ajoutez-en depuis la liste ci-dessous</p>
          </div>
        ) : (
          <Reorder.Group
            axis="y"
            values={allowedPinned}
            onReorder={(newOrder) => {
              // Réordonner uniquement les éléments autorisés
              const others = pinnedShortcuts.filter((p) => !isPathAllowed(p));
              reorderShortcuts([...others, ...newOrder]);
            }}
            className="space-y-1.5"
          >
            {allowedPinned.map((path) => {
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
          {allowedShortcuts.filter((s) => !pinnedShortcuts.includes(s.path)).map((shortcut) => (
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

// ── Chat Tab ──────────────────────────────────────────────────────────────
function ChatTab() {
  const [posX, setPosX] = useState(() => {
    try { return JSON.parse(localStorage.getItem('chatwidget_position'))?.right ?? 24; } catch { return 24; }
  });
  const [posY, setPosY] = useState(() => {
    try { return JSON.parse(localStorage.getItem('chatwidget_position'))?.bottom ?? 24; } catch { return 24; }
  });

  function updatePosition(x, y) {
    setPosX(x);
    setPosY(y);
    localStorage.setItem('chatwidget_position', JSON.stringify({ right: x, bottom: y }));
    window.dispatchEvent(new CustomEvent('chatwidget:position-changed'));
  }

  function resetPosition() {
    updatePosition(24, 24);
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="text-xs font-semibold mb-2 block text-foreground">
          Position du chat flottant
        </label>
        <p className="text-[10px] text-muted-foreground mb-3">
          Ajustez la position X (droite) et Y (bas) en pixels.
        </p>

        {/* Aperçu live */}
        <div className="relative w-full h-40 border border-border rounded-xl bg-surface-container mb-4 overflow-hidden">
          {/* Contenu simulé */}
          <div className="absolute inset-3 border border-dashed border-border/40 rounded-lg" />
          <div className="absolute top-3 left-3 text-[9px] text-muted-foreground/50 font-mono">viewport</div>

          {/* Bulle simulée */}
          <div
            className="absolute w-8 h-8 rounded-full bg-gradient-to-br from-primary to-blue-700 flex items-center justify-center shadow-md transition-all duration-150"
            style={{ right: `${Math.min(posX, 280)}px`, bottom: `${Math.min(posY, 120)}px` }}
          >
            <span className="material-symbols-outlined text-[14px] text-white">smart_toy</span>
          </div>

          {/* Axes */}
          <div className="absolute bottom-1 right-1 flex items-center gap-1 text-[8px] text-muted-foreground/60 font-mono">
            <span>x:{posX}</span>
            <span>y:{posY}</span>
          </div>
        </div>

        {/* Slider X */}
        <div className="space-y-1.5 mb-3">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-foreground">Position X (droite)</label>
            <span className="text-[11px] font-mono text-primary font-bold">{posX}px</span>
          </div>
          <input
            type="range"
            min={0}
            max={400}
            value={posX}
            onChange={(e) => updatePosition(Number(e.target.value), posY)}
            className="w-full h-1.5 rounded-full bg-border appearance-none cursor-pointer accent-primary"
          />
          <div className="flex justify-between text-[9px] text-muted-foreground/50">
            <span>0</span>
            <span>400</span>
          </div>
        </div>

        {/* Slider Y */}
        <div className="space-y-1.5 mb-3">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-foreground">Position Y (bas)</label>
            <span className="text-[11px] font-mono text-primary font-bold">{posY}px</span>
          </div>
          <input
            type="range"
            min={0}
            max={400}
            value={posY}
            onChange={(e) => updatePosition(posX, Number(e.target.value))}
            className="w-full h-1.5 rounded-full bg-border appearance-none cursor-pointer accent-primary"
          />
          <div className="flex justify-between text-[9px] text-muted-foreground/50">
            <span>0</span>
            <span>400</span>
          </div>
        </div>

        {/* Reset */}
        <button
          onClick={resetPosition}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-surface-container hover:bg-surface-muted transition-colors text-[11px] font-semibold text-muted-foreground cursor-pointer"
        >
          <RotateCcw className="w-3 h-3" />
          Réinitialiser la position
        </button>
      </div>

      {/* Raccourci clavier */}
      <div className="p-3 rounded-xl border border-border bg-surface-container">
        <div className="flex items-center gap-2.5">
          <Move className="w-4 h-4 text-muted-foreground" />
          <div>
            <span className="text-xs font-semibold text-foreground">Raccourci clavier</span>
            <p className="text-[10px] text-muted-foreground">
              <kbd className="px-1.5 py-0.5 rounded bg-surface border border-border text-[10px] font-mono">Ctrl+I</kbd> ou{' '}
              <kbd className="px-1.5 py-0.5 rounded bg-surface border border-border text-[10px] font-mono">⌘I</kbd> pour ouvrir/fermer
            </p>
          </div>
        </div>
      </div>
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
