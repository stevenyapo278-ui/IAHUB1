import { useMemo, useState } from 'react';

function getIntensityColor(count, max) {
  if (count === 0) return 'var(--color-surface-container-high)';
  const ratio = count / max;
  if (ratio <= 0.25) return 'color-mix(in srgb, var(--skin-primary) 25%, transparent)';
  if (ratio <= 0.5) return 'color-mix(in srgb, var(--skin-primary) 50%, transparent)';
  if (ratio <= 0.75) return 'color-mix(in srgb, var(--skin-primary) 75%, transparent)';
  return 'var(--skin-primary)';
}

function CellTooltip({ count, week, day, date }) {
  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 rounded-xl shadow-xl text-xs border border-outline-variant/40 z-50 pointer-events-none whitespace-nowrap"
      style={{ backgroundColor: 'var(--color-surface-container-lowest)', color: 'var(--color-on-surface)' }}>
      <p className="font-semibold">{count} ticket{count > 1 ? 's' : ''}</p>
      <p className="text-on-surface-variant">{day} — {week}</p>
      {date && <p className="text-muted-foreground text-[10px] mt-0.5">{date}</p>}
    </div>
  );
}

export default function HeatmapWidget({ heatmap, config }) {
  const [hoveredCell, setHoveredCell] = useState(null);

  const { weeks, days, grid, total, maxCount, weekCount } = useMemo(() => {
    if (!heatmap?.grid?.length) return { weeks: [], days: [], grid: [], total: 0, maxCount: 0, weekCount: 0 };
    const max = Math.max(...heatmap.grid.flat());
    return { ...heatmap, maxCount: max, weekCount: heatmap.weeks.length };
  }, [heatmap]);

  if (!weeks.length) {
    return <div className="h-full flex items-center justify-center text-xs text-on-surface-variant">Chargement…</div>;
  }

  return (
    <div className="h-full w-full flex flex-col p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-on-surface-variant uppercase tracking-wide">
          Activité des tickets
        </p>
        <p className="text-xs text-muted-foreground">
          {total.toLocaleString('fr-FR')} ticket{total > 1 ? 's' : ''} au total
        </p>
      </div>

      {/* Heatmap grid — CSS grid with responsive cells */}
      <div className="flex-1 flex items-stretch gap-3 min-h-0">
        {/* Day labels */}
        <div className="flex flex-col justify-between shrink-0 py-0.5">
          {days.map((day) => (
            <div key={day} className="flex items-center text-xs text-muted-foreground font-medium h-full">
              {day.charAt(0)}
            </div>
          ))}
        </div>

        {/* Grid cells */}
        <div
          className="flex-1 grid gap-1 min-h-0"
          style={{
            gridTemplateColumns: `repeat(${weekCount}, 1fr)`,
            gridTemplateRows: 'repeat(7, 1fr)',
          }}
        >
          {grid.map((row, di) =>
            row.map((count, wi) => {
              const cellKey = `${di}-${wi}`;
              const isHovered = hoveredCell === cellKey;
              return (
                <div
                  key={cellKey}
                  className="relative rounded-md cursor-pointer transition-all duration-150 min-h-[10px]"
                  style={{
                    backgroundColor: getIntensityColor(count, maxCount),
                    boxShadow: isHovered ? '0 0 0 2px var(--skin-primary)' : 'none',
                    transform: isHovered ? 'scale(1.15)' : 'none',
                    zIndex: isHovered ? 10 : 0,
                  }}
                  onMouseEnter={() => setHoveredCell(cellKey)}
                  onMouseLeave={() => setHoveredCell(null)}
                >
                  {isHovered && (
                    <CellTooltip
                      count={count}
                      week={weeks[wi]}
                      day={days[di]}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-3 justify-end">
        <span className="text-[11px] text-muted-foreground">Moins</span>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const count = Math.round(ratio * maxCount);
          return (
            <div
              key={ratio}
              className="w-4 h-4 rounded-sm"
              style={{ backgroundColor: getIntensityColor(count, maxCount) }}
              title={`${count} ticket${count > 1 ? 's' : ''}`}
            />
          );
        })}
        <span className="text-[11px] text-muted-foreground">Plus</span>
      </div>
    </div>
  );
}
