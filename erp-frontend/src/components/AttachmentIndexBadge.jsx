import { CheckCircle2, Clock, Loader2, Ban, AlertTriangle, RotateCw } from 'lucide-react';

// ── Statut d'extraction / indexation d'une pièce jointe ──────────────────────
// Le backend extrait le texte (PDF/DOCX/XLSX/CSV/texte) ou fait l'OCR Vision des
// images, puis indexe le contenu dans le RAG du chatbot. Chaque PJ expose donc
// `extractionStatus` : PENDING | PROCESSING | DONE | EMPTY | SKIPPED | ERROR.
// Ce badge rend l'état lisible et sert de point de relance quand il a échoué.
const STATUS_META = {
  DONE: {
    label: 'Indexé',
    icon: CheckCircle2,
    className: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
  },
  PROCESSING: {
    label: 'OCR…',
    icon: Loader2,
    spin: true,
    className: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25',
  },
  PENDING: {
    label: 'En attente',
    icon: Clock,
    className: 'text-on-surface-variant bg-surface-container border-outline-variant/40',
  },
  SKIPPED: {
    label: 'Ignoré',
    icon: Ban,
    className: 'text-on-surface-variant bg-surface-container border-outline-variant/40',
  },
  EMPTY: {
    label: 'Sans texte',
    icon: Ban,
    className: 'text-on-surface-variant bg-surface-container border-outline-variant/40',
  },
  ERROR: {
    label: 'Échec',
    icon: AlertTriangle,
    className: 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/25',
  },
};

export function isIndexingBusy(status) {
  return status === 'PENDING' || status === 'PROCESSING';
}

export function canReindex(status) {
  return status === 'ERROR' || status === 'SKIPPED' || status === 'EMPTY';
}

export default function AttachmentIndexBadge({
  status,
  error,
  onReindex,
  reindexing = false,
  compact = false,
  className = '',
}) {
  const meta = STATUS_META[status];
  if (!meta) return null;
  const Icon = meta.icon;

  const tooltip = [
    status === 'DONE' ? 'Contenu extrait et interrogeable par le chatbot'
      : status === 'PROCESSING' ? 'Extraction/OCR en cours'
        : status === 'PENDING' ? "En attente d'extraction (rattrapage automatique)"
          : status === 'SKIPPED' ? 'Extraction ignorée'
            : status === 'EMPTY' ? 'Aucun texte détecté dans ce fichier'
              : "L'extraction a échoué",
    error ? `— ${error}` : null,
  ].filter(Boolean).join(' ');

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span
        title={tooltip}
        className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-[1px] font-bold ${compact ? 'text-[9px]' : 'text-[10px]'} ${meta.className}`}
      >
        <Icon className={`w-2.5 h-2.5 shrink-0 ${meta.spin ? 'animate-spin' : ''}`} />
        {!compact && <span className="whitespace-nowrap">{meta.label}</span>}
      </span>
      {canReindex(status) && onReindex && (
        <button
          type="button"
          title="Relancer l'extraction"
          aria-label="Relancer l'extraction de la pièce jointe"
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); onReindex(); }}
          disabled={reindexing}
          className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-outline-variant/50 bg-surface text-on-surface-variant hover:text-primary hover:border-primary/40 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <RotateCw className={`w-2.5 h-2.5 ${reindexing ? 'animate-spin' : ''}`} />
        </button>
      )}
    </span>
  );
}
