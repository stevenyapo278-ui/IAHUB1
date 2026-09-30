/**
 * LinkedTicketsDrawer — tiroir « tickets associés » partagé.
 *
 * Utilisé par la page Catégories et la page Lieux pour afficher le nombre et la
 * liste des tickets rattachés à une entrée (avant/après une suppression, pour
 * vérifier l'impact). Chaque ligne est un lien vers la fiche ticket.
 *
 * La liste est filtrable par statut et extractible (XLSX / CSV) : les deux
 * actions partagent le même filtre et les mêmes colonnes que l'export des
 * tickets (avec Catégorie + Sous-catégorie).
 *
 * Props :
 *   open           : bool
 *   onClose        : function
 *   endpoint       : string — URL API paginée retournant { total, items }
 *   exportEndpoint : string — URL API d'extraction (?format=xlsx|csv&status=…)
 *                    (défaut : `${endpoint}/export`)
 *   title          : string
 *   subtitle       : string | null — ex. « 12 tickets · sous-catégories incluses »
 *   note           : string | null — info de contexte affichée au-dessus de la liste
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, Loader2, ExternalLink, User, FileSpreadsheet, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import api from '../api/client';
import exportFile from '../utils/exportFile';
import FormDrawer from './FormDrawer';

// Filtres de statut : mêmes valeurs que la barre de stats des tickets
const STATUS_FILTERS = [
  { value: '', label: 'Tous' },
  { value: 'OPEN_GROUP', label: 'Ouverts' },
  { value: 'PENDING_GROUP', label: 'En attente' },
  { value: 'SOLVED', label: 'Résolus' },
  { value: 'CLOSED', label: 'Fermés' },
];
const STATUS_FILTER_LABELS = Object.fromEntries(STATUS_FILTERS.map((f) => [f.value, f.label]));

const STATUS_LABELS = {
  NEW: 'Nouveau', OPEN: 'Ouvert', IN_PROGRESS: 'En cours', ASSIGNED: 'Attribué',
  PLANNED: 'Planifié', PENDING: 'En attente', WAITING: 'En attente',
  WAITING_FOR_USER: 'Attente utilisateur', SOLVED: 'Résolu', CLOSED: 'Fermé',
  OBSERVED: 'Observé',
};
const STATUS_BG = {
  NEW: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
  OPEN: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
  IN_PROGRESS: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400',
  ASSIGNED: 'bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400',
  PLANNED: 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400',
  PENDING: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400',
  WAITING: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400',
  WAITING_FOR_USER: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400',
  SOLVED: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  CLOSED: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-400',
  OBSERVED: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-400',
};
const PRIORITY_BG = {
  P1: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  P2: 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400',
  P3: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400',
  P4: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
};

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export default function LinkedTicketsDrawer({ open, onClose, endpoint, exportEndpoint, title, subtitle, note }) {
  const [status, setStatus] = useState('');
  const [exporting, setExporting] = useState(null);
  // `endpoint` + `status` sont stockés avec la donnée : tant que la réponse ne
  // correspond pas à la vue demandée, on déduit l'état « chargement » sans
  // setState dans l'effet (interdit par react-hooks/set-state-in-effect).
  const [state, setState] = useState({ key: null, error: null, data: null });

  useEffect(() => {
    if (!open || !endpoint) return undefined;
    let cancelled = false;
    const key = `${endpoint}|${status}`;
    api.get(endpoint, { params: status ? { status } : {} })
      .then(({ data }) => { if (!cancelled) setState({ key, error: null, data }); })
      .catch((err) => {
        if (!cancelled) setState({ key, error: err.response?.data?.error || 'Erreur chargement des tickets', data: null });
      });
    return () => { cancelled = true; };
  }, [open, endpoint, status]);

  const fresh = state.key === `${endpoint}|${status}`;
  const loading = !!open && !!endpoint && !fresh;
  const error = fresh ? state.error : null;
  const items = fresh ? (state.data?.items || []) : [];
  const total = fresh ? (state.data?.total ?? items.length) : null;

  // Sous-titre : le compteur de la vue (non filtré) devient le compteur du filtre
  // courant dès qu'un statut est choisi.
  const filtered = status !== '';
  const filteredLabel = STATUS_FILTER_LABELS[status] || status;
  const drawerSubtitle = filtered
    ? (total === null ? `Filtre : ${filteredLabel}` : `${total} ticket(s) · ${filteredLabel}`)
    : (subtitle ?? (total > 0 ? `${total} ticket(s)` : null));

  function handleClose() {
    setStatus('');
    onClose();
  }

  async function exportTickets(format) {
    if (!endpoint) return;
    setExporting(format);
    try {
      await exportFile({
        url: exportEndpoint || `${endpoint}/export`,
        params: { format, ...(status ? { status } : {}) },
        fallbackName: `tickets_export_${new Date().toISOString().slice(0, 10)}.${format}`,
      });
      toast.success(`Export ${format.toUpperCase()} généré${filtered ? ` (filtre : ${filteredLabel})` : ''}`);
    } catch {
      toast.error("Échec de l'export");
    } finally {
      setExporting(null);
    }
  }

  return (
    <FormDrawer
      open={open}
      onClose={handleClose}
      title={title}
      subtitle={drawerSubtitle}
      icon={Inbox}
      iconColor="text-blue-400"
      size="lg"
    >
      <div className="flex flex-col gap-3">
        {note && (
          <p className="text-[11px] leading-snug text-on-surface-variant bg-surface-container rounded-xl px-3 py-2 border border-outline-variant">
            {note}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_FILTERS.map((f) => {
              const isActive = status === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setStatus(isActive ? '' : f.value)}
                  aria-pressed={isActive}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => exportTickets('xlsx')}
              disabled={loading || !!error || total === 0 || exporting !== null}
              title={filtered ? `Exporter les tickets « ${filteredLabel} » en Excel` : 'Exporter en Excel'}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-outline-variant text-on-surface-variant hover:border-emerald-500 hover:text-emerald-600 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              {exporting === 'xlsx' ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileSpreadsheet className="w-3 h-3" />}
              XLSX
            </button>
            <button
              type="button"
              onClick={() => exportTickets('csv')}
              disabled={loading || !!error || total === 0 || exporting !== null}
              title={filtered ? `Exporter les tickets « ${filteredLabel} » en CSV` : 'Exporter en CSV'}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-outline-variant text-on-surface-variant hover:border-teal-500 hover:text-teal-600 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              {exporting === 'csv' ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileDown className="w-3 h-3" />}
              CSV
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-on-surface-variant text-xs">
            <Loader2 className="w-4 h-4 animate-spin" />
            Chargement des tickets…
          </div>
        )}

        {!loading && error && (
          <div className="py-8 text-center text-xs text-red-600 dark:text-red-400">{error}</div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <span className="w-11 h-11 rounded-2xl bg-surface-container-high text-on-surface-variant flex items-center justify-center mb-3">
              <Inbox className="w-5 h-5" />
            </span>
            <p className="text-xs text-on-surface-variant italic">
              {filtered ? `Aucun ticket « ${filteredLabel} ».` : 'Aucun ticket rattaché.'}
            </p>
          </div>
        )}

        {!loading && !error && items.map((t) => (
          <Link
            key={t.id}
            to={`/tickets/${t.id}`}
            onClick={onClose}
            className="group flex flex-col gap-1.5 rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 py-3 hover:border-primary hover:bg-surface-container transition-colors"
          >
            <div className="flex items-start gap-2 min-w-0">
              <span className="text-[11px] font-mono font-bold text-on-surface-variant shrink-0 pt-0.5">#{t.id}</span>
              <span className="flex-1 min-w-0 text-[13px] font-semibold leading-snug text-on-surface group-hover:text-primary">
                {t.title}
              </span>
              <ExternalLink className="w-3.5 h-3.5 text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_BG[t.status] || 'bg-slate-100 text-slate-700'}`}>
                {STATUS_LABELS[t.status] || t.status}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${PRIORITY_BG[t.priority] || 'bg-slate-100 text-slate-700'}`}>
                {t.priority}
              </span>
              {t.category && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-surface-container text-on-surface-variant border border-outline-variant truncate max-w-[160px]">
                  {t.category}
                </span>
              )}
              {t.locationName && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-surface-container text-on-surface-variant border border-outline-variant truncate max-w-[160px]">
                  {t.locationName}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-on-surface-variant">
              {t.requester?.fullName && (
                <span className="inline-flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {t.requester.fullName}
                </span>
              )}
              {t.assignedTo?.fullName && <span>→ {t.assignedTo.fullName}</span>}
              <span className="ml-auto font-mono">{formatDate(t.createdAt)}</span>
            </div>
          </Link>
        ))}

        {!loading && !error && total > items.length && (
          <p className="text-[11px] text-on-surface-variant text-center py-1">
            {items.length} ticket(s) affichés sur {total}
          </p>
        )}
      </div>
    </FormDrawer>
  );
}
