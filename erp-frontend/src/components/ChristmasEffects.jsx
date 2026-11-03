import { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/** Flottant aléatoire entre min et max */
function random(min, max) {
  return min + Math.random() * (max - min);
}

/** Retourne true si l'utilisateur préfère les animations réduites */
function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

export { useReducedMotion };

/** Détecte si on est en mode sombre (classe 'dark' sur <html>) */
function useDarkMode() {
  const [isDark, setIsDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

/* ─────────────────────────────────────────────────────────────────────────────
   1. NEIGE — visible sur fond clair ET sombre
      Mode sombre : flocons blancs semi-transparents
      Mode clair  : flocons bleu-gris légers (pas de mixBlendMode:screen)
───────────────────────────────────────────────────────────────────────────── */
function Snowfall({ count = 55, isDark }) {
  const particles = useMemo(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      left: random(0, 100),
      size: random(3, 7),
      fallDuration: random(7, 18),
      sway: random(-40, 40),
      opacity: isDark ? random(0.25, 0.55) : random(0.35, 0.65),
      delay: random(-20, 0),
    }))
  , [count, isDark]);

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" style={{ zIndex: 35 }}>
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: `${p.left}%`,
            top: '-10px',
            width: p.size,
            height: p.size,
            // Blanc en mode sombre, bleu-gris en mode clair
            background: isDark ? 'rgba(255,255,255,0.9)' : 'rgba(150,180,220,0.9)',
            opacity: p.opacity,
            boxShadow: isDark
              ? `0 0 ${p.size * 2}px rgba(255,255,255,0.3)`
              : `0 0 ${p.size}px rgba(100,150,200,0.2)`,
          }}
          animate={{
            y: ['0vh', '108vh'],
            x: [0, p.sway, 0, -p.sway * 0.6, 0],
          }}
          transition={{
            y: { duration: p.fallDuration, repeat: Infinity, ease: 'linear', delay: p.delay },
            x: { duration: p.fallDuration * 0.55, repeat: Infinity, ease: 'easeInOut', delay: p.delay },
          }}
        />
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   2. GUIRLANDE LUMINEUSE — z-index 45 (au-dessus du header z-30)
      Rangée d'ampoules colorées le long du haut du viewport, pointer-events:none
───────────────────────────────────────────────────────────────────────────── */
const LIGHT_COLORS = ['#ff3333', '#ffcc00', '#33cc44', '#3377ff', '#ff55cc', '#ff8800', '#aa44ff'];

