import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  X, Plus, Bookmark, Trash2, User, Radio,
  CheckCircle2, Flag, Sparkles, Flame, UserX,
} from 'lucide-react';
import SearchableSelect from './SearchableSelect';

// ── TicketFilterDrawer ───────────────────────────────────────────────────────
// Drawer latéral droit « SaaS premium » pour les filtres de tickets :
// fond blanc cassé, ombre douce diffuse, backdrop assombri et flouté, champs à
// bordures fines arrondis, actions primaire/secondaire contrastées, animations
// douces d'ouverture/fermeture, responsive mobile → desktop.
function FieldLabel({ children }) {
  return (
    <span className="block text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400 dark:text-on-surface-variant mb-1.5">
      {children}
    </span>
  );
}

const QUICK_FILTERS = [
  { key: 'mine', val: 'true', label: 'Mes tickets', Icon: User },
  { key: 'status', val: 'OPEN_GROUP', label: 'Ouverts', Icon: Radio },
  { key: 'status', val: 'CLOSED_GROUP', label: 'Clôturés', Icon: CheckCircle2 },
  { key: 'closeSuggested', val: 'true', label: 'Clôture suggérée', Icon: Flag },
  { key: 'aiProcessed', val: 'true', label: 'Traité IA', Icon: Sparkles },
  { key: 'priority', val: 'P1', label: 'P1 Critiques', Icon: Flame },
  { key: 'assignedToId', val: 'none', label: 'Non assignés', Icon: UserX },
];

