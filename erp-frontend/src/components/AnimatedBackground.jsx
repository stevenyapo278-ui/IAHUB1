import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import ChristmasEffects from './ChristmasEffects';

/** Lit l'état Noël depuis le localStorage */
function readXmasActive() {
  if (typeof window === 'undefined') return false;
  // Activation globale forcée via variable d'environnement (tous les utilisateurs)
  if (import.meta.env.VITE_XMAS_ENABLED === 'true') return true;
  // Préférence individuelle stockée dans localStorage
  try {
    const raw = localStorage.getItem('xmas_prefs_v2');
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed.active ?? false;
    }
  } catch { /* ignore */ }
  // Par défaut : désactivé (opt-in, pas opt-out)
  return false;
}

export default function AnimatedBackground() {
  const [xmasActive, setXmasActive] = useState(readXmasActive);

  // Réagit aux changements du toggle (même onglet via CustomEvent, autres onglets via storage event)
  useEffect(() => {
    const onStorage = () => setXmasActive(readXmasActive());
    window.addEventListener('storage', onStorage);
    // Écoute aussi un événement custom émis par le toggle dans le même onglet
    window.addEventListener('xmas-prefs-changed', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('xmas-prefs-changed', onStorage);
    };
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
