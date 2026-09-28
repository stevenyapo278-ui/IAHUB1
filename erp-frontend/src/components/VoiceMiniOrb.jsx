import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { useVoiceSession } from '../context/VoiceSessionContext';
import VoiceVisualizer from './VoiceVisualizer';

const STATE_LABELS = {
  connecting: 'Connexion…',
  reconnecting: 'Reconnexion…',
  listening: 'À l\'écoute',
  thinking: 'Réflexion…',
  speaking: 'Parle…',
};

const STATE_COLORS = {
  connecting: '#eab308',
  reconnecting: '#f97316',
  listening: '#3b82f6',
  thinking: '#a855f7',
  speaking: '#22c55e',
};

// Mini-orbe persistante : visible quand le modal MARIE est réduit mais que la
// session continue. Clic sur l'orbe = rouvrir le modal · ✕ = arrêt réel.
export default function VoiceMiniOrb() {
  const {
    showMiniOrb,
    state,
    analyserNode,
    playbackAnalyserNode,
    open,
    close,
  } = useVoiceSession();
  const reduceMotion = useReducedMotion();

  const color = STATE_COLORS[state] || '#3b82f6';
  const label = STATE_LABELS[state] || state;
  const activeAnalyser = state === 'speaking' && playbackAnalyserNode ? playbackAnalyserNode : analyserNode;

  return (
    <AnimatePresence>
      {showMiniOrb && (
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.7, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.7, y: 20 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          className="fixed bottom-6 left-6 z-[60] flex items-center gap-2 pr-2 pl-1.5 py-1.5 rounded-full bg-black/70 border border-white/15 backdrop-blur-xl shadow-xl shadow-black/50"
        >
          {/* Orbe : clic = rouvrir le modal */}
          <button
            type="button"
            onClick={open}
            aria-label="Rouvrir l'assistant vocal MARIE"
            className="relative w-12 h-12 rounded-full overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70"
            style={{ boxShadow: `0 0 16px ${color}55` }}
          >
            <VoiceVisualizer
              analyserNode={activeAnalyser}
              color={color}
              isActive
              state={state}
            />
            {!reduceMotion && (
              <motion.span
                className="absolute inset-0 rounded-full border"
                style={{ borderColor: color }}
                animate={{ scale: [1, 1.35], opacity: [0.6, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
              />
            )}
          </button>

          {/* État (masqué sur petit écran) */}
          <span className="hidden sm:block text-[11px] text-white/75 tracking-wide pr-1">
            {label}
          </span>

          {/* ✕ : arrêt réel (stopAll) */}
          <button
            type="button"
            onClick={close}
            aria-label="Arrêter définitivement MARIE"
            className="w-7 h-7 rounded-full flex items-center justify-center bg-white/10 hover:bg-red-500/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-red-400/60"
          >
            <X className="w-3.5 h-3.5 text-white/80" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
