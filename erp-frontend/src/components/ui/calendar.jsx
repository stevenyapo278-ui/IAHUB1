import { useState } from 'react';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, addMonths, subMonths,
  isSameMonth, isSameDay, isWithinInterval, isToday, isBefore, isAfter,
} from 'date-fns';
import { fr } from 'date-fns/locale/fr';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];

export default function Calendar({
  month: controlledMonth,
  onMonthChange,
  range,
  onDayClick,
  minDate,
  maxDate,
  className,
}) {
  const [internalMonth, setInternalMonth] = useState(() => controlledMonth || range?.from || new Date());
  const currentMonth = controlledMonth ?? internalMonth;

  const setMonth = (date) => {
    setInternalMonth(date);
    onMonthChange?.(date);
  };

  const handlePrev = () => setMonth(subMonths(currentMonth, 1));
  const handleNext = () => setMonth(addMonths(currentMonth, 1));

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const isDisabled = (day) => {
    if (minDate && isBefore(day, minDate) && !isSameDay(day, minDate)) return true;
    if (maxDate && isAfter(day, maxDate) && !isSameDay(day, maxDate)) return true;
    return false;
  };

  const inRange = (day) => {
    if (!range?.from || !range?.to) return false;
    return isWithinInterval(day, { start: range.from, end: range.to });
  };

  return (
    <div className={cn('select-none', className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <button
          type="button"
          onClick={handlePrev}
          className="p-1 rounded-lg hover:bg-surface-container-high transition-colors text-on-surface-variant"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold text-on-surface capitalize">
          {format(currentMonth, 'MMMM yyyy', { locale: fr })}
        </span>
        <button
          type="button"
          onClick={handleNext}
          className="p-1 rounded-lg hover:bg-surface-container-high transition-colors text-on-surface-variant"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60 py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const inCurrentMonth = isSameMonth(day, currentMonth);
          const disabled = isDisabled(day);
          const today = isToday(day);
          const isStart = range?.from && isSameDay(day, range.from);
          const isEnd = range?.to && isSameDay(day, range.to);
          const inRangeClass = inRange(day) && !isStart && !isEnd;

          return (
            <button
              key={day.toISOString()}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && onDayClick?.(day)}
              className={cn(
                'relative h-8 text-xs font-medium rounded-lg transition-all duration-100',
                'flex items-center justify-center mx-auto w-8',
                !inCurrentMonth && 'text-on-surface-variant/25',
                inCurrentMonth && !disabled && 'text-on-surface hover:bg-primary/10',
                disabled && 'text-on-surface-variant/20 cursor-not-allowed',
                // Start/End selected
                (isStart || isEnd) && 'bg-primary text-white hover:bg-primary/90 font-bold',
                // In range background
                inRangeClass && 'bg-primary/10 text-primary rounded-none',
                // In range adjustments for start/end
                isStart && range?.to && 'rounded-r-none',
                isEnd && range?.from && 'rounded-l-none',
                // Today ring
                today && !isStart && !isEnd && 'ring-1 ring-primary/30',
              )}
            >
              {format(day, 'd')}
            </button>
          );
        })}
      </div>
    </div>
  );
}
