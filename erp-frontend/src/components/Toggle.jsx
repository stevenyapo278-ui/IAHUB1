import { motion } from 'framer-motion';
import { Check, X } from 'lucide-react';

// ─── Toggle switch moderne partagé ───────────────────────────────────────────
// Un seul composant pour tous les onglets Paramètres (remplace les 3 duplicatas).
//
// Design :
// - Piste en dégradé primary + halo lumineux doux quand actif, gris neutre sinon
// - Pouce blanc avec « squash & stretch » pendant la bascule (style Material You)
// - Micro-icônes morphing : ✓ verte à l'activation, ✕ grise à la désactivation
// - Accessible : role="switch", aria-checked, focus ring visible, état disabled
export default function Toggle({ checked, onChange, disabled = false, label }) {
  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.94 }}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full outline-none transition-[background-color,box-shadow] duration-300 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
        checked
          ? 'bg-gradient-to-r from-primary to-indigo-500 shadow-[0_2px_10px_-2px] shadow-primary/60'
          : 'bg-outline-variant/60 hover:bg-outline-variant'
      } ${disabled ? 'cursor-not-allowed opacity-40 saturate-50' : 'cursor-pointer'}`}
    >
      {/* Pouce — s'étire brièvement au départ de la bascule */}
      <motion.span
        initial={false}
        animate={{ x: checked ? 20 : 0, scaleX: [1, 1.22, 1] }}
        transition={{
          x: { type: 'spring', stiffness: 550, damping: 32 },
          scaleX: { duration: 0.28, times: [0, 0.45, 1] },
        }}
        className="absolute left-[3px] top-[3px] flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white shadow-md"
      >
        <Check
          strokeWidth={3.5}
          className={`absolute h-3 w-3 text-emerald-500 transition-all duration-200 ${
            checked ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
          }`}
        />
        <X
          strokeWidth={3}
          className={`absolute h-3 w-3 text-on-surface-variant transition-all duration-200 ${
            checked ? 'scale-50 opacity-0' : 'scale-100 opacity-100'
          }`}
        />
      </motion.span>
    </motion.button>
  );
}
