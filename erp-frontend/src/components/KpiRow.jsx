/**
 * KpiRow + KpiCard — Rangée de cartes métriques KPI pour les pages métier.
 *
 * Utilise les variables CSS du skin actif → réagit automatiquement aux 13 skins Katalyst.
 * La valeur s'affiche en JetBrains Mono si prop mono=true.
 *
 * Usage :
 *   <KpiRow cards={[
 *     { label: 'Total', value: 128, icon: Boxes, color: 'text-blue-400' },
 *     { label: 'En service', value: 94, icon: CheckCircle2, color: 'text-emerald-400', trend: { value: '+5%', up: true } },
 *     { label: 'En panne', value: 7, icon: AlertTriangle, color: 'text-red-400', trend: { value: '+2', up: false } },
 *     { label: 'Garantie ≤60j', value: 12, icon: Calendar, color: 'text-amber-400', mono: true },
 *   ]} />
 */

const COLOR_BG_MAP = {
  'text-blue-400': 'bg-blue-500/10',
  'text-blue-500': 'bg-blue-500/10',
  'text-emerald-400': 'bg-emerald-500/10',
  'text-emerald-500': 'bg-emerald-500/10',
  'text-emerald-600': 'bg-emerald-500/10',
  'text-amber-400': 'bg-amber-500/10',
  'text-amber-500': 'bg-amber-500/10',
  'text-red-400': 'bg-red-500/10',
  'text-red-500': 'bg-red-500/10',
  'text-purple-400': 'bg-purple-500/10',
  'text-purple-500': 'bg-purple-500/10',
  'text-indigo-400': 'bg-indigo-500/10',
  'text-teal-400': 'bg-teal-500/10',
  'text-cyan-400': 'bg-cyan-500/10',
  'text-orange-400': 'bg-orange-500/10',
  'text-slate-400': 'bg-surface-container',
  'text-rose-400': 'bg-rose-500/10',
  'text-primary': 'bg-primary/10',
};

function getBubbleBg(color) {
  return COLOR_BG_MAP[color] || 'bg-primary/10';
}

/**
 * KpiRow — Grille responsive de cartes KPI
 * @param {{ cards: KpiCardProps[] }} props
 */
export function KpiRow({ cards = [], className = '' }) {
  if (!cards.length) return null;
  return (
    <div
      className={`grid gap-4 mb-6 ${
        cards.length <= 2 ? 'grid-cols-2' :
        cards.length === 3 ? 'grid-cols-2 sm:grid-cols-3' :
        cards.length === 4 ? 'grid-cols-2 sm:grid-cols-4' :
        'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'
      } ${className}`}
    >
      {cards.map((card, i) => (
        <KpiCard key={i} {...card} />
      ))}
    </div>
  );
}

/**
 * KpiCard — Carte métrique individuelle
 */
export function KpiCard({
  label,
  value,
  icon: Icon,
  color = 'text-primary',
  trend = null,
  mono = false,
  loading = false,
}) {
  const bubbleBg = getBubbleBg(color);

  return (
    <div
      className="rounded-2xl border p-4 flex flex-col gap-3 transition-all duration-200 hover:scale-[1.01] group cursor-default"
      style={{
        backgroundColor: 'var(--color-surface-container-lowest)',
        borderColor: 'color-mix(in srgb, var(--color-outline-variant) 30%, transparent)',
        boxShadow: '0 1px 3px color-mix(in srgb, var(--color-shadow, #000) 4%, transparent)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--color-primary) 30%, transparent)';
        e.currentTarget.style.boxShadow = '0 0 0 1px color-mix(in srgb, var(--color-primary) 20%, transparent), 0 4px 12px color-mix(in srgb, var(--color-primary) 8%, transparent)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--color-outline-variant) 30%, transparent)';
        e.currentTarget.style.boxShadow = '0 1px 3px color-mix(in srgb, var(--color-shadow, #000) 4%, transparent)';
      }}
    >
      {/* Icône + Trend */}
      <div className="flex items-start justify-between">
        {Icon && (
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${bubbleBg}`}>
            <Icon className={`w-4 h-4 ${color}`} />
          </div>
        )}
        {trend && (
          <span
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
              trend.up
                ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                : 'text-red-500 bg-red-500/10'
            }`}
          >
            {trend.up ? '↑' : '↓'} {trend.value}
          </span>
        )}
      </div>

      {/* Valeur */}
      <div>
        {loading ? (
          <div
            className="h-7 w-16 rounded-lg animate-pulse"
            style={{ backgroundColor: 'var(--color-surface-container)' }}
          />
        ) : (
          <span
            className={`text-2xl font-bold leading-none block ${mono ? 'font-mono' : ''}`}
            style={{
              color: 'var(--color-on-surface)',
              fontFamily: mono ? "'JetBrains Mono', monospace" : 'Inter, sans-serif',
            }}
          >
            {value ?? '—'}
          </span>
        )}
        <p
          className="text-[11px] font-medium mt-1 leading-tight"
          style={{ color: 'var(--color-on-surface-variant)' }}
        >
          {label}
        </p>
      </div>
    </div>
  );
}

export default KpiRow;
