import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, ChevronDown, Check, Loader2 } from 'lucide-react';

const MAX_RENDERED = 80;

export default function SearchableSelect({
  options = [],
  value,
  onChange,
  placeholder = 'Sélectionner...',
  searchPlaceholder = 'Rechercher...',
  labelKey = 'label',
  valueKey = 'value',
  subLabelKey,
  icon: Icon,
  disabled = false,
  loading = false,
  ariaLabel,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlighted, setHighlighted] = useState(-1);
  const [menuStyle, setMenuStyle] = useState({});
  const containerRef = useRef(null);
  const menuRef = useRef(null);
  const searchRef = useRef(null);

  const selectedOption = useMemo(
    () => options.find((opt) => String(opt[valueKey]) === String(value)),
    [options, value, valueKey]
  );

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

  // Remet la surbrillance sur l'option sélectionnée (ou la première) à l'ouverture / au filtrage
  useEffect(() => {
    if (!open) return;
    const selectedIdx = filteredOptions.findIndex((opt) => String(opt[valueKey]) === String(value));
    setHighlighted(selectedIdx >= 0 ? selectedIdx : filteredOptions.length > 0 ? 0 : -1);
  }, [open, search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus automatique sur le champ de recherche à l'ouverture
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => searchRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    setSearch('');
  }, [open]);

  const selectOption = useCallback((opt) => {
    onChange(String(opt[valueKey]));
    setOpen(false);
    setSearch('');
  }, [onChange, valueKey]);

  // Navigation clavier commune (déclencheur + champ de recherche) : flèches, Entrée, Échap, Début/Fin
  const handleKeyDown = useCallback((e) => {
    if (disabled || loading) return;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlighted((i) => Math.min(i + 1, filteredOptions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlighted((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setHighlighted(filteredOptions.length > 0 ? 0 : -1);
        break;
      case 'End':
        e.preventDefault();
        setHighlighted(filteredOptions.length - 1);
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredOptions[highlighted]) selectOption(filteredOptions[highlighted]);
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      default:
        break;
    }
  }, [open, disabled, loading, filteredOptions, highlighted, selectOption]);

  function updateMenuPosition() {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const menuHeight = Math.min(340, visibleOptions.length * 48 + 80);
    const openUp = spaceBelow < menuHeight && rect.top > spaceBelow;

    const targetWidth = Math.max(rect.width, Math.min(window.innerWidth - 32, 420));
    const leftPos = Math.max(12, Math.min(rect.left, window.innerWidth - targetWidth - 16));

    setMenuStyle({
      position: 'fixed',
      left: leftPos,
      width: targetWidth,
      maxWidth: 'calc(100vw - 24px)',
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + 6, maxHeight: Math.min(rect.top - 12, 340) }
        : { top: rect.bottom + 6, maxHeight: Math.min(spaceBelow - 12, 340) }
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
  }, [open, visibleOptions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (
        containerRef.current && !containerRef.current.contains(e.target) &&
        menuRef.current && !menuRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const dropdown = open ? createPortal(
    <div
      ref={menuRef}
      role="listbox"
      aria-label={ariaLabel || placeholder}
      className="z-[9999] overflow-hidden rounded-xl border border-border bg-surface shadow-xl animate-fadeIn"
      style={menuStyle}
    >
      <div className="p-1.5 flex flex-col" style={{ maxHeight: '100%' }}>
        {/* Search input */}
        <div className="relative shrink-0 mb-1">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            type="text"
            role="searchbox"
            aria-label={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={searchPlaceholder}
            className="w-full pl-8 pr-7 py-2 rounded-lg border border-border bg-surface text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Options list */}
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(100% - 48px)' }}>
          {loading ? (
            <div className="px-2.5 py-3 text-sm text-muted-foreground flex items-center gap-2 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
            </div>
          ) : filteredOptions.length === 0 ? (
            <div className="px-2.5 py-2 text-sm text-muted-foreground">Aucun résultat trouvé</div>
          ) : (
            visibleOptions.map((opt, idx) => {
              const optVal = String(opt[valueKey]);
              const isSelected = String(value) === optVal;
              const isHighlighted = idx === highlighted;
              return (
                <button
                  key={optVal}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => selectOption(opt)}
                  onMouseEnter={() => setHighlighted(idx)}
                  className={`w-full px-2.5 py-2 rounded-lg text-sm text-left transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                    isSelected ? 'bg-primary/10 font-medium text-primary' : isHighlighted ? 'bg-surface-muted text-foreground' : 'text-foreground'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-xs leading-relaxed text-left break-words" title={opt[labelKey]}>
                      {opt[labelKey]}
                    </p>
                    {subLabelKey && opt[subLabelKey] && (
                      <p className="text-[11px] text-muted-foreground leading-snug break-words mt-0.5" title={opt[subLabelKey]}>
                        {opt[subLabelKey]}
                      </p>
                    )}
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-primary shrink-0" />}
                </button>
              );
            })
          )}
        </div>

        {isTruncated && (
          <p className="shrink-0 text-center text-xs text-muted-foreground py-1 border-t border-border mt-1">
            {filteredOptions.length - MAX_RENDERED} autre(s) résultat(s)
          </p>
        )}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel || placeholder}
        className="w-full h-10 px-3 flex items-center justify-between gap-2 rounded-lg border bg-surface text-foreground text-sm transition-colors cursor-pointer
          hover:border-muted-foreground/40
          focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background
          disabled:cursor-not-allowed disabled:opacity-50"
        style={{ borderColor: open ? 'var(--color-primary)' : undefined }}
      >
        <div className="flex items-center gap-2 truncate min-w-0">
          {Icon && <Icon className="w-4 h-4 text-muted-foreground shrink-0" />}
          {selectedOption ? (
            <span className="truncate font-medium text-xs text-left" title={selectedOption[labelKey]}>
              {selectedOption[labelKey]}
              {subLabelKey && selectedOption[subLabelKey] && (
                <span className="ml-1.5 text-[11px] text-muted-foreground font-normal">({selectedOption[subLabelKey]})</span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground font-normal">{placeholder}</span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {selectedOption && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Effacer la sélection"
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-muted transition-colors cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          {loading ? (
            <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
          ) : (
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
          )}
        </div>
      </button>
      {dropdown}
    </div>
  );
}
