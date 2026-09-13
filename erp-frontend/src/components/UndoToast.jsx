import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Undo2 } from 'lucide-react';

const DURATION = 10000;
const CIRCLE_R = 14;
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_R;

export default function UndoToast({ message, onUndo, duration = DURATION }) {
  const [remaining, setRemaining] = useState(duration);
  const [done, setDone] = useState(false);
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    const step = 50;
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= step) { clearInterval(id); setDone(true); return 0; }
        return r - step;
      });
    }, step);
    return () => clearInterval(id);
  }, []);

  const handleUndo = useCallback(async () => {
    if (undoing) return;
    setUndoing(true);
    try {
      await onUndo();
    } catch {
      // erreur silencieuse — le toast parent affichera l'erreur
    }
  }, [onUndo, undoing]);

  const progress = remaining / duration;
  const dashOffset = CIRCLE_CIRCUMFERENCE * (1 - progress);
  const seconds = Math.ceil(remaining / 1000);

  if (done && !undoing) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 60, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 60, opacity: 0, scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 400, damping: 35 }}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 px-4 py-3 rounded-2xl border border-border/30 bg-surface shadow-2xl shadow-black/25"
      >
        {/* Circular countdown ring */}
        <div className="relative flex items-center justify-center" style={{ width: 36, height: 36 }}>
          <svg width={36} height={36} className="absolute inset-0 -rotate-90">
            <circle cx={18} cy={18} r={CIRCLE_R} fill="none" stroke="currentColor"
              className="text-border/30" strokeWidth={2.5} />
            <circle cx={18} cy={18} r={CIRCLE_R} fill="none" stroke="currentColor"
              className="text-primary" strokeWidth={2.5} strokeLinecap="round"
              strokeDasharray={CIRCLE_CIRCUMFERENCE} strokeDashoffset={dashOffset}
              style={{ transition: 'stroke-dashoffset 50ms linear' }} />
          </svg>
          <span className="text-[10px] font-bold text-muted-foreground tabular-nums relative z-10">
            {undoing ? '…' : seconds}
          </span>
        </div>

        {/* Message */}
        <span className="text-sm font-medium text-foreground max-w-[240px] truncate">{message}</span>

        {/* Undo button */}
        {!undoing && (
          <button onClick={handleUndo}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity active:scale-95">
            <Undo2 className="w-3.5 h-3.5" />
            Annuler
          </button>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