function FairyLights({ color }) {
  const colors = useMemo(() => [color, ...LIGHT_COLORS], [color]);
  const count = 30;

  const lights = useMemo(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      color: colors[i % colors.length],
      delay: (i * 0.15) % 3,
      duration: random(1.6, 3.0),
      yOffset: Math.sin((i / count) * Math.PI * 4) * 3, // ondulation du fil
    }))
  , [colors]);

  return (
    // z-index 45 : au-dessus du header (z-30 = 30) mais sous les modales (z-50+)
    <div
      className="pointer-events-none fixed top-0 left-0 right-0"
      style={{ height: '22px', zIndex: 45 }}
    >
      {/* Fil de la guirlande */}
      <div
        className="absolute left-0 right-0"
        style={{ top: '8px', height: '1.5px', background: 'rgba(100,100,100,0.3)' }}
      />
      {lights.map((light, i) => {
        const xPercent = (i / (count - 1)) * 100;
        return (
          <motion.div
            key={light.id}
            className="absolute"
            style={{
              left: `${xPercent}%`,
              top: `${6 + light.yOffset}px`,
              width: '8px',
              height: '10px',
              borderRadius: '50% 50% 50% 50% / 55% 55% 45% 45%',
              background: light.color,
              transform: 'translateX(-50%)',
              boxShadow: `0 0 6px 2px ${light.color}99, 0 0 14px 5px ${light.color}44`,
            }}
            animate={{
              opacity: [0.25, 1, 0.4, 0.95, 0.25],
              scale: [0.85, 1.05, 0.9, 1, 0.85],
            }}
            transition={{
              duration: light.duration,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: light.delay,
            }}
          />
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   3. BOKEH — grandes sphères floues, adaptées clair/sombre
      Mode sombre : opacity ~0.08, couleurs vives
      Mode clair  : opacity ~0.06 sans mixBlendMode (visible sur fond blanc)
───────────────────────────────────────────────────────────────────────────── */
function BokehLights({ color, isDark }) {
  const orbs = useMemo(() => [
    { id: 0, size: 280, x: 8,   y: 12,  dx: 30,  dy: 22,  dur: 14, delay: 0,   c: color },
    { id: 1, size: 200, x: 78,  y: 58,  dx: -22, dy: 28,  dur: 18, delay: 3,   c: LIGHT_COLORS[0] },
    { id: 2, size: 320, x: 88,  y: 8,   dx: -28, dy: 24,  dur: 16, delay: 1.5, c: LIGHT_COLORS[2] },
    { id: 3, size: 180, x: 42,  y: 80,  dx: 22,  dy: -22, dur: 12, delay: 5,   c: LIGHT_COLORS[3] },
    { id: 4, size: 240, x: 4,   y: 68,  dx: 32,  dy: -18, dur: 20, delay: 2,   c: LIGHT_COLORS[4] },
    { id: 5, size: 200, x: 55,  y: 35,  dx: -28, dy: 22,  dur: 15, delay: 7,   c: color },
  ], [color]);

  const opacity = isDark ? 0.08 : 0.05;

  return (
    // Pas de mixBlendMode sur le container → visible sur fond blanc aussi
    <div className="pointer-events-none fixed inset-0 overflow-hidden" style={{ zIndex: 0 }}>
      {orbs.map((o) => (
        <motion.div
          key={o.id}
          className="absolute rounded-full"
          style={{
            left: `${o.x}%`,
            top: `${o.y}%`,
            width: o.size,
            height: o.size,
            background: `radial-gradient(circle, ${o.c} 0%, transparent 70%)`,
            filter: 'blur(50px)',
            opacity,
            translateX: '-50%',
            translateY: '-50%',
          }}
          animate={{
            x: [0, o.dx, 0, -o.dx * 0.5, 0],
            y: [0, o.dy, 0, -o.dy * 0.7, 0],
            scale: [1, 1.08, 0.96, 1.04, 1],
          }}
          transition={{ duration: o.dur, repeat: Infinity, ease: 'easeInOut', delay: o.delay }}
        />
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   4. ÉTOILE FILANTE — traverse l'écran toutes les 18-25s
───────────────────────────────────────────────────────────────────────────── */
function ShootingStar({ color }) {
  const [visible, setVisible] = useState(false);
  const [startX] = useState(() => random(15, 70));

  useEffect(() => {
    let timer;
    const fire = () => {
      setVisible(true);
      setTimeout(() => {
        setVisible(false);
        timer = setTimeout(fire, random(18000, 26000));
      }, 1400);
    };
    timer = setTimeout(fire, random(3000, 7000));
    return () => clearTimeout(timer);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="pointer-events-none fixed"
          style={{
            top: '10%',
            left: `${startX}%`,
            zIndex: 36,
            width: '90px',
            height: '2px',
            background: `linear-gradient(90deg, transparent 0%, ${color}bb 35%, white 100%)`,
            borderRadius: '1px',
            boxShadow: `0 0 8px 2px ${color}66`,
            rotate: '28deg',
            transformOrigin: 'right center',
          }}
          initial={{ scaleX: 0, opacity: 0, x: 0, y: 0 }}
          animate={{ scaleX: [0, 1, 1], opacity: [0, 1, 0], x: [0, 180], y: [0, 90] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
        />
      )}
    </AnimatePresence>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   COMPOSANT PRINCIPAL
───────────────────────────────────────────────────────────────────────────── */
export default function ChristmasEffects({ enabled = true, color = '#0067ff' }) {
  const reduced = useReducedMotion();
  const isDark = useDarkMode();

  if (!enabled || reduced) return null;

  return (
    <>
      {/* Bokeh — halos colorés flous en arrière-plan (z-index 0) */}
      <BokehLights color={color} isDark={isDark} />
      {/* Guirlande — z-index 45, au-dessus du header */}
      <FairyLights color={color} />
      {/* Étoile filante — z-index 36 */}
      <ShootingStar color={color} />
      {/* Neige — z-index 35, couleur adaptée clair/sombre */}
      <Snowfall count={55} isDark={isDark} />
    </>
  );
}
