import { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';

/** Retourne un flottant aléatoire entre min et max */
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

/**
 * ─── Flocons de neige ────────────────────────────────────────────────────────
 * Petits points blancs quasi-transparents avec mix-blend-mode:screen pour ne
 * jamais masquer le contenu — ils s'intègrent naturellement à l'interface.
 */
function Snowfall({ count = 35 }) {
  const particles = useMemo(() => {
    const arr = [];
    for (let i = 0; i < count; i++) {
      arr.push({
        id: i,
        left: random(0, 100),        // % horizontal
        size: random(2, 4),          // px
        fallDuration: random(8, 20), // s — lente chute naturelle
        sway: random(-25, 25),       // px de balancement
        opacity: random(0.10, 0.22), // très discret
        delay: random(-18, 0),       // départ étalé
      });
    }
    return arr;
  }, [count]);

  return (
    <div
      className="pointer-events-none fixed inset-0 overflow-hidden"
      style={{ zIndex: 0 }}
    >
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: `${p.left}%`,
            top: '-6px',
            width: p.size,
            height: p.size,
            background: 'white',
            opacity: p.opacity,
            mixBlendMode: 'screen',
          }}
          animate={{
            y: ['0vh', '105vh'],
            x: [0, p.sway, 0, -p.sway, 0],
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

/**
 * ─── Lueur d'ambiance ────────────────────────────────────────────────────────
 * Deux halos colorés très flous (opacity: 0.06) aux coins de l'écran.
 * mix-blend-mode:screen les fusionne à l'interface sans la recouvrir.
 */
function Atmosphere({ color }) {
  return (
    <div
      className="pointer-events-none fixed inset-0 overflow-hidden"
      style={{ zIndex: 0, mixBlendMode: 'screen', opacity: 0.06 }}
    >
      <motion.div
        className="absolute -top-24 -right-24 rounded-full"
        style={{
          width: 380,
          height: 380,
          background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
          filter: 'blur(55px)',
        }}
        animate={{ scale: [1, 1.12, 1], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -bottom-24 -left-24 rounded-full"
        style={{
          width: 320,
          height: 320,
          background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
          filter: 'blur(55px)',
        }}
        animate={{ scale: [1, 1.18, 1], opacity: [0.6, 0.95, 0.6] }}
        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut', delay: 2.5 }}
      />
    </div>
  );
}

/**
 * ─── Étoiles scintillantes ───────────────────────────────────────────────────
 * 10 micro-points colorés dans la bande supérieure de l'écran.
 * Apparaissent/disparaissent doucement — à peine perceptibles.
 */
function StarSparkles({ color }) {
  const stars = useMemo(() =>
    Array.from({ length: 10 }, (_, i) => ({
      id: i,
      top: random(1, 15),        // % — zone haute seulement
      left: random(3, 97),       // %
      size: random(1.5, 2.5),    // px — minuscules
      duration: random(2.5, 6),
      delay: random(0, 5),
      peakOpacity: random(0.12, 0.28),
    }))
  , []);

  return (
    <div
      className="pointer-events-none fixed inset-0 overflow-hidden"
      style={{ zIndex: 0 }}
    >
      {stars.map((s) => (
        <motion.div
          key={s.id}
          className="absolute rounded-full"
          style={{
            top: `${s.top}%`,
            left: `${s.left}%`,
            width: s.size,
            height: s.size,
            background: color,
            mixBlendMode: 'screen',
          }}
          animate={{ opacity: [0, s.peakOpacity, 0], scale: [0.6, 1.3, 0.6] }}
          transition={{
            duration: s.duration,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: s.delay,
          }}
        />
      ))}
    </div>
  );
}

/**
 * ─── Composant principal ─────────────────────────────────────────────────────
 * Tous les effets utilisent des opacités très basses + mix-blend-mode:screen
 * pour rester discrets et ne jamais masquer le contenu de l'interface.
 */
export default function ChristmasEffects({ enabled = true, color = '#0067ff' }) {
  const reduced = useReducedMotion();

  if (!enabled || reduced) return null;

  return (
    <>
      {/* Lueur d'ambiance colorée aux coins — opacité 6% */}
      <Atmosphere color={color} />
      {/* Étoiles scintillantes dans la zone haute — opacité max 28% */}
      <StarSparkles color={color} />
      {/* Flocons de neige — opacité max 22%, mix-blend-mode:screen */}
      <Snowfall count={35} />
    </>
  );
}
