import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ClipboardList, CornerDownLeft, X } from 'lucide-react';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Construit le HTML du rapport : une ligne par champ renseigné, libellé en gras.
// Les retours à la ligne saisis dans un champ deviennent des <br>.
function buildTemplateHtml(values, fields) {
  return fields
    .map((f) => ({ label: f.label, value: (values[f.key] || '').trim() }))
    .filter((f) => f.value)
    .map((f) => `<p><strong>${escapeHtml(f.label)} :</strong> ${escapeHtml(f.value).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// Formulaire interne : monté uniquement quand la fenêtre est ouverte, ce qui
// remet les champs à zéro à chaque ouverture sans effet de réinitialisation.
function TemplateForm({ title, subtitle, fields, confirmLabel, onClose, onInsert }) {
  const [values, setValues] = useState({});

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const html = buildTemplateHtml(values, fields);
  const canInsert = html.length > 0;

  return (
    <>
      <div className="flex items-start gap-3 px-5 pt-5 pb-3">
        <span className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/15">
          <ClipboardList className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-extrabold text-on-background">{title}</h3>
          <p className="text-[11px] text-on-surface-variant leading-snug mt-0.5">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-5 pb-4 space-y-3 max-h-[60vh] overflow-y-auto">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface-variant mb-1">
              {f.label}
            </span>
            <textarea
              rows={f.rows || 2}
              value={values[f.key] || ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-y leading-relaxed"
            />
          </label>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-outline-variant/40 bg-surface-container-low/60 rounded-b-2xl">
        <span className="text-[10px] text-on-surface-variant/70 flex items-center gap-1.5">
          <CornerDownLeft className="w-3 h-3" /> Champs vides ignorés · Échap pour fermer
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl border border-outline-variant bg-surface text-on-surface text-xs font-semibold hover:bg-surface-container transition-colors cursor-pointer"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={!canInsert}
            onClick={() => onInsert(html)}
            className="px-4 py-2 rounded-xl btn-primary text-xs font-bold disabled:opacity-40 transition-all cursor-pointer"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}

// Fenêtre « Rapport d'intervention » : saisie guidée (Constat / Cause / Action /
// Résultat) puis insertion du texte formaté dans l'éditeur de suivi.
export default function FollowupTemplateDialog({
  open,
  title = 'Rapport d’intervention',
  subtitle = 'Renseignez les champs : le texte est inséré dans le suivi, modifiable avant envoi.',
  fields = [],
  confirmLabel = 'Insérer dans le suivi',
  onClose,
  onInsert,
}) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }}
            className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl max-w-xl w-full card-shadow flex flex-col"
          >
            <TemplateForm
              title={title}
              subtitle={subtitle}
              fields={fields}
              confirmLabel={confirmLabel}
              onClose={onClose}
              onInsert={onInsert}
            />
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
