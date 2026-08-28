import { ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/**
 * Composant de pagination réutilisable avec sélecteur de lignes par page.
 * @param {number} page - Page actuelle (1-indexed)
 * @param {number} totalPages - Nombre total de pages
 * @param {number} total - Nombre total d'éléments
 * @param {string} label - Libellé des éléments (ex: "catégories", "utilisateurs")
 * @param {function} onPageChange - Callback (newPage) => void
 * @param {number} pageSize - Nombre d'éléments par page
 * @param {function} onPageSizeChange - Callback (newSize) => void
 * @param {number} [maxVisible=5] - Nombre max de boutons de pages visibles
 */
export default function Pagination({ page, totalPages, total, label, onPageChange, pageSize = 25, onPageSizeChange, maxVisible = 5 }) {
  if (total <= 0) return null;

  // Générer les numéros de page visibles
  const pages = [];
  let start = Math.max(1, page - Math.floor(maxVisible / 2));
  let end = Math.min(totalPages, start + maxVisible - 1);
  if (end - start + 1 < maxVisible) {
    start = Math.max(1, end - maxVisible + 1);
  }
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-t border-outline-variant/20 bg-surface-container-low/20">
      {/* Sélecteur lignes par page */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-on-surface-variant font-medium">Lignes par page</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="text-[11px] font-semibold bg-surface-container border border-outline-variant/30 rounded-lg px-2 py-1 text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/40 cursor-pointer"
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <span className="text-[11px] text-on-surface-variant">
          {total} {label}
        </span>
      </div>

      {/* Navigation pages */}
      <div className="flex items-center gap-1">
        <span className="text-[11px] text-on-surface-variant font-medium mr-2">
          Page <strong>{page}</strong> / <strong>{totalPages}</strong>
        </span>
        <button
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="p-1.5 rounded-lg border border-outline-variant/30 text-on-surface-variant disabled:opacity-30 hover:bg-surface-container transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>

        {start > 1 && (
          <>
            <button onClick={() => onPageChange(1)}
              className="px-2 py-1 rounded-lg text-[11px] font-semibold text-on-surface-variant hover:bg-surface-container transition-colors">
              1
            </button>
            {start > 2 && <span className="text-on-surface-variant/30 text-[11px] px-1">…</span>}
          </>
        )}

        {pages.map((p) => (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-all ${
              p === page
                ? 'bg-primary/10 text-primary border border-primary/20'
                : 'text-on-surface-variant hover:bg-surface-container'
            }`}
          >
            {p}
          </button>
        ))}

        {end < totalPages && (
          <>
            {end < totalPages - 1 && <span className="text-on-surface-variant/30 text-[11px] px-1">…</span>}
            <button onClick={() => onPageChange(totalPages)}
              className="px-2 py-1 rounded-lg text-[11px] font-semibold text-on-surface-variant hover:bg-surface-container transition-colors">
              {totalPages}
            </button>
          </>
        )}

        <button
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="p-1.5 rounded-lg border border-outline-variant/30 text-on-surface-variant disabled:opacity-30 hover:bg-surface-container transition-colors"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
