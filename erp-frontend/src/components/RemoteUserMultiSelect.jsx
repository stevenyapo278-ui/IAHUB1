// Sélecteur d'utilisateurs MULTIPLE avec recherche côté serveur (pattern "remote search").
// Les libellés des valeurs sélectionnées sont résolus par lot via GET /users?ids=... (max 20 par
// lot) — le navigateur ne manipule jamais la liste complète des utilisateurs (1000+).
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, ChevronDown, Check, User as UserIcon, Loader2 } from 'lucide-react';
import api from '../api/client';

const PAGE_SIZE = 30;
const LABEL_BATCH = 20;

export default function RemoteUserMultiSelect({
  value,           // array of user IDs (primary prop)
  selectedIds,     // alias for backward compat
  onChange,
  placeholder = 'Rechercher des utilisateurs...',
  searchPlaceholder = 'Rechercher par nom ou email...',
  excludeIds = [],
  disabled = false,
  className = '',
}) {
  const ids = value || selectedIds || [];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [labelsById, setLabelsById] = useState({});
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 });
  const containerRef = useRef(null);
  const menuRef = useRef(null);
  const debounceRef = useRef(null);
  const requestSeq = useRef(0);

  const search = useCallback((q) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    const params = { limit: PAGE_SIZE };
    if (q.trim()) params.search = q.trim();
    api.get('/users', { params })
      .then(({ data }) => {
        if (seq !== requestSeq.current) return;
        const list = Array.isArray(data) ? data : (data.users || []);
        setOptions(list);
        setTotal(list.length);
      })
      .catch(() => { if (seq === requestSeq.current) setOptions([]); })
      .finally(() => { if (seq === requestSeq.current) setLoading(false); });
  }, []);

  useEffect(() => {
    if (ids.length === 0) { setLabelsById({}); return; }
    const missing = ids.filter((id) => !labelsById[id]);
    if (missing.length === 0) return;
    let cancelled = false;
    for (let i = 0; i < missing.length; i += LABEL_BATCH) {
      const batch = missing.slice(i, i + LABEL_BATCH);
      api.get('/users', { params: { ids: batch.join(',') } })
        .then(({ data }) => {
          if (cancelled) return;
          const list = Array.isArray(data) ? data : (data.users || []);
          setLabelsById((prev) => {
            const next = { ...prev };
            for (const u of list) next[u.id] = u.fullName;
            return next;
          });
        })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    search(query);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Position menu relative to trigger button (portal-based)
  useEffect(() => {
    if (!open || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + window.scrollY + 6,
      left: rect.left + window.scrollX,
      width: rect.width,
    });
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target) &&
          menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSearchChange(text) {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(text), 250);
  }

  function toggle(id) {
    const isSelected = ids.includes(id);
    const next = isSelected ? ids.filter((item) => item !== id) : [...ids, id];
    onChange(next);
  }

  const visibleOptions = options.filter((o) => !excludeIds.includes(o.id));

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Target button — Katalyst control style */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="w-full min-h-[2.5rem] px-3 flex items-center justify-between gap-2 rounded-lg border bg-surface text-foreground text-sm transition-colors cursor-pointer
          hover:border-muted-foreground/40
          focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background
          disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          borderColor: open ? 'var(--color-primary)' : undefined,
        }}
      >
        <div className="flex items-center gap-2 truncate min-w-0 flex-1">
          <UserIcon className="w-4 h-4 text-muted-foreground shrink-0" />
          {ids.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 truncate">
              {ids.length <= 2 ? (
                ids.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-primary/10 text-primary"
                  >
                    {labelsById[id] || `#${id}`}
                  </span>
                ))
              ) : (
                <span className="text-xs font-medium text-primary">
                  {ids.length} sélectionné{ids.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground font-normal">{placeholder}</span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {ids.length > 0 && (
            <span
              onClick={(e) => { e.stopPropagation(); onChange([]); }}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-muted transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Dropdown panel — rendered via Portal to escape overflow:hidden */}
      {open && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] overflow-hidden rounded-xl border border-border bg-surface shadow-xl animate-fadeIn"
          style={{
            top: menuPos.top,
            left: menuPos.left,
            width: menuPos.width,
            maxHeight: '24rem',
          }}
        >
          <div className="p-1.5 flex flex-col" style={{ maxHeight: '24rem' }}>
            {/* Search input */}
            <div className="relative shrink-0 mb-1">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full pl-8 pr-7 py-2 rounded-lg border border-border bg-surface text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
              />
              {loading && (
                <Loader2 className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-primary animate-spin" />
              )}
            </div>

            {/* Options list */}
            <div className="overflow-y-auto" style={{ maxHeight: '17rem' }}>
              {!loading && visibleOptions.length === 0 ? (
                <div className="px-2.5 py-2 text-sm text-muted-foreground">
                  Aucun utilisateur trouvé.
                </div>
              ) : (
                visibleOptions.map((opt) => {
                  const isSelected = ids.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => toggle(opt.id)}
                      className={`w-full px-2.5 py-2 rounded-lg text-sm text-left transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                        isSelected
                          ? 'bg-primary/10 font-medium text-primary'
                          : 'text-foreground hover:bg-surface-muted'
                      }`}
                    >
                      <div className="min-w-0 flex-1 flex items-center gap-2">
                        <span
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${
                            isSelected
                              ? 'bg-primary border-primary'
                              : 'border-border bg-transparent'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-sm">{opt.fullName}</p>
                          <p className="text-xs text-muted-foreground truncate">{opt.email}</p>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {!loading && total >= PAGE_SIZE && (
              <p className="shrink-0 text-center text-xs text-muted-foreground py-1 border-t border-border mt-1">
                {total} résultat(s) affiché(s)
              </p>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
