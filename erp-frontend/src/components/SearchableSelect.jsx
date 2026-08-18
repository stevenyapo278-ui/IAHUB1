import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, X, ChevronDown, Check } from 'lucide-react';

// Nombre maximum d'options rendues dans le dropdown — au-delà, l'utilisateur continue de taper
// pour affiner la recherche. Évite le ralentissement avec de grandes listes (utilisateurs GLPI).
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
  const containerRef = useRef(null);

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

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Target button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="w-full px-4 py-2.5 rounded-xl border text-left font-medium text-sm transition-all flex items-center justify-between gap-2 bg-slate-50 dark:bg-surface border-slate-200 dark:border-outline-variant/60 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
      >
        <div className="flex items-center gap-2 truncate">
          {Icon && <Icon className="w-4 h-4 text-primary shrink-0" />}
          {selectedOption ? (
            <span className="truncate font-semibold">
              {selectedOption[labelKey]}
              {subLabelKey && selectedOption[subLabelKey] && (
                <span className="ml-1.5 text-xs text-on-surface-variant font-normal">
                  ({selectedOption[subLabelKey]})
                </span>
              )}
            </span>
          ) : (
            <span className="text-slate-400 dark:text-zinc-500 font-normal">{placeholder}</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {selectedOption && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              className="p-1 hover:bg-slate-200 dark:hover:bg-surface-container-high rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
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
              visibleOptions.map((opt) => {
                const optVal = String(opt[valueKey]);
                const isSelected = String(value) === optVal;
                return (
                  <button
                    key={optVal}
                    type="button"
                    onClick={() => {
                      onChange(optVal);
                      setOpen(false);
                      setSearch('');
                    }}
                    className={`w-full px-3 py-2 rounded-xl text-xs text-left transition-all flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'bg-primary/15 text-primary font-bold'
                        : 'hover:bg-surface-container text-on-surface'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{opt[labelKey]}</p>
                      {subLabelKey && opt[subLabelKey] && (
                        <p className="text-[10px] text-on-surface-variant font-medium truncate">{opt[subLabelKey]}</p>
                      )}
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-primary shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
          {isTruncated && (
            <p className="shrink-0 text-center text-[10px] text-on-surface-variant italic pb-0.5">
              {filteredOptions.length - MAX_RENDERED} autre(s) résultat(s) — continuez à taper pour affiner
            </p>
          )}
        </div>
      )}
    </div>
  );
}