export default function TicketFilterDrawer({
  onClose, activeFilterCount, filters, onUpdate, onClear, teams, users,
  flatCategories, autonomousMode, savedViews, onSaveView, onRestoreView,
  onDeleteSavedView,  searchQuery,
}) {
  const reduceMotion = useReducedMotion();
  const panelRef = useRef(null);

  // Verrouille le scroll de la page pendant l'ouverture du drawer
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  // Échap ferme, Tab reste piégé dans le panneau, focus restauré à la fermeture
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    panelRef.current?.focus?.();

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll(
          'button:not([disabled]), select:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Rend le focus au bouton « Filtres » après la fermeture
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [onClose]);

  // Apparition en cascade des sections (désactivée si mouvement réduit)
  const stackVariants = {
    hidden: {},
    show: { transition: { staggerChildren: reduceMotion ? 0 : 0.05, delayChildren: reduceMotion ? 0 : 0.12 } },
  };
  const sectionVariants = {
    hidden: reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14 },
    show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] } },
  };

  return createPortal(
    <div className="fixed inset-0 z-[9000]" role="presentation">
      {/* Backdrop assombri avec léger flou */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.3, ease: 'easeOut' }}
        onClick={onClose}
        aria-hidden="true"
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
      />

      {/* Drawer */}
      <motion.aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Filtres des tickets"
        initial={reduceMotion ? { opacity: 0 } : { x: '100%' }}
        animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
        exit={reduceMotion ? { opacity: 0 } : { x: '100%' }}
        transition={{ duration: reduceMotion ? 0 : 0.45, ease: [0.32, 0.72, 0, 1] }}
        className="absolute inset-y-0 right-0 w-full sm:w-[420px] flex flex-col outline-none rounded-l-2xl ring-1 ring-black/[0.06] dark:ring-white/10 bg-[#fafaf9] dark:bg-surface-container-lowest shadow-[0_32px_90px_-24px_rgba(15,23,42,0.45)]"
      >
        {/* ── En-tête ── */}
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="shrink-0 px-7 pt-7 pb-6"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Filtres</h2>
                {activeFilterCount > 0 && (
                  <span className="min-w-5 h-5 px-1.5 flex items-center justify-center rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[10px] font-bold tabular-nums">
                    {activeFilterCount}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs font-medium text-slate-400 dark:text-on-surface-variant">
                Affinez la liste selon vos critères
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Fermer les filtres"
              className="p-2 -m-1 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-900/[0.04] dark:text-on-surface-variant dark:hover:text-white dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </motion.div>

        {/* ── Corps ── */}
        <div className="flex-1 overflow-y-auto px-7 pb-8">
          <motion.div initial="hidden" animate="show" variants={stackVariants}>

            {/* Raccourcis */}
            <motion.section variants={sectionVariants}>
              <FieldLabel>Raccourcis</FieldLabel>
              <div className="flex flex-wrap gap-2 mt-3">
                {QUICK_FILTERS.map(({ key, val, label, Icon }) => {
                  const active = filters[key] === val;
                  return (
                    <button
                      key={`${key}-${val}`}
                      onClick={() => onUpdate(key, active ? '' : val)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                        active
                          ? 'bg-slate-900 border-slate-900 text-white shadow-sm dark:bg-white dark:border-white dark:text-slate-900'
                          : 'bg-transparent border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900 hover:bg-white dark:border-outline-variant/50 dark:text-on-surface-variant dark:hover:text-white dark:hover:bg-white/5'
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      {label}
                    </button>
                  );
                })}
              </div>
            </motion.section>

            <motion.div variants={sectionVariants} className="my-7 h-px bg-black/[0.05] dark:bg-white/10" />

            {/* Critères */}
            <motion.section variants={sectionVariants} className="space-y-5">
              <FieldLabel>Critères</FieldLabel>
              <SearchableSelect
                value={filters.status}
                onChange={(v) => onUpdate('status', v)}
                options={[
                  { label: 'Tous les statuts', value: '' },
                  { label: 'Tous sauf clôturés (défaut)', value: 'NOT_CLOSED' },
                  { label: 'Ouverts (actifs)', value: 'OPEN_GROUP' },
                  { label: 'Clôturés / résolus', value: 'CLOSED_GROUP' },
                  { label: 'Nouveau', value: 'NEW' },
                  { label: 'En cours', value: 'OPEN' },
                  { label: 'Planifié', value: 'PLANNED' },
                  { label: 'En attente', value: 'PENDING' },
                  { label: 'Résolu', value: 'SOLVED' },
                  { label: 'Fermé', value: 'CLOSED' },
                ]}
                placeholder="Statut"
                searchPlaceholder="Rechercher un statut…"
              />

              <SearchableSelect
                value={filters.priority}
                onChange={(v) => onUpdate('priority', v)}
                options={[
                  { label: 'Toutes les priorités', value: '' },
                  { label: 'P1 — Critique', value: 'P1' },
                  { label: 'P2 — Haute', value: 'P2' },
                  { label: 'P3 — Moyenne', value: 'P3' },
                  { label: 'P4 — Basse', value: 'P4' },
                ]}
                placeholder="Priorité"
                searchPlaceholder="Rechercher…"
              />

              <SearchableSelect
                value={filters.source}
                onChange={(v) => onUpdate('source', v)}
                options={[
                  { label: 'Toutes les sources', value: '' },
                  
                  { label: 'Internes ERP', value: 'erp' },
                ]}
                placeholder="Source"
                searchPlaceholder="Rechercher…"
              />

              <SearchableSelect
                value={filters.category}
                onChange={(v) => onUpdate('category', v)}
                options={[
                  { label: 'Toutes les catégories', value: '' },
                  ...flatCategories.map((o) => ({ label: o.label, value: o.name })),
                ]}
                placeholder="Catégorie"
                searchPlaceholder="Rechercher une catégorie…"
              />

              <SearchableSelect
                value={filters.teamId}
                onChange={(v) => onUpdate('teamId', v)}
                options={[
                  { label: 'Toutes les équipes', value: '' },
                  ...teams.map((t) => ({ label: t.name, value: String(t.id) })),
                ]}
                placeholder="Équipe"
                searchPlaceholder="Rechercher une équipe…"
              />

              <SearchableSelect
                value={filters.assignedToId}
                onChange={(v) => onUpdate('assignedToId', v)}
                options={[
                  { label: 'Tout le monde', value: '' },
                  { label: 'Non assigné', value: 'none' },
                  ...users.filter((u) => u.isActive).map((u) => ({ label: u.fullName, value: String(u.id) })),
                ]}
                placeholder="Assigné à"
                searchPlaceholder="Rechercher un technicien…"
              />

              <SearchableSelect
                value={filters.approvalStatus}
                onChange={(v) => onUpdate('approvalStatus', v)}
                options={[
                  { label: 'Toutes', value: '' },
                  { label: 'En attente Hotline', value: 'PENDING' },
                  { label: 'Approuvés', value: 'APPROVED' },
                  { label: 'Rejetés', value: 'REJECTED' },
                ]}
                placeholder="Approbation"
                searchPlaceholder="Rechercher…"
              />
            </motion.section>

            <motion.div variants={sectionVariants} className="my-7 h-px bg-black/[0.05] dark:bg-white/10" />

            {/* Vues sauvegardées */}
            <motion.section variants={sectionVariants}>
              <div className="flex items-center justify-between mb-3">
                <FieldLabel>Vues sauvegardées</FieldLabel>
                <button
                  onClick={onSaveView}
                  className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-on-surface-variant dark:hover:text-white transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Enregistrer
                </button>
              </div>
              {savedViews.length === 0 ? (
                <p className="text-xs text-slate-400 italic py-2 dark:text-on-surface-variant">
                  Aucune vue sauvegardée pour le moment.
                </p>
              ) : (
                <div className="space-y-1">
                  {savedViews.map((v) => (
                    <div
                      key={v.name}
                      className="group flex items-center gap-1 rounded-xl px-2.5 py-2 hover:bg-slate-900/[0.03] dark:hover:bg-white/5 transition-colors"
                    >
                      <button
                        onClick={() => { onRestoreView(v); onClose(); }}
                        className="flex-1 min-w-0 flex items-center gap-2.5 text-left cursor-pointer"
                      >
                        <Bookmark className="w-3.5 h-3.5 text-slate-300 dark:text-on-surface-variant shrink-0" />
                        <span className="truncate text-[13px] font-medium text-slate-700 dark:text-on-surface group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                          {v.name}
                        </span>
                      </button>
                      <button
                        onClick={() => onDeleteSavedView(v.name)}
                        aria-label={`Supprimer la vue ${v.name}`}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-slate-300 hover:text-red-500 dark:text-on-surface-variant transition-all cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </motion.section>
          </motion.div>
        </div>

        {/* ── Pied : actions ── */}
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1], delay: reduceMotion ? 0 : 0.14 }}
          className="shrink-0 px-7 py-5 border-t border-black/[0.05] dark:border-white/10"
        >
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={onClear}
              disabled={activeFilterCount === 0 && !searchQuery}
              className="py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-sm font-semibold hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40 disabled:pointer-events-none transition-all cursor-pointer dark:bg-transparent dark:border-outline-variant/60 dark:text-on-surface-variant dark:hover:text-white dark:hover:bg-white/5"
            >
              Réinitialiser
            </button>
            <button
              onClick={onClose}
              className="py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 active:scale-[0.98] shadow-[0_8px_20px_-8px_rgba(15,23,42,0.5)] transition-all cursor-pointer dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
            >
              Appliquer
            </button>
          </div>
        </motion.div>
      </motion.aside>
    </div>,
    document.body
  );
}
