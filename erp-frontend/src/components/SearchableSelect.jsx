import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, ChevronDown, Check } from 'lucide-react';

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
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [menuStyle, setMenuStyle] = useState({});
  const containerRef = useRef(null);
  const menuRef = useRef(null);

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

  function updateMenuPosition() {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const menuHeight = Math.min(320, visibleOptions.length * 44 + 80);
    const openUp = spaceBelow < menuHeight && rect.top > spaceBelow;

    setMenuStyle({
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + 6, maxHeight: Math.min(spaceBelow - 8, 320) }
        : { top: rect.bottom + 6, maxHeight: Math.min(spaceBelow - 8, 320) }
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
      className="z-[9999] overflow-hidden rounded-xl border border-border bg-surface shadow-xl animate-fadeIn"
      style={menuStyle}
    >
      <div className="p-1.5 flex flex-col" style={{ maxHeight: '100%' }}>
        {/* Search input */}
        <div className="relative shrink-0 mb-1">
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
            <button type="button" onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Options list */}
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(100% - 48px)' }}>
          {filteredOptions.length === 0 ? (
            <div className="px-2.5 py-2 text-sm text-muted-foreground">Aucun résultat trouvé</div>
          ) : (
            visibleOptions.map((opt) => {
              const optVal = String(opt[valueKey]);
              const isSelected = String(value) === optVal;
              return (
                <button
                  key={optVal}
                  type="button"
                  onClick={() => { onChange(optVal); setOpen(false); setSearch(''); }}
                  className={`w-full px-2.5 py-2 rounded-lg text-sm text-left transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                    isSelected ? 'bg-primary/10 font-medium text-primary' : 'text-foreground hover:bg-surface-muted'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sm">{opt[labelKey]}</p>
                    {subLabelKey && opt[subLabelKey] && (
                      <p className="text-xs text-muted-foreground truncate">{opt[subLabelKey]}</p>
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
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="w-full h-10 px-3 flex items-center justify-between gap-2 rounded-lg border bg-surface text-foreground text-sm transition-colors cursor-pointer
          hover:border-muted-foreground/40
          focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background
          disabled:cursor-not-allowed disabled:opacity-50"
        style={{ borderColor: open ? 'var(--color-primary)' : undefined }}
      >
        <div className="flex items-center gap-2 truncate min-w-0">
          {Icon && <Icon className="w-4 h-4 text-muted-foreground shrink-0" />}
          {selectedOption ? (
            <span className="truncate font-medium text-sm">
              {selectedOption[labelKey]}
              {subLabelKey && selectedOption[subLabelKey] && (
                <span className="ml-1.5 text-xs text-muted-foreground font-normal">({selectedOption[subLabelKey]})</span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground font-normal">{placeholder}</span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {selectedOption && (
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
