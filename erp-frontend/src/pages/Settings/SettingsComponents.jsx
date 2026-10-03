import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import Toggle from '../../components/Toggle';

// ── Styles partagés ─────────────────────────────────────────────────────────

export const inputClass =
  'bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300';

export const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

// ── Composants réutilisables ────────────────────────────────────────────────

export function SettingRow({ title, description, icon: Icon, checked, onChange, disabled }) {
  return (
    <motion.div
      variants={itemVariants}
      whileHover={{ y: -1, borderColor: 'var(--color-outline-variant)' }}
      className="bento-card flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-lg p-lg"
    >
      <div className="min-w-0 flex-1 flex items-center gap-4">
        {Icon && (
          <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-primary shrink-0">
            <Icon className="w-5 h-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-headline-sm text-headline-sm text-on-surface font-semibold break-words">{title}</div>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5 break-words">{description}</p>
        </div>
      </div>
      <div className="shrink-0">
        <Toggle checked={checked} onChange={onChange} disabled={disabled} />
      </div>
    </motion.div>
  );
}

export function IntervalRow({ title, description, value, onChange, disabled, max, unit }) {
  return (
    <motion.div
      variants={itemVariants}
      whileHover={{ y: -1, borderColor: 'var(--color-outline-variant)' }}
      className="bento-card flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-lg p-lg"
    >
      <div className="min-w-0 flex-1">
        <div className="font-headline-sm text-headline-sm text-on-surface font-semibold break-words">{title}</div>
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5 break-words">{description}</p>
      </div>
      <div className="flex items-center gap-sm shrink-0">
        <input
          type="number"
          min={0}
          max={max}
          value={value}
          onChange={(e) => onChange(Math.max(0, Math.min(max, Number(e.target.value) || 0)))}
          disabled={disabled}
          className={`${inputClass} w-24 text-center disabled:opacity-50`}
        />
        <span className="font-body-sm text-body-sm text-on-surface-variant font-medium">{unit}</span>
      </div>
    </motion.div>
  );
}

// ── Modale de section (Paramètres) ──────────────────────────────────────────
// Grande modale scrollable utilisée par l'onglet Notifications pour ouvrir une
// rubrique de la page sans tout empiler. Fermeture : croix, clic sur l'overlay,
// Échap. `icon` est un nom de Material Symbols (cohérent avec les en-têtes de section).
export function SectionModal({ open, onClose, title, description, icon, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && title && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 md:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 16 }}
            transition={{ type: 'spring', duration: 0.4, bounce: 0.15 }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[85vh]"
          >
            <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-outline-variant/40 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-primary text-xl">{icon}</span>
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-on-surface">{title}</h2>
                  {description && (
                    <p className="text-[11px] text-on-surface-variant mt-0.5 line-clamp-2">{description}</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-5 overflow-y-auto flex-1">
              {/* Racine d'animation locale : les sections sont montées après la page,
                  elles doivent rejouer hidden → visible ici (sinon elles restent en opacity:0). */}
              <motion.div
                initial="hidden"
                animate="visible"
                variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
              >
                {children}
              </motion.div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
