import { useState, useRef, useEffect } from 'react';
import { Search, X, ChevronDown, Check, User } from 'lucide-react';

export default function SearchableMultiSelect({
  options = [],
  selectedIds = [],
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
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef(null);

  const filteredOptions = options.filter((opt) => {
    if (!search.trim()) return true;
    const term = search.toLowerCase().trim();
    const labelMatch = String(opt[labelKey] || '').toLowerCase().includes(term);
    const subMatch = subLabelKey ? String(opt[subLabelKey] || '').toLowerCase().includes(term) : false;
    return labelMatch || subMatch;
  });

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function toggle(id) {
    const isSelected = selectedIds.includes(id);
    const next = isSelected
      ? selectedIds.filter((item) => item !== id)
      : [...selectedIds, id];
    onChange(next);
  }

  const selectedOptions = options.filter((opt) => selectedIds.includes(opt[valueKey]));

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Target button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
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

      {/* Dropdown panel */}
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-2xl border border-outline-variant/50 bg-surface-container-lowest shadow-2xl overflow-hidden p-2 space-y-2 animate-fadeIn max-h-72 flex flex-col">
          {/* Live Search input */}
          <div className="relative shrink-0">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full pl-8 pr-7 py-1.5 rounded-xl border border-outline-variant/40 bg-surface-container-low text-xs text-on-surface focus:outline-none focus:border-primary"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Options list */}
          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {filteredOptions.length === 0 ? (
              <div className="p-3 text-center text-xs text-on-surface-variant italic">
                Aucun résultat trouvé ({options.length} au total)
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const optVal = String(opt[valueKey]);
                const isSelected = selectedIds.includes(opt[valueKey]);
                return (
                  <button
                    key={optVal}
                    type="button"
                    onClick={() => toggle(opt[valueKey])}
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
                        <p className="truncate font-semibold">{opt[labelKey]}</p>
                        {subLabelKey && opt[subLabelKey] && (
                          <p className="text-[10px] text-on-surface-variant font-medium truncate">{opt[subLabelKey]}</p>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
