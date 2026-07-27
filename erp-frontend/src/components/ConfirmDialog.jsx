import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

export default function ConfirmDialog({
  open,
  title = 'Confirmer',
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  danger = false,
  loading = false,
  error = null,
  onConfirm,
  onCancel,
}) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          {/* Backdrop avec flou SEVEN-T */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={loading ? undefined : onCancel}
            className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer"
          />

          {/* Fenêtre de dialogue animée */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }}
            className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl max-w-sm w-full p-lg card-shadow flex flex-col gap-md"
          >
            <div>
              <h3 className="font-headline-sm text-headline-sm text-on-background font-bold mb-2">
                {title}
              </h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">
                {message}
              </p>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-bold flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] shrink-0">error</span>
                <span className="flex-1">{error}</span>
              </div>
            )}

            <div className="flex justify-end gap-sm mt-1">
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                className="px-4 py-2.5 rounded-xl border border-outline-variant bg-surface text-on-surface font-body-sm text-body-sm hover:bg-surface-container-low transition-colors duration-300 disabled:opacity-50 font-medium cursor-pointer"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={loading}
                className={`px-4 py-2.5 rounded-xl text-white font-body-sm text-body-sm font-semibold shadow-sm hover:shadow-md transition-all duration-300 disabled:opacity-50 cursor-pointer ${
                  danger
                    ? 'bg-gradient-to-r from-red-500 to-rose-600 hover:from-rose-600 hover:to-red-500 shadow-red-500/10 hover:shadow-red-500/25'
                    : 'btn-gradient shadow-primary/10 hover:shadow-primary/25'
                }`}
              >
                {loading ? <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span> : confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

