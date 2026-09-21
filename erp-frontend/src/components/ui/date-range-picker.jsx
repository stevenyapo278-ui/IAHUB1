import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfYear, endOfYear, addMonths, isSameDay,
} from 'date-fns';
import { fr } from 'date-fns/locale/fr';
import { CalendarIcon, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import Calendar from './calendar';

const PRESETS = [
  { label: "Aujourd'hui", getValue: () => ({ from: new Date(), to: new Date() }) },
  { label: 'Hier', getValue: () => { const d = subDays(new Date(), 1); return { from: d, to: d }; } },
  { label: 'Cette semaine', getValue: () => ({ from: startOfWeek(new Date(), { weekStartsOn: 1 }), to: endOfWeek(new Date(), { weekStartsOn: 1 }) }) },
  { label: 'Semaine dernière', getValue: () => { const d = subDays(new Date(), 7); return { from: startOfWeek(d, { weekStartsOn: 1 }), to: endOfWeek(d, { weekStartsOn: 1 }) }; } },
  { label: 'Ce mois', getValue: () => ({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) }) },
  { label: 'Mois dernier', getValue: () => { const d = subDays(startOfMonth(new Date()), 1); return { from: startOfMonth(d), to: endOfMonth(d) }; } },
  { label: 'Cette année', getValue: () => ({ from: startOfYear(new Date()), to: endOfYear(new Date()) }) },
  { label: 'Année dernière', getValue: () => { const d = new Date(new Date().getFullYear() - 1, 0, 1); return { from: startOfYear(d), to: endOfYear(d) }; } },
  { label: 'Tout', getValue: () => ({ from: new Date(2020, 0, 1), to: new Date() }) },
];

function formatDateShort(date) {
  if (!date) return '';
  return format(date, 'dd MMM yyyy', { locale: fr });
}

function formatDateRange(from, to) {
  if (!from && !to) return 'Sélectionner une période';
  if (!from) return `À partir du ${formatDateShort(to)}`;
  if (!to) return `Jusqu'au ${formatDateShort(from)}`;
  return `${formatDateShort(from)} – ${formatDateShort(to)}`;
}

export default function DateRangePicker({
  value,
  onChange,
  presets = true,
  maxDate,
  placeholder = 'Sélectionner une période',
  className,
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value || { from: null, to: null });
  const [activePreset, setActivePreset] = useState(null);
  const [triggerRect, setTriggerRect] = useState(null);
  const containerRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    setDraft(value || { from: null, to: null });
  }, [value]);

  const close = useCallback(() => setOpen(false), []);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target) &&
        containerRef.current && !containerRef.current.contains(e.target)
      ) close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, close]);

  const handlePresetClick = (preset) => {
    const range = preset.getValue();
    setDraft(range);
    setActivePreset(preset.label);
  };

  const handleDayClick = (day) => {
    setActivePreset(null);
    if (!draft.from || (draft.from && draft.to)) {
      // Start new selection
      setDraft({ from: day, to: null });
    } else {
      // Complete the range
      if (isSameDay(day, draft.from)) {
        setDraft({ from: day, to: day });
      } else if (day < draft.from) {
        setDraft({ from: day, to: draft.from });
      } else {
        setDraft({ from: draft.from, to: day });
      }
    }
  };

  const handleApply = () => {
    onChange?.(draft);
    setOpen(false);
  };

  const handleCancel = () => {
    setDraft(value || { from: null, to: null });
    setActivePreset(null);
    setOpen(false);
  };

  const handleInputFrom = (e) => {
    const d = new Date(e.target.value);
    if (!isNaN(d.getTime())) {
      setDraft((prev) => ({ ...prev, from: d }));
      setActivePreset(null);
    }
  };

  const handleInputTo = (e) => {
    const d = new Date(e.target.value);
    if (!isNaN(d.getTime())) {
      setDraft((prev) => ({ ...prev, to: d }));
      setActivePreset(null);
    }
  };

  const toInputValue = (date) => {
    if (!date) return '';
    return format(date, 'yyyy-MM-dd');
  };

  // Calculate second calendar month — always the month after the first calendar
  const firstCalMonth = draft.from ? startOfMonth(draft.from) : startOfMonth(new Date());
  const secondMonth = addMonths(firstCalMonth, 1);

  return (
    <div ref={containerRef} className={cn('relative inline-block', className)}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => {
          if (!open) setTriggerRect(containerRef.current?.getBoundingClientRect());
          setOpen((o) => !o);
        }}
        className={cn(
          'flex items-center gap-2 px-3 py-2 text-xs rounded-xl border transition-all',
          'bg-surface border-outline-variant/60 text-on-surface',
          'hover:border-primary/40 hover:bg-surface-container',
          'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
          open && 'border-primary/40 ring-2 ring-primary/20',
        )}
      >
        <CalendarIcon className="w-3.5 h-3.5 text-on-surface-variant/60" />
        <span className={cn(!value?.from && !value?.to && 'text-on-surface-variant/50')}>
          {formatDateRange(value?.from, value?.to)}
        </span>
        <ChevronDown className={cn('w-3 h-3 text-on-surface-variant/40 transition-transform', open && 'rotate-180')} />
      </button>

      {/* Dropdown panel — portal to escape overflow containers */}
      {open && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[9999] bg-surface rounded-2xl border border-outline-variant/30 shadow-xl shadow-black/8 flex overflow-hidden"
          style={{
            top: triggerRect ? triggerRect.bottom + 8 : 0,
            right: triggerRect ? window.innerWidth - triggerRect.right : 0,
            width: presets ? 680 : 520,
          }}
        >
          {/* Presets sidebar */}
          {presets && (
            <div className="w-[140px] border-r border-outline-variant/20 py-2 flex-shrink-0">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handlePresetClick(preset)}
                  className={cn(
                    'w-full text-left px-4 py-1.5 text-xs transition-colors',
                    activePreset === preset.label
                      ? 'bg-primary/10 text-primary font-semibold'
                      : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}

          {/* Calendars */}
          <div className="flex-1 p-4">
            <div className="flex gap-4">
              <Calendar
                range={draft}
                onDayClick={handleDayClick}
                maxDate={maxDate}
              />
              <Calendar
                month={secondMonth}
                range={draft}
                onDayClick={handleDayClick}
                maxDate={maxDate}
              />
            </div>

            {/* Bottom bar */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-outline-variant/20">
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={toInputValue(draft.from)}
                  onChange={handleInputFrom}
                  max={toInputValue(draft.to || maxDate)}
                  className="px-2.5 py-1.5 text-xs bg-surface-container border border-outline-variant/40 rounded-lg text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary transition-all w-[130px]"
                />
                <span className="text-on-surface-variant/40 text-xs">–</span>
                <input
                  type="date"
                  value={toInputValue(draft.to)}
                  onChange={handleInputTo}
                  min={toInputValue(draft.from)}
                  max={toInputValue(maxDate)}
                  className="px-2.5 py-1.5 text-xs bg-surface-container border border-outline-variant/40 rounded-lg text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary transition-all w-[130px]"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-lg transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleApply}
                  className="px-4 py-1.5 text-xs font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
                >
                  Appliquer
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
