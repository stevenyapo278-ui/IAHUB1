// Sélecteur d'utilisateur UNIQUE avec recherche côté serveur (pattern "remote search").
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, ChevronDown, Check, User as UserIcon, Loader2 } from 'lucide-react';
import api from '../api/client';

const PAGE_SIZE = 30;

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
  const [menuStyle, setMenuStyle] = useState({});
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
    if (!value || valueLabel) { setResolvedLabel(null); return; }
    let cancelled = false;
    api.get('/users', { params: { ids: String(value) } })
      .then(({ data }) => {
        const list = Array.isArray(data) ? data : (data.users || []);
        if (!cancelled && list.length > 0) setResolvedLabel(list[0].fullName);
      }).catch(() => {});
    return () => { cancelled = true; };
  }, [value, valueLabel]);

  useEffect(() => {
    if (!open) return;
    search(query);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateMenuPosition() {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < 320 && rect.top > 320;
    setMenuStyle({
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + 6, maxHeight: Math.min(spaceBelow - 8, 380) }
        : { top: rect.bottom + 6, maxHeight: Math.min(spaceBelow - 8, 380) }
      ),
    });
  }

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const onScroll = () => updateMenuPosition();
    const onResize = () => updateMenuPosition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target) &&
          menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function handleSearchChange(text) {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(text), 250);
  }

  const visibleOptions = options.filter((o) => !excludeIds.includes(o.id));
  const displayLabel = value ? (valueLabel || resolvedLabel || String(value)) : '';

  const dropdown = open ? createPortal(
    <div ref={menuRef} className="z-[9999] overflow-hidden rounded-xl border border-border bg-surface shadow-xl animate-fadeIn" style={menuStyle}>
      <div className="p-1.5 flex flex-col" style={{ maxHeight: '100%' }}>
        <div className="relative shrink-0 mb-1">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="text" autoFocus value={query} onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full pl-8 pr-7 py-2 rounded-lg border border-border bg-surface text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors" />
          {loading && <Loader2 className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-primary animate-spin" />}
        </div>
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(100% - 48px)' }}>
          {!loading && visibleOptions.length === 0 ? (
            <div className="px-2.5 py-2 text-sm text-muted-foreground">Aucun utilisateur trouvé.</div>
          ) : (
            visibleOptions.map((opt) => {
              const isSelected = String(value) === String(opt.id);
              return (
                <button key={opt.id} type="button"
                  onClick={() => { onChange(String(opt.id)); setOpen(false); setQuery(''); }}
                  className={`w-full px-2.5 py-2 rounded-lg text-sm text-left transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                    isSelected ? 'bg-primary/10 font-medium text-primary' : 'text-foreground hover:bg-surface-muted'
                  }`}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sm">{opt.fullName}</p>
                    <p className="text-xs text-muted-foreground truncate">{opt.email}</p>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-primary shrink-0" />}
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
  ) : null;

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <button type="button" disabled={disabled} onClick={() => setOpen((prev) => !prev)}
        className="w-full h-10 px-3 flex items-center justify-between gap-2 rounded-lg border bg-surface text-foreground text-sm transition-colors cursor-pointer
          hover:border-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background
          disabled:cursor-not-allowed disabled:opacity-50"
        style={{ borderColor: open ? 'var(--color-primary)' : undefined }}>
        <div className="flex items-center gap-2 truncate min-w-0">
          <UserIcon className="w-4 h-4 text-muted-foreground shrink-0" />
          {displayLabel ? (
            <span className="truncate font-medium text-sm">{displayLabel}</span>
          ) : (
            <span className="text-muted-foreground font-normal">{placeholder}</span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {value && (
            <span onClick={(e) => { e.stopPropagation(); onChange(''); }}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-muted transition-colors">
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {dropdown}
    </div>
  );
}
