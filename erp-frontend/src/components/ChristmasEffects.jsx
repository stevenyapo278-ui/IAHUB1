import { useMemo, useState } from 'react';
import { motion, useAnimationFrame, useMotionValue, useSpring } from 'framer-motion';
import {
  Star, Gift, Snowflake, TreePine, CandyCane,
  Sparkles, Heart, Bell, Balloon, Lightbulb,
} from 'lucide-react';

/**
 * ─── Hooks & Utils ─────────────────────────────────────────────────────────────
 */

/** Génère une valeur aléatoire dans une plage, avec légère variation appliquée difficilement */
function random(min, max) {
  return Math.random() * (max - min) + min;
}

/** Couleurs dérivées du skin actif (pernex que le skin est appliqué) */
function useActiveSkinColors() {
  // On lit les variables CSS directement depuis le document (theme appliqué)
  const get = (varName, fallback) => {
    if (typeof window === 'undefined') return fallback;
    const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return val || fallback;
  };
  return {
    primary: get('--skin-primary', '#0067ff'),
    primaryDark: get('--skin-primary-hover', '#0058db'),
    background: get('--skin-background', '#f6f7f9'),
    surface: get('--skin-surface', '#ffffff'),
  };
}

/** Décide si l'effet doit être actif (modal réduite, prefers-reduced-motion, etc.) */
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useAnimationFrame((_, delta) => {
    // Ne pas recalculer à chaque frame si déjà résolu
    if (typeof window === 'undefined') return;
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(m.matches);
  });
  return reduced;
}

export { useReducedMotion };

/**
 * ─── Effet de ciel étoilé ─────────────────────────────────────────────────────
 * Placé en arrière-plan ; 300 étoiles avec dégradés, trajectoires légèrement
 * différents, et un scintillement par morphing d'opacité/scale.
 */
