import { useMemo } from 'react';
import { motion } from 'framer-motion';
import ChristmasEffects from './ChristmasEffects';

export default function AnimatedBackground() {
  const xmasActive = useMemo(() => {
    if (typeof window === 'undefined') return false;
    try {
      const raw = localStorage.getItem('xmas_prefs_v2');
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed.active ?? false;
      }
    } catch { /* ignore */ }
    return true;
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Effets Noël (si activés) : s'empilent au-dessus des motifs, mais en
          dessous du contenu visible (z-index -10) */}
      {xmasActive && <ChristmasEffects />}

      <motion.div
        animate={{
          x: [0, 40, 0],
          y: [0, -30, 0],
        }}
        transition={{ duration: 15, repeat: Infinity, ease: 'linear' }}
        className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full opacity-20"
        style={{
          background: 'radial-gradient(circle, var(--color-primary) 0%, transparent 70%)',
          filter: 'blur(60px)',
        }}
      />
      <motion.div
        animate={{
          x: [0, -50, 0],
          y: [0, 40, 0],
        }}
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
  );
}
