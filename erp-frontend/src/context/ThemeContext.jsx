import { createContext, useContext, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { flushSync } from 'react-dom';

const ThemeContext = createContext(null);

// ─── Réglages de la vague circulaire (View Transitions API) ──────────────────
const WAVE_DURATION_MS = 450;
const WAVE_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Applique la classe .dark sur <html> + persiste — idempotent
function applyThemeToDom(next) {
  document.documentElement.classList.toggle('dark', next === 'dark');
  try { localStorage.setItem('theme', next); } catch { /* stockage indisponible */ }
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try {
      const stored = localStorage.getItem('theme');
      if (stored) return stored;
    } catch { /* stockage indisponible */ }
    // Même logique que public/theme-init.js : préférence système, sinon sombre.
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
  });

  // Miroir synchrone du thème pour lire la valeur courante dans le callback stable
  const themeRef = useRef(theme);
  // Verrou anti double-clic : ignore les toggles tant que la vague joue
  const animatingRef = useRef(false);

  // useLayoutEffect (et non useEffect) : la classe est posée AVANT le paint →
  // zéro flash au montage, et mutation DOM synchrone dans le callback des View
  // Transitions quand on passe par flushSync ci-dessous.
  useLayoutEffect(() => {
    applyThemeToDom(theme);
    themeRef.current = theme;
  }, [theme]);

  // Le fond critique posé en inline par theme-init.js a rempli son rôle :
  // la feuille de style est chargée (les scripts s'exécutent après le CSS), on le
  // retire pour laisser les transitions CSS gérer ce fond lors des bascules.
  useLayoutEffect(() => {
    document.documentElement.style.removeProperty('background-color');
  }, []);

  const toggleTheme = useCallback((event) => {
    if (animatingRef.current) return;

    const next = themeRef.current === 'dark' ? 'light' : 'dark';

    // Fallback (Firefox ancien / mouvement réduit) : bascule directe.
    // La transition CSS globale des couleurs (index.css) assure quand même un fondu doux.
    const canWave = typeof document.startViewTransition === 'function' && !prefersReducedMotion();
    if (!canWave) {
      setTheme(next);
      return;
    }

    // Origine de la vague : position réelle du clic ; clavier → centre du bouton ;
    // programmematique → coin supérieur droit (zone du bouton dans le header).
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
      // Ajouter .theme-animating pour supprimer les transitions CSS globales
      // pendant que la vague circulaire gère l'animation des couleurs.
      document.documentElement.classList.add('theme-animating');

      const viewTransition = document.startViewTransition(() => {
        // flushSync : React commit le nouveau rendu DEHORS le snapshot « new ».
        // Le useLayoutEffect applique la classe .dark avant le retour du callback.
        flushSync(() => setTheme(next));
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

      // Retirer .theme-animating quand la vague est terminée
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
      unlock();
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
