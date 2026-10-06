import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, ChevronDown, Check, User } from 'lucide-react';

// Nombre maximum d'options rendues dans le dropdown — au-delà, l'utilisateur continue de taper
// pour affiner la recherche. Évite le ralentissement avec de grandes listes (utilisateurs GLPI).
const MAX_RENDERED = 80;

export default function SearchableMultiSelect({
  options = [],
  value,          // tableau de valeurs sélectionnées (prop principale)
  selectedIds,    // alias rétrocompatible
  onChange,
  placeholder = 'Rechercher...',
  searchPlaceholder = 'Rechercher par nom ou email...',
  labelKey = 'label',
  valueKey = 'value',
  subLabelKey,
  icon: Icon,
  disabled = false,
  className = '',
}) {
  const ids = value ?? selectedIds ?? [];
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [menuStyle, setMenuStyle] = useState({});
  const containerRef = useRef(null);
  const panelRef = useRef(null);

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options;
    const term = search.toLowerCase().trim();
    return options.filter((opt) => {
      const labelMatch = String(opt[labelKey] || '').toLowerCase().includes(term);
      const subMatch = subLabelKey ? String(opt[subLabelKey] || '').toLowerCase().includes(term) : false;
      return labelMatch || subMatch;
    });
  }, [options, search, labelKey, subLabelKey]);

  const visibleOptions = filteredOptions.slice(0, MAX_RENDERED);
  const isTruncated = filteredOptions.length > MAX_RENDERED;

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target) &&
        panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Échap ferme le dropdown
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // Positionnement en fixed dans un portail : le panneau n'est jamais rogné par
  // les overflow:hidden des cartes (bento-card) et s'ouvre vers le haut si besoin.
  function updateMenuPosition() {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const menuHeight = Math.min(340, visibleOptions.length * 42 + 72);
    const openUp = spaceBelow < menuHeight + 12 && spaceAbove > spaceBelow;
    const width = Math.min(rect.width, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));

    setMenuStyle({
      position: 'fixed',
      left,
      width,
      maxWidth: 'calc(100vw - 24px)',
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + 6, maxHeight: Math.max(160, Math.min(spaceAbove - 12, 340)) }
        : { top: rect.bottom + 6, maxHeight: Math.max(160, Math.min(spaceBelow - 12, 340)) })
    });
  }

  useLayoutEffect(() => {
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
  }, [open, visibleOptions.length]);

  function toggle(id) {
    const isSelected = ids.includes(id);
    const next = isSelected
      ? ids.filter((item) => item !== id)
      : [...ids, id];
    onChange(next);
  }

  const selectedOptions = useMemo(
    () => options.filter((opt) => ids.includes(opt[valueKey])),
    [options, ids, valueKey]
  );

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Target button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="w-full px-4 py-2.5 rounded-xl border text-left font-medium text-sm transition-all flex items-center justify-between gap-2 bg-surface border-outline-variant/60 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
      >
        <div className="flex items-center gap-2 truncate min-w-0 flex-1">
          {Icon && <Icon className="w-4 h-4 text-primary shrink-0" />}
          {selectedOptions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 truncate">
              {selectedOptions.length <= 2 ? (
                selectedOptions.map((opt) => (
                  <span
                    key={opt[valueKey]}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold bg-primary/15 text-primary"
                  >
                    <User className="w-3 h-3" />
                    {opt[labelKey]}
                  </span>
                ))
              ) : (
                <span className="text-xs font-bold text-primary">
                  {selectedOptions.length} sélectionné{selectedOptions.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
          ) : (
            <span className="text-on-surface-variant/60 font-normal">{placeholder}</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {selectedOptions.length > 0 && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
              className="p-1 hover:bg-surface-container-high rounded-lg text-outline hover:text-on-surface transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-outline transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Dropdown panel — portail : pas de rognage par les cartes, ouverture auto vers le haut */}
      {open && createPortal(
        <div
          ref={panelRef}
          role="listbox"
          aria-multiselectable="true"
          className="z-[9999] rounded-xl border border-border bg-surface shadow-xl animate-fadeIn flex flex-col overflow-hidden p-1.5"
          style={menuStyle}
        >
          {/* Live Search input */}
          <div className="relative shrink-0 mb-1.5">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full pl-8 pr-7 py-2 rounded-lg border border-border bg-surface text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
            />
            {search && (
              <button
                type="button"
                aria-label="Effacer la recherche"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Options list */}
          <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5 pr-0.5">
            {filteredOptions.length === 0 ? (
              <div className="p-3 text-center text-xs text-muted-foreground italic">
                Aucun résultat trouvé ({options.length} au total)
              </div>
            ) : (
              visibleOptions.map((opt) => {
                const optVal = String(opt[valueKey]);
                const isSelected = ids.includes(opt[valueKey]);
                return (
                  <button
                    key={optVal}
                    type="button"
                    onClick={() => toggle(opt[valueKey])}
                    className={`w-full px-3 py-2 rounded-lg text-xs text-left transition-colors flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'bg-primary/10 text-primary font-bold'
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
                        <p className="truncate font-semibold" title={opt[labelKey]}>{opt[labelKey]}</p>
                        {subLabelKey && opt[subLabelKey] && (
                          <p className="text-[10px] text-muted-foreground font-medium truncate" title={opt[subLabelKey]}>{opt[subLabelKey]}</p>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
          {isTruncated && (
            <p className="shrink-0 text-center text-[10px] text-muted-foreground italic pt-1 mt-1 border-t border-border">
              {filteredOptions.length - MAX_RENDERED} autre(s) résultat(s) — continuez à taper pour affiner
            </p>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
