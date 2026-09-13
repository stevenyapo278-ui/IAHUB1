import { useState, useRef, useMemo } from 'react';

function ChevronsLeft({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m11 17-5-5 5-5" /><path d="m18 17-5-5 5-5" />
    </svg>
  );
}
function ChevronsRight({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 17 5-5-5-5" /><path d="m13 17 5-5-5-5" />
    </svg>
  );
}
function ChevronLeft({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}
function ChevronRight({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export default function PaginationButtons({ page, totalPages, onPageChange }) {
  const [jumpValue, setJumpValue] = useState('');
  const jumpRef = useRef(null);

  const pages = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const r = [1];
    if (page > 3) r.push('...');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) r.push(i);
    if (page < totalPages - 2) r.push('...');
    r.push(totalPages);
    return r;
  }, [page, totalPages]);

  function handleKeyDown(e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); onPageChange(Math.max(1, page - 1)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); onPageChange(Math.min(totalPages, page + 1)); }
    else if (e.key === 'Home') { e.preventDefault(); onPageChange(1); }
    else if (e.key === 'End') { e.preventDefault(); onPageChange(totalPages); }
  }

  function handleJump(e) {
    e.preventDefault();
    const val = parseInt(jumpValue, 10);
    if (!isNaN(val) && val >= 1 && val <= totalPages && val !== page) {
      onPageChange(val);
    }
    setJumpValue('');
    jumpRef.current?.blur();
  }

  const btn = 'h-10 min-w-[40px] flex items-center justify-center rounded-lg text-xs font-semibold transition-all duration-150 active:scale-95';
  const on = 'text-muted-foreground hover:bg-surface-muted hover:text-foreground';
  const off = 'text-muted-foreground/30 cursor-not-allowed';
  const active = 'bg-primary text-primary-foreground shadow-sm shadow-primary/20';

  return (
    <div className="flex items-center gap-2" onKeyDown={handleKeyDown} role="navigation" aria-label="Pagination">
      <div className="flex items-center gap-1">
        <button onClick={() => onPageChange(1)} disabled={page <= 1} aria-label="Première page"
          className={`${btn} px-1.5 ${page <= 1 ? off : on}`}><ChevronsLeft className="w-4 h-4" /></button>
        <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1} aria-label="Page précédente"
          className={`${btn} px-1.5 ${page <= 1 ? off : on}`}><ChevronLeft className="w-4 h-4" /></button>
        {pages.map((p, i) => p === '...' ? (
          <span key={`dots-${i}`} className="w-8 h-10 flex items-center justify-center text-xs text-muted-foreground/40">…</span>
        ) : (
          <button key={p} onClick={() => onPageChange(p)} aria-label={`Page ${p}`} aria-current={p === page ? 'page' : undefined}
            className={`${btn} px-1 ${p === page ? active : on}`}>{p}</button>
        ))}
        <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} aria-label="Page suivante"
          className={`${btn} px-1.5 ${page >= totalPages ? off : on}`}><ChevronRight className="w-4 h-4" /></button>
        <button onClick={() => onPageChange(totalPages)} disabled={page >= totalPages} aria-label="Dernière page"
          className={`${btn} px-1.5 ${page >= totalPages ? off : on}`}><ChevronsRight className="w-4 h-4" /></button>
      </div>
      <form onSubmit={handleJump} className="flex items-center gap-1.5 ml-2">
        <span className="text-[11px] text-muted-foreground">→</span>
        <input ref={jumpRef} type="number" min={1} max={totalPages} value={jumpValue}
          onChange={(e) => setJumpValue(e.target.value)} placeholder={`1–${totalPages}`}
          className="w-16 h-8 px-2 text-[11px] text-center font-semibold bg-surface border border-border/40 rounded-lg text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all" />
      </form>
    </div>
  );
}
