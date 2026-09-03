import { createContext, useContext, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { flushSync } from 'react-dom';

const ThemeContext = createContext(null);

// ─── Wave animation settings (View Transitions API) ─────────────────────────
const WAVE_DURATION_MS = 450;
const WAVE_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';

// ─── Available skins ────────────────────────────────────────────────────────
export const SKINS = [
  { id: 'default',  label: 'Default',  emoji: '🔷', primary: '#0067ff' },
  { id: 'bento',    label: 'Bento',    emoji: '🟠', primary: '#ff5a1f' },
  { id: 'aqua',     label: 'Aqua',     emoji: '🩵', primary: '#1597a5' },
  { id: 'lime',     label: 'Lime',     emoji: '🟢', primary: '#9ccc1f' },
  { id: 'lilac',    label: 'Lilac',    emoji: '🟣', primary: '#6d5ba6' },
  { id: 'prism',    label: 'Prism',    emoji: '🌈', primary: '#6d28d9' },
  { id: 'midnight', label: 'Midnight', emoji: '🌙', primary: '#4f5bd5' },
  { id: 'ocean',    label: 'Ocean',    emoji: '🌊', primary: '#0a84ff' },
  { id: 'graphite', label: 'Graphite', emoji: '⚫', primary: '#2b2b30' },
  { id: 'emerald',  label: 'Emerald',  emoji: '💚', primary: '#059669' },
  { id: 'amber',    label: 'Amber',    emoji: '🟡', primary: '#f59e0b' },
  { id: 'coral',    label: 'Coral',    emoji: '🩷', primary: '#ff6b5e' },
  { id: 'console',  label: 'Console',  emoji: '💻', primary: '#15803d' },
];

// ─── Layout presets ─────────────────────────────────────────────────────────
export const LAYOUT_PRESETS = {
  default: {
    label: 'Par défaut',
    minSidebar: false,
    headerOnly: false,
    fixedHeader: true,
    compactMode: false,
    animations: true,
    cursorGlow: false,
  },
  minimal: {
    label: 'Minimal',
    minSidebar: true,
    headerOnly: false,
    fixedHeader: false,
    compactMode: true,
    animations: true,
    cursorGlow: false,
  },
  contentFocus: {
    label: 'Focus contenu',
    minSidebar: true,
    headerOnly: false,
    fixedHeader: true,
    compactMode: false,
    animations: true,
    cursorGlow: true,
  },
  wide: {
    label: 'Large',
    minSidebar: false,
    headerOnly: false,
    fixedHeader: true,
    compactMode: false,
    animations: true,
    cursorGlow: false,
  },
};

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Apply theme to DOM (idempotent)
function applyThemeToDom(next) {
  document.documentElement.classList.toggle('dark', next === 'dark');
  try { localStorage.setItem('theme', next); } catch { /* storage unavailable */ }
}

// Apply skin to DOM (idempotent)
function applySkinToDom(skinId) {
  document.documentElement.setAttribute('data-skin', skinId);
  try { localStorage.setItem('skin', skinId); } catch { /* storage unavailable */ }
}

// Apply OLED to DOM
function applyOledToDom(oled) {
  document.documentElement.setAttribute('data-oled', oled ? 'true' : 'false');
  try { localStorage.setItem('oled', oled ? 'true' : 'false'); } catch { /* storage unavailable */ }
}

// Apply layout settings to DOM
function applyLayoutToDom(settings) {
  const el = document.documentElement;
  el.toggleAttribute('data-min-sidebar', settings.minSidebar);
  el.toggleAttribute('data-header-only', settings.headerOnly);
  el.toggleAttribute('data-fixed-header', settings.fixedHeader);
  el.toggleAttribute('data-compact-mode', settings.compactMode);
  el.toggleAttribute('data-cursor-glow', settings.cursorGlow);
  try { localStorage.setItem('layoutSettings', JSON.stringify(settings)); } catch { /* storage unavailable */ }
}

export function ThemeProvider({ children }) {
  // ── Theme (dark/light) ──
  const [theme, setTheme] = useState(() => {
    try {
      const stored = localStorage.getItem('theme');
      if (stored) return stored;
    } catch { /* storage unavailable */ }
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
  });

  // ── Skin ──
  const [skin, setSkinState] = useState(() => {
    try {
      const stored = localStorage.getItem('skin');
      if (stored && SKINS.some(s => s.id === stored)) return stored;
    } catch { /* storage unavailable */ }
    return 'default';
  });

  // ── OLED mode ──
  const [oled, setOledState] = useState(() => {
    try {
      return localStorage.getItem('oled') === 'true';
    } catch { /* storage unavailable */ }
    return false;
  });

  // ── Layout settings ──
  const [layoutSettings, setLayoutSettingsState] = useState(() => {
    try {
      const stored = localStorage.getItem('layoutSettings');
      if (stored) return { ...LAYOUT_PRESETS.default, ...JSON.parse(stored) };
    } catch { /* storage unavailable */ }
    return { ...LAYOUT_PRESETS.default };
  });

  // ── Refs for stable access in callbacks ──
  const themeRef = useRef(theme);
  const animatingRef = useRef(false);

  // Keep themeRef in sync with state
  useLayoutEffect(() => {
    themeRef.current = theme;
    applyThemeToDom(theme);
  }, [theme]);

  // Sync DOM on mount
  useLayoutEffect(() => {
    applySkinToDom(skin);
    applyOledToDom(oled);
    applyLayoutToDom(layoutSettings);
  }, []);

  // Remove inline background set by theme-init.js
  useLayoutEffect(() => {
    document.documentElement.style.removeProperty('background-color');
  }, []);

  // ── Toggle dark/light ──
  const toggleTheme = useCallback((event) => {
    if (animatingRef.current) return;

    const next = themeRef.current === 'dark' ? 'light' : 'dark';
    themeRef.current = next;

    const canWave = typeof document.startViewTransition === 'function' && !prefersReducedMotion();
    if (!canWave) {
      setTheme(next);
      applyThemeToDom(next);
      return;
    }

    let x = event?.clientX;
    let y = event?.clientY;
    if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) {
      const rect = event?.currentTarget?.getBoundingClientRect?.();
      if (rect) { x = rect.left + rect.width / 2; y = rect.top + rect.height / 2; }
      else { x = window.innerWidth - 60; y = 30; }
    }

    animatingRef.current = true;
    const unlock = () => { animatingRef.current = false; };

    try {
      document.documentElement.classList.add('theme-animating');

      const viewTransition = document.startViewTransition(() => {
        flushSync(() => {
          setTheme(next);
          applyThemeToDom(next);
        });
      });

      viewTransition.ready
        .then(() => {
          const endRadius = Math.hypot(
            Math.max(x, window.innerWidth - x),
            Math.max(y, window.innerHeight - y)
          );
          document.documentElement.animate(
            {
              clipPath: [
                `circle(0px at ${x}px ${y}px)`,
                `circle(${endRadius}px at ${x}px ${y}px)`,
              ],
            },
            {
              duration: WAVE_DURATION_MS,
              easing: WAVE_EASING,
              pseudoElement: '::view-transition-new(root)',
            }
          );
        })
        .catch(() => {});

      viewTransition.finished.then(() => {
        document.documentElement.classList.remove('theme-animating');
        unlock();
      }, () => {
        document.documentElement.classList.remove('theme-animating');
        unlock();
      });
    } catch {
      document.documentElement.classList.remove('theme-animating');
      setTheme(next);
      applyThemeToDom(next);
      unlock();
    }
  }, []);

  // ── Set skin ──
  const setSkin = useCallback((skinId) => {
    setSkinState(skinId);
    applySkinToDom(skinId);
  }, []);

  // ── Toggle OLED ──
  const toggleOled = useCallback(() => {
    setOledState(prev => {
      const next = !prev;
      applyOledToDom(next);
      return next;
    });
  }, []);

  // ── Update layout settings ──
  const setLayoutSettings = useCallback((updates) => {
    setLayoutSettingsState(prev => {
      const next = { ...prev, ...updates };
      applyLayoutToDom(next);
      return next;
    });
  }, []);

  // ── Apply layout preset ──
  const applyLayoutPreset = useCallback((presetKey) => {
    const preset = LAYOUT_PRESETS[presetKey];
    if (preset) {
      setLayoutSettingsState(preset);
      applyLayoutToDom(preset);
    }
  }, []);

  return (
    <ThemeContext.Provider value={{
      theme, toggleTheme,
      skin, setSkin,
      oled, toggleOled,
      layoutSettings, setLayoutSettings, applyLayoutPreset,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
