import { useMemo, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/** Flottant aléatoire entre min et max */
function random(min, max) {
  return min + Math.random() * (max - min);
}

/** Entier aléatoire entre min et max inclus */
function randomInt(min, max) {
  return Math.floor(random(min, max + 1));
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

/* ─────────────────────────────────────────────────────────────────────────────
   1. NEIGE — flocons plus visibles, taille variée, balancement naturel
───────────────────────────────────────────────────────────────────────────── */
function Snowfall({ count = 55 }) {
  const particles = useMemo(() => {
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: random(0, 100),          // %
      size: random(3, 7),            // px — plus visibles qu'avant
      fallDuration: random(7, 18),   // s
      sway: random(-40, 40),         // px
      opacity: random(0.18, 0.45),   // plus présents
      delay: random(-20, 0),
    }));
  }, [count]);

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" style={{ zIndex: 1 }}>
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: `${p.left}%`,
            top: '-10px',
            width: p.size,
            height: p.size,
            background: 'white',
            opacity: p.opacity,
            mixBlendMode: 'screen',
            boxShadow: `0 0 ${p.size * 2}px rgba(255,255,255,0.4)`,
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
   2. GUIRLANDE LUMINEUSE — rangée d'ampoules le long du haut du viewport
      Petits cercles colorés qui clignotent en alternance, espacés régulièrement.
───────────────────────────────────────────────────────────────────────────── */
const LIGHT_COLORS = ['#ff4444', '#ffcc00', '#44cc44', '#4488ff', '#ff66cc', '#ff8800'];

function FairyLights({ color }) {
  // On utilise la couleur choisie + 5 couleurs festives classiques
  const colors = useMemo(() => [color, ...LIGHT_COLORS], [color]);
  const count = 28; // nombre d'ampoules

  const lights = useMemo(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      color: colors[i % colors.length],
      delay: (i * 0.18) % 3.5,
      duration: random(1.8, 3.2),
    }))
  , [colors]);

  return (
    <div
      className="pointer-events-none fixed top-0 left-0 right-0 overflow-hidden"
      style={{ height: '20px', zIndex: 2 }}
    >
      {/* Fil de la guirlande */}
      <div
        className="absolute top-[7px] left-0 right-0"
        style={{ height: '1px', background: 'rgba(255,255,255,0.15)' }}
      />
      {lights.map((light, i) => {
        const xPercent = (i / (count - 1)) * 100;
        // Légère courbe sinusoïdale pour que le fil ondule
        const yOffset = Math.sin((i / count) * Math.PI * 2) * 3;
        return (
          <motion.div
            key={light.id}
            className="absolute rounded-full"
            style={{
              left: `${xPercent}%`,
              top: `${5 + yOffset}px`,
              width: '7px',
              height: '9px',
              borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
              background: light.color,
              transform: 'translateX(-50%)',
              boxShadow: `0 0 6px 2px ${light.color}88, 0 0 12px 4px ${light.color}44`,
            }}
            animate={{
              opacity: [0.3, 1, 0.3, 0.9, 0.3],
              scale: [0.85, 1, 0.9, 1.05, 0.85],
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
   3. BOKEH — grandes sphères floues et transparentes qui dérivent lentement
      Effet "lumières de fête en arrière-plan", très élégant, non intrusif.
───────────────────────────────────────────────────────────────────────────── */
function BokehLights({ color }) {
  const orbs = useMemo(() => [
    { id: 0, size: 220, x: 10,  y: 15,  dx: 30,  dy: 20,  duration: 14, delay: 0,   opacity: 0.06, c: color },
    { id: 1, size: 180, x: 75,  y: 60,  dx: -20, dy: 30,  duration: 18, delay: 3,   opacity: 0.05, c: LIGHT_COLORS[0] },
    { id: 2, size: 260, x: 85,  y: 10,  dx: -25, dy: 25,  duration: 16, delay: 1.5, opacity: 0.05, c: LIGHT_COLORS[2] },
    { id: 3, size: 150, x: 40,  y: 75,  dx: 20,  dy: -20, duration: 12, delay: 5,   opacity: 0.06, c: LIGHT_COLORS[3] },
    { id: 4, size: 200, x: 5,   y: 70,  dx: 35,  dy: -15, duration: 20, delay: 2,   opacity: 0.04, c: LIGHT_COLORS[4] },
    { id: 5, size: 170, x: 55,  y: 30,  dx: -30, dy: 20,  duration: 15, delay: 7,   opacity: 0.05, c: color },
  ], [color]);

  return (
    <div
      className="pointer-events-none fixed inset-0 overflow-hidden"
      style={{ zIndex: 0, mixBlendMode: 'screen' }}
    >
      {orbs.map((o) => (
        <motion.div
          key={o.id}
          className="absolute rounded-full"
          style={{
            left: `${o.x}%`,
            top: `${o.y}%`,
            width: o.size,
            height: o.size,
            background: `radial-gradient(circle, ${o.c}cc 0%, transparent 70%)`,
            filter: 'blur(45px)',
            opacity: o.opacity,
            translateX: '-50%',
            translateY: '-50%',
          }}
          animate={{
            x: [0, o.dx, 0, -o.dx * 0.5, 0],
            y: [0, o.dy, 0, -o.dy * 0.7, 0],
            scale: [1, 1.1, 0.95, 1.05, 1],
          }}
          transition={{
            duration: o.duration,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: o.delay,
          }}
        />
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   4. ÉTOILE FILANTE — traverse l'écran en diagonale toutes les ~20s
      Un seul trait lumineux avec une traînée qui s'estompe.
───────────────────────────────────────────────────────────────────────────── */
function ShootingStar({ color }) {
  const [visible, setVisible] = useState(false);
  const [startX] = useState(() => random(20, 80)); // % horizontal de départ

  useEffect(() => {
    // Première étoile après 4-8s, puis toutes les 18-25s
    const firstDelay = random(4000, 8000);
    let timer;
    const fire = () => {
      setVisible(true);
      // Cache après 1.5s (durée de l'animation)
      setTimeout(() => {
        setVisible(false);
        timer = setTimeout(fire, random(18000, 25000));
      }, 1500);
    };
    timer = setTimeout(fire, firstDelay);
    return () => clearTimeout(timer);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="pointer-events-none fixed"
          style={{
            top: '8%',
            left: `${startX}%`,
            zIndex: 2,
            width: '80px',
            height: '2px',
            background: `linear-gradient(90deg, transparent 0%, ${color}cc 40%, white 100%)`,
            borderRadius: '1px',
            boxShadow: `0 0 6px ${color}88`,
            rotate: '25deg',
            transformOrigin: 'right center',
          }}
          initial={{ scaleX: 0, opacity: 0, x: 0, y: 0 }}
          animate={{ scaleX: [0, 1, 1], opacity: [0, 1, 0], x: [0, 160], y: [0, 80] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
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

  if (!enabled || reduced) return null;

  return (
    <>
      {/* Bokeh — grandes sphères floues en arrière-plan (mix-blend-mode:screen) */}
      <BokehLights color={color} />
      {/* Guirlande lumineuse le long du haut du viewport */}
      <FairyLights color={color} />
      {/* Étoile filante toutes les ~20s */}
      <ShootingStar color={color} />
      {/* Neige — flocons plus visibles qu'avant */}
      <Snowfall count={55} />
    </>
  );
}
