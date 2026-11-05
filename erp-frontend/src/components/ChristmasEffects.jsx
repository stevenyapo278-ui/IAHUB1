import { useMemo, useState, useEffect, useRef } from 'react';
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

const LIGHT_COLORS = ['#ff3333', '#ffcc00', '#33cc44', '#3377ff', '#ff55cc', '#ff8800', '#aa44ff'];

/**
 * Durée CSS normalisée par la vitesse.
 */
const dur = (base, speed = 1) =>
  `${Math.max(0.25, base / (Number(speed) || 1)).toFixed(2)}s`;

/* ─────────────────────────────────────────────────────────────────────────────
   1. NEIGE DANS LA SIDEBAR
───────────────────────────────────────────────────────────────────────────── */
export function SidebarSnowfall({ speed = 1 }) {
  const reduced = useReducedMotion();
  const particles = useMemo(() => {
    const count = 24;
    return Array.from({ length: count }, (_, i) => {
      const size = random(2, 4.5);
      return {
        id: i,
        left: random(3, 97),
        size,
        fall: random(9, 16),
        start: random(0, 15),
        opacity: random(0.3, 0.75),
        sway: random(8, 20) * (Math.random() > 0.5 ? 1 : -1),
      };
    });
  }, []);

  if (reduced) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 10 }} aria-hidden="true">
      {particles.map((p) => (
        <span
          key={p.id}
          className="xmas-flake"
          style={{
            left: `${p.left}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            background: 'rgba(255,255,255,0.85)',
            boxShadow: `0 0 ${p.size * 1.5}px rgba(255,255,255,0.45)`,
            animationDuration: dur(p.fall, speed),
            animationDelay: `-${p.start.toFixed(1)}s`,
            opacity: p.opacity,
            '--xmas-sway': `${p.sway}px`,
          }}
        />
      ))}
    </div>
  );
}

export function SidebarGarland({ color = '#0067ff', speed = 1 }) {
  const reduced = useReducedMotion();
  const bulbs = useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) => ({
        id: i,
        x: (i / 4) * 100,
        c: i % 2 === 0 ? color : LIGHT_COLORS[i % LIGHT_COLORS.length],
        delay: (i * 0.3) % 2,
        duration: random(1.8, 3),
      })),
    [color]
  );

  if (reduced) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 overflow-hidden" style={{ height: '16px', zIndex: 11 }} aria-hidden="true">
      <svg viewBox="0 0 200 10" preserveAspectRatio="none" width="100%" height={10}>
        <path d="M0,2 Q100,8 200,2" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.3" />
      </svg>
      {bulbs.map((b) => (
        <span
          key={b.id}
          className="xmas-bulb"
          style={{
            left: `${b.x}%`,
            top: '3px',
            width: '5px',
            height: '7px',
            background: b.c,
            boxShadow: `0 0 3px 1px ${b.c}bb`,
            animationDuration: dur(b.duration, speed),
            animationDelay: `${(-b.delay).toFixed(2)}s`,
          }}
        />
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   2. NEIGE — visible sur fond clair ET sombre
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
    <div className="pointer-events-none fixed inset-0 overflow-hidden" style={{ zIndex: 35 }} aria-hidden="true">
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
   3. GUIRLANDE LUMINEUSE — z-index 45 (au-dessus du header z-30)
      Rangée d'ampoules colorées le long du haut du viewport, pointer-events:none
───────────────────────────────────────────────────────────────────────────── */
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
      aria-hidden="true"
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
   4. GUIRLANDE AVEC FIL FIN (dans le header)
───────────────────────────────────────────────────────────────────────────── */
const G_W = 1200;
const G_H = 26;
const G_SWAGS = 6;
const G_DEPTH = 10;

const swagY = (t) => Math.sin(Math.PI * ((t * G_SWAGS) % 1)) * G_DEPTH;

function garlandPath(depthScale = 1) {
  const steps = 150;
  let d = 'M0,4';
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    d += ` L${(t * G_W).toFixed(1)},${(4 + swagY(t) * depthScale).toFixed(1)}`;
  }
  return d;
}

const BULB_COUNT = 14;

export function ChristmasGarland({ color = '#0067ff', speed = 1 }) {
  const reduced = useReducedMotion();

  const bulbs = useMemo(
    () =>
      Array.from({ length: BULB_COUNT }, (_, i) => {
        const t = i / (BULB_COUNT - 1);
        return {
          id: i,
          t,
          y: swagY(t) + 6,
          c: i % 4 === 0 ? color : LIGHT_COLORS[i % LIGHT_COLORS.length],
          delay: (i * 0.22) % 2.2,
          duration: random(1.8, 3.2),
        };
      }),
    [color]
  );

  if (reduced) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 overflow-hidden"
      style={{ height: `${G_H}px`, zIndex: 10 }}
      aria-hidden="true"
    >
      <svg
        viewBox={`0 0 ${G_W} ${G_H}`}
        preserveAspectRatio="none"
        width="100%"
        height={G_H}
        style={{ display: 'block' }}
      >
        {/* Fil fin élégant */}
        <path
          d={garlandPath(1)}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.3"
        />
      </svg>

      {bulbs.map((b) => (
        <span
          key={b.id}
          className="xmas-bulb"
          style={{
            left: `${(b.t * 100).toFixed(2)}%`,
            top: `${b.y.toFixed(1)}px`,
            background: b.c,
            boxShadow: `0 0 4px 1px ${b.c}bb, 0 0 10px 2px ${b.c}44`,
            animationDuration: dur(b.duration, speed),
            animationDelay: `${(-b.delay).toFixed(2)}s`,
          }}
        />
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   5. BOKEH — grandes sphères floues en arrière-plan
───────────────────────────────────────────────────────────────────────────── */
function BokehLights({ color, isDark, nightMode }) {
  const orbs = useMemo(() => [
    { id: 0, size: 280, x: 8,   y: 12,  dx: 30,  dy: 22,  dur: 14, delay: 0,   c: color },
    { id: 1, size: 200, x: 78,  y: 58,  dx: -22, dy: 28,  dur: 18, delay: 3,   c: LIGHT_COLORS[0] },
    { id: 2, size: 320, x: 88,  y: 8,   dx: -28, dy: 24,  dur: 16, delay: 1.5, c: LIGHT_COLORS[2] },
    { id: 3, size: 180, x: 42,  y: 80,  dx: 22,  dy: -22, dur: 12, delay: 5,   c: LIGHT_COLORS[3] },
    { id: 4, size: 240, x: 4,   y: 68,  dx: 32,  dy: -18, dur: 20, delay: 2,   c: LIGHT_COLORS[4] },
    { id: 5, size: 200, x: 55,  y: 35,  dx: -28, dy: 22,  dur: 15, delay: 7,   c: color },
  ], [color]);

  const opacity = nightMode ? (isDark ? 0.14 : 0.09) : isDark ? 0.08 : 0.05;

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" style={{ zIndex: 0 }} aria-hidden="true">
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
   6. ÉTOILES FILANTES
───────────────────────────────────────────────────────────────────────────── */
function ShootingStar({ color, speed, index = 0, top = 10 }) {
  const [visible, setVisible] = useState(false);
  const [startX, setStartX] = useState(() => random(12, 68));

  useEffect(() => {
    let timer;
    const fire = () => {
      setStartX(random(8, 74));
      setVisible(true);
      timer = setTimeout(() => {
        setVisible(false);
        timer = setTimeout(fire, random(9000, 17000) / (Number(speed) || 1));
      }, 1300 / (Number(speed) || 1));
    };
    timer = setTimeout(fire, (random(1500, 8000) + index * 4200) / (Number(speed) || 1));
    return () => clearTimeout(timer);
  }, [speed, index]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="pointer-events-none fixed"
          style={{
            top: `${top}%`,
            left: `${startX}%`,
            zIndex: 36,
            width: '130px',
            height: '2px',
            background: `linear-gradient(90deg, transparent 0%, ${color}bb 40%, white 100%)`,
            borderRadius: '2px',
            boxShadow: `0 0 10px 2px ${color}66`,
            rotate: '24deg',
            transformOrigin: 'right center',
          }}
          initial={{ scaleX: 0, opacity: 0, x: 0, y: 0 }}
          animate={{ scaleX: [0, 1, 1, 1], opacity: [0, 1, 0.9, 0], x: [0, 140, 300], y: [0, 70, 150] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
        />
      )}
    </AnimatePresence>
  );
}

function ShootingStars({ color, speed }) {
  return (
    <>
      <ShootingStar color={color} speed={speed} index={0} top={9} />
      <ShootingStar color={color} speed={speed} index={1} top={26} />
      <ShootingStar color={color} speed={speed} index={2} top={52} />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   7. CIEL ÉTOILÉ (mode nuit)
───────────────────────────────────────────────────────────────────────────── */
const STAR_TONES = ['rgba(255,255,255,0.95)', 'rgba(173,205,255,0.9)', 'rgba(255,232,170,0.9)', 'rgba(210,230,255,0.85)'];

function NightSky({ speed = 1, isDark }) {
  const stars = useMemo(
    () =>
      Array.from({ length: 110 }, (_, i) => ({
        id: i,
        left: random(0, 100),
        top: random(0, 100),
        size: random(1, 2.8),
        glyph: i % 14 === 0 ? '✦' : null,
        tone: STAR_TONES[i % STAR_TONES.length],
        duration: random(2.2, 5.6),
        delay: random(0, 5),
      })),
    []
  );

  return (
    <>
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          zIndex: 33,
          background: isDark ? '#6d7fb8' : '#8296cc',
          mixBlendMode: 'multiply',
          opacity: isDark ? 0.32 : 0.44,
        }}
        aria-hidden="true"
      />
      <div className="pointer-events-none fixed inset-0" style={{ zIndex: 34 }} aria-hidden="true">
        {stars.map((s) =>
          s.glyph ? (
            <span
              key={s.id}
              className="xmas-nightstar xmas-nightstar--glyph"
              style={{
                left: `${s.left}%`,
                top: `${s.top}%`,
                color: s.tone,
                fontSize: `${s.size * 4}px`,
                animationDuration: dur(s.duration, speed),
                animationDelay: `${(-s.delay).toFixed(2)}s`,
              }}
            >
              {s.glyph}
            </span>
          ) : (
            <span
              key={s.id}
              className="xmas-nightstar"
              style={{
                left: `${s.left}%`,
                top: `${s.top}%`,
                width: s.size,
                height: s.size,
                background: s.tone,
                boxShadow: `0 0 ${s.size * 2.4}px ${s.tone}`,
                animationDuration: dur(s.duration, speed),
                animationDelay: `${(-s.delay).toFixed(2)}s`,
              }}
            />
          )
        )}
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   8. CONFETTIS DE NEIGE AU CLIC
───────────────────────────────────────────────────────────────────────────── */
function SnowConfetti({ speed = 1 }) {
  const [bursts, setBursts] = useState([]);
  const idRef = useRef(0);

  useEffect(() => {
    const onClick = (e) => {
      if (typeof e.button === 'number' && e.button !== 0) return;
      if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;

      const id = ++idRef.current;
      const particles = Array.from({ length: 8 }, () => ({
        dx: random(-52, 52),
        dy: random(-70, -14),
        size: random(3.5, 7),
        spin: random(-220, 220),
        glyph: Math.random() > 0.55 ? (Math.random() > 0.5 ? '❄' : '✦') : null,
        delay: random(0, 0.14),
      }));

      setBursts((b) => [...b.slice(-3), { id, x: e.clientX, y: e.clientY, particles }]);
      setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), 1400);
    };

    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, []);

  if (!bursts.length) return null;

  return (
    <div className="pointer-events-none fixed inset-0" style={{ zIndex: 70 }} aria-hidden="true">
      {bursts.map((b) => (
        <div key={b.id} className="xmas-burst" style={{ left: b.x, top: b.y }}>
          {b.particles.map((p, i) => (
            <span
              key={i}
              className={`xmas-confetti${p.glyph ? ' xmas-confetti--glyph' : ''}`}
              style={{
                '--dx': `${p.dx.toFixed(0)}px`,
                '--dy': `${p.dy.toFixed(0)}px`,
                '--spin': `${p.spin.toFixed(0)}deg`,
                width: p.glyph ? undefined : p.size,
                height: p.glyph ? undefined : p.size,
                fontSize: `${p.size * 2}px`,
                animationDuration: dur(0.95, speed),
                animationDelay: `${p.delay.toFixed(2)}s`,
              }}
            >
              {p.glyph || ''}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   COMPOSANT PRINCIPAL (sans neige globale / sans amoncellement en bas)
───────────────────────────────────────────────────────────────────────────── */
export default function ChristmasEffects({
  enabled = true,
  color = '#0067ff',
  speed = 1,
  nightMode = false,
  snow = true,
}) {
  const isDark = useDarkMode();

  if (!enabled) return null;

  return (
    <>
      <BokehLights color={color} isDark={isDark} nightMode={nightMode} />
      {nightMode && <NightSky speed={speed} isDark={isDark} />}
      <ShootingStars color={color} speed={speed} />
      <SnowConfetti speed={speed} />
      {/* Guirlande — z-index 45, au-dessus du header */}
      <FairyLights color={color} />
      {/* Neige — z-index 35, couleur adaptée clair/sombre */}
      {snow && <Snowfall count={55} isDark={isDark} />}
    </>
  );
}
