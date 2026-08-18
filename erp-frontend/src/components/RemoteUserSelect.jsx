// Sélecteur d'utilisateur UNIQUE avec recherche côté serveur (pattern "remote search").
// Au lieu de charger toute la liste des utilisateurs (1000+) et de la filtrer dans le navigateur,
// on interroge GET /users?search=...&limit=30 à chaque frappe (debounce 250 ms) — le DOM ne
// contient jamais plus de 30 lignes. Les valeurs déjà sélectionnées sont résolues via GET
// /users?ids=... (ou via la prop valueLabel fournie par le parent).
import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, ChevronDown, Check, User as UserIcon, Loader2 } from 'lucide-react';
import api from '../api/client';

const PAGE_SIZE = 30;

const ROLE_BADGES = {
  SUPERADMIN: { label: 'Superadmin', cls: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' },
  ADMIN: { label: 'Admin', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
  HOTLINE: { label: 'Hotline', cls: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20' },
  TECHNICIAN: { label: 'Technicien', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
  REQUESTER: { label: 'Demandeur', cls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' },
};

export default function RemoteUserSelect({
  value,
  onChange,
  valueLabel,
  placeholder = 'Rechercher un utilisateur...',
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
  const [resolvedLabel, setResolvedLabel] = useState(null);
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

  // Résout le libellé de la valeur sélectionnée quand le parent n'en fournit pas
  useEffect(() => {
    if (!value || valueLabel) { setResolvedLabel(null); return; }
    let cancelled = false;
    api.get('/users', { params: { ids: String(value) } })
      .then(({ data }) => {
        const list = Array.isArray(data) ? data : (data.users || []);
        if (!cancelled && list.length > 0) setResolvedLabel(list[0].fullName);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [value, valueLabel]);

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

  const visibleOptions = options.filter((o) => !excludeIds.includes(o.id));
  const displayLabel = value ? (valueLabel || resolvedLabel || String(value)) : '';

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Bouton cible */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="w-full px-4 py-2.5 rounded-xl border text-left font-medium text-sm transition-all flex items-center justify-between gap-2 bg-slate-50 dark:bg-surface border-slate-200 dark:border-outline-variant/60 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
      >
        <div className="flex items-center gap-2 truncate">
          <UserIcon className="w-4 h-4 text-primary shrink-0" />
          {displayLabel ? (
            <span className="truncate font-semibold">{displayLabel}</span>
          ) : (
            <span className="text-slate-400 dark:text-zinc-500 font-normal">{placeholder}</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {value && (
            <span
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
              className="p-1 hover:bg-slate-200 dark:hover:bg-surface-container-high rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
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
                const isSelected = String(value) === String(opt.id);
                const badge = ROLE_BADGES[opt.role];
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => { onChange(String(opt.id)); setOpen(false); setQuery(''); }}
                    className={`w-full px-3 py-2 rounded-xl text-xs text-left transition-all flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'bg-primary/15 text-primary font-bold'
                        : 'hover:bg-surface-container text-on-surface'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{opt.fullName}</p>
                      <p className="text-[10px] text-on-surface-variant font-medium truncate">{opt.email}</p>
                    </div>
                    {badge && (
                      <span className={`shrink-0 px-2 py-0.5 rounded-full border text-[9px] font-extrabold uppercase tracking-wide ${badge.cls}`}>
                        {badge.label}
                      </span>
                    )}
                    {isSelected && <Check className="w-4 h-4 text-primary shrink-0" />}
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