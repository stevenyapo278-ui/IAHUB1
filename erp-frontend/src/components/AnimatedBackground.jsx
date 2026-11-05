import { useEffect } from 'react';
import { motion } from 'framer-motion';
import ChristmasEffects from './ChristmasEffects';
import { useXmas } from '../hooks/useXmas';

export default function AnimatedBackground() {
  const xmas = useXmas();

  // Classes globales utilisées par le CSS (cadre des cartes, halo sidebar,
  // palette festive). Source unique : ce composant.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('xmas-on', xmas.active);
    root.classList.toggle('xmas-night', xmas.active && xmas.nightMode);
    root.classList.toggle('xmas-palette', xmas.active && xmas.palette);
    return () => {
      root.classList.remove('xmas-on', 'xmas-night', 'xmas-palette');
    };
  }, [xmas.active, xmas.nightMode, xmas.palette]);

  return (
    <>
      {/* ── Effets Noël — rendu directement (sans wrapper) pour que les z-index
           internes (neige z-35, nuit z-33/34) ne soient pas emprisonnés
           dans un contexte d'empilement inférieur au header (z-30). */}
      {xmas.active && (
        <ChristmasEffects
          color={xmas.color}
          speed={xmas.speed}
          nightMode={xmas.nightMode}
          snow={xmas.snow}
        />
      )}

      {/* ── Fond animé (dégradés subtils) — reste en arrière-plan ── */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <motion.div
          animate={{ x: [0, 40, 0], y: [0, -30, 0] }}
          transition={{ duration: 15, repeat: Infinity, ease: 'linear' }}
          className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full opacity-20"
          style={{
            background: 'radial-gradient(circle, var(--color-primary) 0%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
        <motion.div
          animate={{ x: [0, -50, 0], y: [0, 40, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
          className="absolute -bottom-40 -left-40 h-[400px] w-[400px] rounded-full opacity-15"
          style={{
            background: 'radial-gradient(circle, var(--color-secondary) 0%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />
      </div>
    </>
  );
}
