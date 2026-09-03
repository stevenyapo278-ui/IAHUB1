/**
 * FormDrawer — Tiroir latéral droit pour les formulaires de création/édition.
 *
 * Remplace toutes les modales centrées (fixed inset-0 flex items-center justify-center)
 * par un pattern Katalyst standardisé : drawer qui slide depuis la droite.
 *
 * Props :
 *   open       : bool
 *   onClose    : function
 *   title      : string
 *   subtitle   : string | null
 *   icon       : composant Lucide
 *   iconColor  : string — classe Tailwind couleur (ex: 'text-blue-400')
 *   size       : 'sm' | 'md' | 'lg' | 'xl'
 *                → 'sm' = 400px, 'md' = 520px, 'lg' = 680px, 'xl' = 840px
 *   children   : ReactNode — corps du formulaire
 *   footer     : ReactNode — boutons d'action en bas
 *   closeOnBackdrop : bool — ferme au clic backdrop (défaut: true)
 */
import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

const SIZE_MAP = {
  sm: '400px',
  md: '520px',
  lg: '680px',
  xl: '840px',
};

const COLOR_BG_MAP = {
  'text-blue-400': 'bg-blue-500/10',
  'text-emerald-400': 'bg-emerald-500/10',
  'text-amber-400': 'bg-amber-500/10',
  'text-purple-400': 'bg-purple-500/10',
  'text-indigo-400': 'bg-indigo-500/10',
  'text-teal-400': 'bg-teal-500/10',
  'text-red-400': 'bg-red-500/10',
  'text-cyan-400': 'bg-cyan-500/10',
  'text-orange-400': 'bg-orange-500/10',
  'text-rose-400': 'bg-rose-500/10',
  'text-slate-400': 'bg-surface-container',
  'text-primary': 'bg-primary/10',
};

export default function FormDrawer({
  open,
  onClose,
  title,
  subtitle,
  icon: Icon,
  iconColor = 'text-primary',
  size = 'md',
  children,
  footer,
  closeOnBackdrop = true,
}) {
  // Fermeture avec Echap
  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const bubbleBg = COLOR_BG_MAP[iconColor] || 'bg-primary/10';
  const width = SIZE_MAP[size] || SIZE_MAP.md;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm"
            onClick={closeOnBackdrop ? onClose : undefined}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 z-[91] flex flex-col shadow-2xl"
            style={{
              width: `min(${width}, 95vw)`,
              backgroundColor: 'var(--color-surface-container-lowest)',
              borderLeft: '1px solid color-mix(in srgb, var(--color-outline-variant) 50%, transparent)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-4 shrink-0"
              style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-outline-variant) 30%, transparent)' }}
            >
              <div className="flex items-center gap-3 min-w-0">
                {Icon && (
                  <div className={`p-2 rounded-xl shrink-0 ${bubbleBg}`}>
                    <Icon className={`w-4 h-4 ${iconColor}`} />
                  </div>
                )}
                <div className="min-w-0">
                  <h2
                    className="text-sm font-bold truncate"
                    style={{ color: 'var(--color-on-surface)', fontFamily: 'Inter, sans-serif' }}
                  >
                    {title}
                  </h2>
                  {subtitle && (
                    <p
                      className="text-[11px] truncate"
                      style={{ color: 'var(--color-on-surface-variant)' }}
                    >
                      {subtitle}
                    </p>
                  )}
                </div>
              </div>

              <motion.button
                onClick={onClose}
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.9 }}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors shrink-0"
                style={{ color: 'var(--color-on-surface-variant)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface-container)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                aria-label="Fermer"
              >
                <X className="w-4 h-4" />
              </motion.button>
            </div>

            {/* Corps scrollable */}
            <div className="flex-1 overflow-y-auto px-5 py-5">
              {children}
            </div>

            {/* Footer */}
            {footer && (
              <div
                className="shrink-0 flex items-center justify-end gap-2 px-5 py-4"
                style={{ borderTop: '1px solid color-mix(in srgb, var(--color-outline-variant) 30%, transparent)' }}
              >
                {footer}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
