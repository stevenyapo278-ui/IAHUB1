import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Palette,
  LayoutTemplate,
  PanelLeftClose,
  PanelLeft,
  Monitor,
  Sparkles,
  MousePointer2,
  X,
  Check,
  Sun,
  Moon,
  Zap,
} from 'lucide-react';
import { useTheme, SKINS, LAYOUT_PRESETS } from '../context/ThemeContext';

const TABS = [
  { id: 'skins', label: 'Skins', icon: Palette },
  { id: 'layout', label: 'Disposition', icon: LayoutTemplate },
  { id: 'effects', label: 'Effets', icon: Sparkles },
];

export default function LayoutSettings({ open, onClose }) {
  const {
    theme, toggleTheme,
    skin, setSkin,
    oled, toggleOled,
    layoutSettings, setLayoutSettings, applyLayoutPreset,
  } = useTheme();
  const [activeTab, setActiveTab] = useState('skins');

  if (!open) return null;

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
            className="fixed right-0 top-0 bottom-0 z-[91] w-[380px] max-w-[90vw] flex flex-col shadow-2xl"
            style={{
              backgroundColor: 'var(--color-surface-container-lowest)',
              borderLeft: '1px solid var(--color-outline-variant)',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-4 shrink-0"
              style={{ borderBottom: '1px solid var(--color-outline-variant)' }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}
                >
                  <Palette className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold" style={{ color: 'var(--color-on-surface)' }}>
                    Personnalisation
                  </h2>
                  <p className="text-[11px]" style={{ color: 'var(--color-on-surface-variant)' }}>
                    Apparence & disposition
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:opacity-80"
                style={{ color: 'var(--color-on-surface-variant)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tabs */}
            <div
              className="flex gap-1 px-4 py-2 shrink-0"
              style={{ borderBottom: '1px solid var(--color-outline-variant)' }}
            >
              {TABS.map((tab) => {
                const TabIcon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{
                      backgroundColor: isActive ? 'var(--color-primary)' : 'transparent',
                      color: isActive ? 'var(--color-on-primary)' : 'var(--color-on-surface-variant)',
                    }}
                  >
                    <TabIcon className="w-3.5 h-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {activeTab === 'skins' && (
                <SkinsTab
                  skin={skin}
                  setSkin={setSkin}
                  theme={theme}
                  toggleTheme={toggleTheme}
                  oled={oled}
                  toggleOled={toggleOled}
                />
              )}
              {activeTab === 'layout' && (
                <LayoutTab
                  layoutSettings={layoutSettings}
                  setLayoutSettings={setLayoutSettings}
                  applyLayoutPreset={applyLayoutPreset}
                />
              )}
              {activeTab === 'effects' && (
                <EffectsTab
                  layoutSettings={layoutSettings}
                  setLayoutSettings={setLayoutSettings}
                />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Skins Tab ───────────────────────────────────────────────────────────────
function SkinsTab({ skin, setSkin, theme, toggleTheme, oled, toggleOled }) {
  return (
    <div className="space-y-5">
      {/* Theme mode */}
      <div>
        <label className="text-xs font-semibold mb-2 block" style={{ color: 'var(--color-on-surface)' }}>
          Mode d'affichage
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => theme !== 'light' && toggleTheme()}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-all border"
            style={{
              backgroundColor: theme === 'light' ? 'var(--color-primary)' : 'var(--color-surface-container)',
              color: theme === 'light' ? 'var(--color-on-primary)' : 'var(--color-on-surface-variant)',
              borderColor: theme === 'light' ? 'var(--color-primary)' : 'var(--color-outline-variant)',
            }}
          >
            <Sun className="w-3.5 h-3.5" />
            Clair
          </button>
          <button
            onClick={() => theme !== 'dark' && toggleTheme()}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-all border"
            style={{
              backgroundColor: theme === 'dark' ? 'var(--color-primary)' : 'var(--color-surface-container)',
              color: theme === 'dark' ? 'var(--color-on-primary)' : 'var(--color-on-surface-variant)',
              borderColor: theme === 'dark' ? 'var(--color-primary)' : 'var(--color-outline-variant)',
            }}
          >
            <Moon className="w-3.5 h-3.5" />
            Sombre
          </button>
        </div>
      </div>

      {/* OLED toggle */}
      {theme === 'dark' && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Monitor className="w-4 h-4" style={{ color: 'var(--color-on-surface-variant)' }} />
            <div>
              <span className="text-xs font-semibold" style={{ color: 'var(--color-on-surface)' }}>Mode OLED</span>
              <p className="text-[10px]" style={{ color: 'var(--color-on-surface-variant)' }}>Noir pur (#000)</p>
            </div>
          </div>
          <button
            onClick={toggleOled}
            className="relative w-10 h-5 rounded-full transition-colors"
            style={{
              backgroundColor: oled ? 'var(--color-primary)' : 'var(--color-outline-variant)',
            }}
          >
            <span
              className="absolute top-0.5 w-4 h-4 rounded-full transition-transform bg-white shadow-sm"
              style={{ left: oled ? '22px' : '2px' }}
            />
          </button>
        </div>
      )}

      {/* Skin grid */}
      <div>
        <label className="text-xs font-semibold mb-2 block" style={{ color: 'var(--color-on-surface)' }}>
          Thème couleur
        </label>
        <div className="grid grid-cols-3 gap-2">
          {SKINS.map((s) => {
            const isActive = skin === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setSkin(s.id)}
                className="relative flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all border"
                style={{
                  backgroundColor: isActive ? 'var(--color-surface-container-high)' : 'var(--color-surface-container)',
                  borderColor: isActive ? 'var(--color-primary)' : 'var(--color-outline-variant)',
                  borderWidth: isActive ? '2px' : '1px',
                }}
              >
                {isActive && (
                  <span
                    className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}
                  >
                    <Check className="w-2.5 h-2.5" />
                  </span>
                )}
                <span
                  className="w-8 h-8 rounded-full border flex items-center justify-center text-sm"
                  style={{
                    backgroundColor: s.primary,
                    borderColor: 'var(--color-outline-variant)',
                    color: '#fff',
                    fontWeight: 700,
                  }}
                >
                  {s.emoji}
                </span>
                <span className="text-[10px] font-medium" style={{ color: 'var(--color-on-surface)' }}>
                  {s.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Layout Tab ──────────────────────────────────────────────────────────────
function LayoutTab({ layoutSettings, setLayoutSettings, applyLayoutPreset }) {
  return (
    <div className="space-y-5">
      {/* Presets */}
      <div>
        <label className="text-xs font-semibold mb-2 block" style={{ color: 'var(--color-on-surface)' }}>
          Presets
        </label>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(LAYOUT_PRESETS).map(([key, preset]) => {
            const isActive = JSON.stringify(layoutSettings) === JSON.stringify(preset);
            return (
              <button
                key={key}
                onClick={() => applyLayoutPreset(key)}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-all border"
                style={{
                  backgroundColor: isActive ? 'var(--color-primary)' : 'var(--color-surface-container)',
                  color: isActive ? 'var(--color-on-primary)' : 'var(--color-on-surface)',
                  borderColor: isActive ? 'var(--color-primary)' : 'var(--color-outline-variant)',
                }}
              >
                <LayoutTemplate className="w-3.5 h-3.5" />
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Individual toggles */}
      <div className="space-y-3">
        <label className="text-xs font-semibold block" style={{ color: 'var(--color-on-surface)' }}>
          Options
        </label>

        <LayoutToggle
          icon={layoutSettings.minSidebar ? PanelLeftClose : PanelLeft}
          label="Sidebar réduite"
          description="Icônes uniquement, expand au survol"
          value={layoutSettings.minSidebar}
          onChange={(v) => setLayoutSettings({ minSidebar: v })}
        />

        <LayoutToggle
          icon={Monitor}
          label="Header fixe"
          description="En-tête collé en haut"
          value={layoutSettings.fixedHeader}
          onChange={(v) => setLayoutSettings({ fixedHeader: v })}
        />

        <LayoutToggle
          icon={Zap}
          label="Mode compact"
          description="Espacement réduit"
          value={layoutSettings.compactMode}
          onChange={(v) => setLayoutSettings({ compactMode: v })}
        />
      </div>
    </div>
  );
}

// ── Effects Tab ─────────────────────────────────────────────────────────────
function EffectsTab({ layoutSettings, setLayoutSettings }) {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <label className="text-xs font-semibold block" style={{ color: 'var(--color-on-surface)' }}>
          Animations
        </label>

        <LayoutToggle
          icon={Sparkles}
          label="Animations"
          description="Transitions & micro-interactions"
          value={layoutSettings.animations}
          onChange={(v) => setLayoutSettings({ animations: v })}
        />

        <LayoutToggle
          icon={MousePointer2}
          label="Cursor glow"
          description="Lueur qui suit le curseur"
          value={layoutSettings.cursorGlow}
          onChange={(v) => setLayoutSettings({ cursorGlow: v })}
        />
      </div>

      {/* Preview */}
      <div
        className="rounded-xl p-4 border"
        style={{
          backgroundColor: 'var(--color-surface-container)',
          borderColor: 'var(--color-outline-variant)',
        }}
      >
        <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-on-surface)' }}>
          Aperçu
        </p>
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-on-surface-variant)' }}>
          Les animations contrôlent les transitions de page, les effets hover et les micro-interactions.
          Le cursor glow ajoute une lueur subtile qui suit le curseur sur les pages principales.
        </p>
      </div>
    </div>
  );
}

// ── Layout Toggle ───────────────────────────────────────────────────────────
function LayoutToggle({ icon: Icon, label, description, value, onChange }) {
  return (
    <div
      className="flex items-center justify-between p-3 rounded-xl border transition-all"
      style={{
        backgroundColor: 'var(--color-surface-container)',
        borderColor: 'var(--color-outline-variant)',
      }}
    >
      <div className="flex items-center gap-2.5">
        <Icon className="w-4 h-4" style={{ color: 'var(--color-on-surface-variant)' }} />
        <div>
          <span className="text-xs font-semibold" style={{ color: 'var(--color-on-surface)' }}>{label}</span>
          <p className="text-[10px]" style={{ color: 'var(--color-on-surface-variant)' }}>{description}</p>
        </div>
      </div>
      <button
        onClick={() => onChange(!value)}
        className="relative w-10 h-5 rounded-full transition-colors"
        style={{
          backgroundColor: value ? 'var(--color-primary)' : 'var(--color-outline-variant)',
        }}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full transition-transform bg-white shadow-sm"
          style={{ left: value ? '22px' : '2px' }}
        />
      </button>
    </div>
  );
}