function StarField({ color, speed = 1, count = 300, className }) {
  const [active, setActive] = useState(true);

  // Génération côté render (lightweight)
  const stars = useMemo(() => {
    const arr = [];
    for (let i = 0; i < count; i++) {
      const size = random(1, 3);
      const delay = random(0, 5);
      const duration = random(2.5, 6);
      const x = random(-8, 608);
      const y = random(-8, 488);
      const opacity = random(0.25, 0.75);
      const twinklePhase = random(0, Math.PI * 2);
      arr.push({ id: i, x, y, size, delay, duration, opacity, twinklePhase });
    }
    return arr;
  }, [count]);

  return (
    <>
      {active && (
        <div
          className={`pointer-events-none fixed inset-0 overflow-hidden ${className ?? ''}`}
          style={{ zIndex: 0 }}
        >
          {stars.map((s) => (
            <motion.div
              key={s.id}
              initial={{ x: s.x, y: s.y, opacity: 0 }}
              animate={{
                x: [s.x, s.x + random(-20, 20), s.x],
                y: [s.y, s.y + random(-20, 20), s.y],
                opacity: [s.opacity, s.opacity * 0.4, s.opacity],
              }}
              transition={{
                duration: s.duration,
                repeat: Infinity,
                repeatType: 'loop',
                ease: 'easeOut',
                delay: s.delay,
                times: [0, 0.5, 1],
              }}
              style={{
                width: s.size,
                height: s.size,
                borderRadius: '50%',
                background: color ?? 'rgba(255,255,255,0.9)',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * ─── Effet de guirlande lumineuse (parallèle, fade) ──────────────────────────
 * Deux guirlandes flottantes qui dansent doucement, avec un "sparkle"
 * qui circule le long.
 */
function Garland({ color, speed = 1, className }) {
  const [active, setActive] = useState(true);

  const points = useMemo(() => {
    const p = [];
    for (let i = 0; i < 14; i++) {
      p.push({ id: i, x: random(10, 790), y: 120 + random(20, 280) });
    }
    return p;
  }, []);

  // Un sparkle qui parcourt les points
  const sparkleX = useMotionValue(0);
  const sparkleY = useMotionValue(0);
  const springSparkleX = useSpring(sparkleX, { stiffness: 60, damping: 18 });
  const springSparkleY = useSpring(sparkleY, { stiffness: 60, damping: 18 });

  useAnimationFrame((_, dt) => {
    if (!active) return;
    const progress = (dt * 0.001) * speed * 0.25;
    const idx = Math.floor((progress % 1) * points.length);
    const next = Math.min(idx + 1, points.length - 1);
    const t = (progress % 1) * (points.length - 1) - idx;
    sparkleX.set(points[idx].x + (points[next].x - points[idx].x) * t);
    sparkleY.set(points[idx].y + (points[next].y - points[idx].y) * t);
  });

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className ?? ''}`}>
      {/* Fil A */}
      <motion.div
        style={{
          x: sparkleX,
          y: sparkleY,
          translateX: '-50%',
          translateY: '-50%',
          background: `color-mix(in srgb, ${color} 55%, transparent)`,
        }}
        className="absolute w-[2px] h-full top-0 origin-top"
      />
      {/* Fil B (décalé) */}
      <motion.div
        style={{
          x: sparkleX,
          y: sparkleY,
          translateX: '-50%',
          translateY: '-50%',
          background: `color-mix(in srgb, ${color} 45%, transparent) `,
          animation: `pulse-var 3.2s ease-in-out infinite`,
        }}
        className="absolute w-[2px] h-full top-0 origin-top"
      />
      {/* Bulles */}
      {points.map((pt) => (
        <motion.div
          key={pt.id}
          style={{
            x: pt.x,
            y: pt.y,
            translateX: '-50%',
            translateY: '-50%',
            background: color,
          }}
          animate={{ scale: [1, 1.6, 1], opacity: [0.3, 1, 0.3] }}
          transition={{ duration: random(2.5, 4.5), repeat: Infinity, ease: 'easeInOut' }}
          className="w-[6px] h-[6px] rounded-full origin-center"
        />
      ))}
    </div>
  );
}

/**
 * ─── Couche de flou / ambiance Noël ──────────────────────────────────────────
 * Un torus bleu nuit qui doucement tourne autour de l'axe Z, donnant un
 * aspect "photographie nocturne de Noël".
 */
function Atmosphere({ color, speed = 1, className }) {
  const [active, setActive] = useState(true);
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className ?? ''}`}>
      {/* Sparge de lumière */}
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage: `
            radial-gradient(circle at 20% 30%, ${color} 0%, transparent 50%),
            radial-gradient(circle at 80% 70%, ${color} 0%, transparent 50%),
            radial-gradient(circle at 50% 100%, ${color} 0%, transparent 50%),
            radial-gradient(circle at 10% 60%, ${color} 0%, transparent 50%),
            radial-gradient(circle at 90% 40%, ${color} 0%, transparent 50%)
          `,
          backgroundSize: '300px 300px',
        }}
      />
      {/* Torus de série qui tourne */}
      <motion.div
        animate={{
          rotate: 360 * speed * 6,
          scale: [1, 1.25, 1],
        }}
        transition={{
          duration: 14,
          repeat: Infinity,
          ease: 'easeInOut',
          repeatType: 'loop',
        }}
        className="absolute -inset-10 rounded-full opacity-40"
        style={{
          background: `radial-gradient(circle, ${color} 0%, transparent 65%)`,
          filter: 'blur(32px)',
        }}
      />
    </div>
  );
}

/**
 * ─── Collection d'icônes Noël (pour le panneau de préférence) ────────────────
 */
const ChristmasIcons = {
  star: Star,
  gift: Gift,
  snowflake: Snowflake,
  tree: TreePine,
  candy: CandyCane,
  sparkles: Sparkles,
  heart: Heart,
  bell: Bell,
  balloons: Balloon,
  lights: Lightbulb,
};

/**
 * ─── Neige ───────────────────────────────────────────────────────────────────
 */
function Snowfall({ color, count = 80, className }) {
  const particles = useMemo(() => {
    const arr = [];
    for (let i = 0; i < count; i++) {
      arr.push({
        id: i,
        top: Math.random() * 100,
        left: Math.random() * 100,
        size: 2 + Math.random() * 3,
        speed: 20 + Math.random() * 30,
        opacity: 0.3 + Math.random() * 0.4,
        delay: Math.random() * 5,
      });
    }
    return arr;
  }, [count]);

  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className ?? ''}`}
      style={{ zIndex: 0 }}
    >
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{
            top: p.top,
            left: p.left,
            width: p.size,
            height: p.size,
            background: 'white',
            borderRadius: '50%',
            opacity: p.opacity,
          }}
          animate={{
            y: [0, p.speed + Math.random() * 30],
            opacity: [p.opacity, p.opacity * 0.3, p.opacity],
          }}
          transition={{
            duration: p.speed + Math.random() * 20,
            repeat: Infinity,
            repeatType: 'loop',
            ease: 'linear',
            delay: p.delay,
            times: [0, 1],
          }}
        />
      ))}
    </div>
  );
}

export default function ChristmasEffects({ enabled = true, color = '#0067ff' }) {
  const reduced = useReducedMotion();

  if (!enabled || reduced) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* Sanglons de fond */}
      <StarField color={color} speed={1} count={280} />
      <Garland color={color} speed={1} />
      <Atmosphere color={color} speed={1} />
      {/* Neige qui tombe */}
      <Snowfall color={color} count={60} />
      {/* Étoiles fixes scintillantes en haut à droite */}
      <div className="absolute right-8 top-8">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            animate={{ opacity: [0.6, 1, 0.6], scale: [1, 1.2, 1] }}
            transition={{
              duration: 2.5 + i * 0.6,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: i * 0.2,
            }}
            className="w-3 h-3 rounded-full"
            style={{ background: color }}
          />
        ))}
      </div>
    </div>
  );
}
