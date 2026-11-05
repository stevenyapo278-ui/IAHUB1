// Confettis de célébration de Noël — s'appuie sur `canvas-confetti`, déjà utilisé
// dans le projet (KnowledgeBase.jsx). Inspiré de NOEL/noel/confetti.js.

import confetti from 'canvas-confetti';
import { readXmasPrefs } from '../hooks/useXmas';

const COLORS = ['#d4af37', '#f5d77a', '#c0392b', '#e74c3c', '#1f8a4c', '#ffffff'];

/**
 * Célébration « ticket résolu / fermé ».
 *
 * Ne fait rien si le thème de Noël n'est pas effectivement actif, si les
 * confettis sont désactivés ou si le système demande moins d'animations.
 * `origin` accepte l'évènement de clic, un élément DOM, ou rien.
 */
export function celebrate(origin) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  // Classe posée par AnimatedBackground : tient compte du forçage admin.
  if (!root.classList.contains('xmas-on')) return;
  if (readXmasPrefs().confetti === false) return;

  const width = window.innerWidth || 1;
  const height = window.innerHeight || 1;

  let point;
  if (origin?.clientX != null) {
    point = { x: origin.clientX / width, y: origin.clientY / height };
  } else if (origin?.getBoundingClientRect) {
    const rect = origin.getBoundingClientRect();
    point = {
      x: (rect.left + rect.width / 2) / width,
      y: (rect.top + rect.height / 2) / height,
    };
  } else {
    point = { x: 0.5, y: 0.35 };
  }

  confetti({
    particleCount: 140,
    spread: 100,
    startVelocity: 42,
    scalar: 1.05,
    ticks: 220,
    origin: point,
    colors: COLORS,
    zIndex: 95, // sous les toasts, au-dessus des modales et tiroirs
    disableForReducedMotion: true,
  });
}
