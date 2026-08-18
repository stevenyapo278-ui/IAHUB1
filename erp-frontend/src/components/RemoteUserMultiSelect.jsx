// Sélecteur d'utilisateurs MULTIPLE avec recherche côté serveur (pattern "remote search").
// Les libellés des valeurs sélectionnées sont résolus par lot via GET /users?ids=... (max 20 par
// lot) — le navigateur ne manipule jamais la liste complète des utilisateurs (1000+).
import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, ChevronDown, Check, User as UserIcon, Loader2 } from 'lucide-react';
import api from '../api/client';

const PAGE_SIZE = 30;
const LABEL_BATCH = 20;

export default function RemoteUserMultiSelect({
  selectedIds = [],
  onChange,
  placeholder = 'Rechercher des utilisateurs...',
  searchPlaceholder = 'Rechercher par nom ou email...',
  excludeIds = [],
  disabled = false,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [labelsById, setLabelsById] = useState({});
  const containerRef = useRef(null);
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

  // Résout les libellés des sélections courantes par lots (20 ids max par requête)
  useEffect(() => {
    if (selectedIds.length === 0) { setLabelsById({}); return; }
    const missing = selectedIds.filter((id) => !labelsById[id]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

  useEffect(() => {
    if (!open) return;
    search(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
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
    const isSelected = selectedIds.includes(id);
    const next = isSelected
      ? selectedIds.filter((item) => item !== id)
      : [...selectedIds, id];
    onChange(next);
  }

  const visibleOptions = options.filter((o) => !excludeIds.includes(o.id));

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Bouton cible */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="w-full px-4 py-2.5 rounded-xl border text-left font-medium text-sm transition-all flex items-center justify-between gap-2 bg-surface border-outline-variant/60 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
      >
        <div className="flex items-center gap-2 truncate min-w-0 flex-1">
          <UserIcon className="w-4 h-4 text-primary shrink-0" />
          {selectedIds.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 truncate">
              {selectedIds.length <= 2 ? (
                selectedIds.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold bg-primary/15 text-primary"
                  >
                    {labelsById[id] || `#${id}`}
                  </span>
                ))
              ) : (
                <span className="text-xs font-bold text-primary">
                  {selectedIds.length} sélectionné{selectedIds.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
          ) : (
            <span className="text-on-surface-variant/60 font-normal">{placeholder}</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {selectedIds.length > 0 && (
            <span
              onClick={(e) => { e.stopPropagation(); onChange([]); }}
              className="p-1 hover:bg-surface-container-high rounded-lg text-outline hover:text-on-surface transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-outline transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Panneau de recherche distante */}
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-2xl border border-outline-variant/50 bg-surface-container-lowest shadow-2xl overflow-hidden p-2 space-y-2 animate-fadeIn max-h-96 flex flex-col">
          <div className="relative shrink-0">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full pl-8 pr-7 py-1.5 rounded-xl border border-outline-variant/40 bg-surface-container-low text-xs text-on-surface focus:outline-none focus:border-primary"
            />
            {loading && (
              <Loader2 className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-primary animate-spin" />
            )}
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {!loading && visibleOptions.length === 0 ? (
              <div className="p-3 text-center text-xs text-on-surface-variant italic">
                Aucun utilisateur trouvé.
              </div>
            ) : (
              visibleOptions.map((opt) => {
                const isSelected = selectedIds.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => toggle(opt.id)}
                    className={`w-full px-3 py-2 rounded-xl text-xs text-left transition-all flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'bg-primary/15 text-primary font-bold'
                        : 'hover:bg-surface-container text-on-surface'
                    }`}
                  >
                    <div className="min-w-0 flex-1 flex items-center gap-2">
                      <span
                        className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${
                          isSelected
                            ? 'bg-primary border-primary'
                            : 'border-outline-variant bg-transparent'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{opt.fullName}</p>
                        <p className="text-[10px] text-on-surface-variant font-medium truncate">{opt.email}</p>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {!loading && total >= PAGE_SIZE && (
            <p className="shrink-0 text-center text-[10px] text-on-surface-variant italic pb-0.5">
              {total} résultat(s) affiché(s) — continuez à taper pour affiner
            </p>
          )}
        </div>
      )}
    </div>
  );
}