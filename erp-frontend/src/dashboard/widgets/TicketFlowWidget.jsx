import { useState, useMemo } from 'react';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

const PERIODS = [
  { key: 'week', label: '7j' },
  { key: 'month', label: '30j' },
  { key: 'quarter', label: '90j' },
];

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-3 py-2 rounded-xl shadow-xl text-xs border border-outline-variant/40"
      style={{ backgroundColor: 'var(--color-surface-container-lowest)', color: 'var(--color-on-surface)' }}>
      <p className="font-semibold mb-1 text-on-surface-variant text-[11px]">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="font-bold" style={{ color: p.color }}>
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  );
}

function buildSeriesData(trend, period) {
  if (!trend?.length) return { labels: [], created: [], resolved: [] };

  if (period === 'week') {
    const last7 = trend.slice(-7);
    return {
      labels: last7.map((d) => d.date ? d.date.slice(8, 10) + '/' + d.date.slice(5, 7) : ''),
      created: last7.map((d) => d.tickets || 0),
      resolved: last7.map((d) => d.resolved || 0),
    };
  }

  if (period === 'month') {
    const last30 = trend.slice(-30);
    return {
      labels: last30.map((d) => d.date ? d.date.slice(8, 10) + '/' + d.date.slice(5, 7) : ''),
      created: last30.map((d) => d.tickets || 0),
      resolved: last30.map((d) => d.resolved || 0),
    };
  }

  const last90 = trend.slice(-90);
  return {
    labels: last90.map((d) => d.date ? d.date.slice(8, 10) + '/' + d.date.slice(5, 7) : ''),
    created: last90.map((d) => d.tickets || 0),
    resolved: last90.map((d) => d.resolved || 0),
  };
}

export default function TicketFlowWidget({ trendData, config }) {
  const [period, setPeriod] = useState('month');

  const series = useMemo(() => buildSeriesData(trendData, period), [trendData, period]);

  const chartData = useMemo(() =>
    series.labels.map((label, i) => ({
      label,
      created: series.created[i],
      resolved: series.resolved[i],
    })),
    [series],
  );

  const totalCreated = useMemo(() => series.created.reduce((s, v) => s + v, 0), [series]);
  const totalResolved = useMemo(() => series.resolved.reduce((s, v) => s + v, 0), [series]);
  const avgCreated = series.created.length ? Math.round(totalCreated / series.created.length) : 0;
  const avgResolved = series.resolved.length ? Math.round(totalResolved / series.resolved.length) : 0;

  if (!trendData?.length) {
    return <div className="h-full flex items-center justify-center text-xs text-on-surface-variant">Chargement…</div>;
  }

  return (
    <div className="h-full w-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-1 mb-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[var(--skin-primary)]" />
            <span className="text-[10px] font-bold text-on-surface-variant">
              Créés <span className="text-on-surface">{totalCreated.toLocaleString()}</span>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-[10px] font-bold text-on-surface-variant">
              Résolus <span className="text-on-surface">{totalResolved.toLocaleString()}</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-0.5 bg-surface-container rounded-lg p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-2 py-0.5 rounded-md text-[10px] font-bold cursor-pointer transition-all ${
                period === p.key
                  ? 'bg-primary/10 text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary row */}
      <div className="flex items-center gap-4 px-1 mb-2">
        <div className="text-center">
          <p className="text-lg font-bold text-on-surface leading-none">{totalCreated}</p>
          <p className="text-[9px] text-on-surface-variant font-semibold uppercase">Total créés</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-emerald-600 leading-none">{totalResolved}</p>
          <p className="text-[9px] text-on-surface-variant font-semibold uppercase">Total résolus</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-on-surface leading-none">{avgCreated}</p>
          <p className="text-[9px] text-on-surface-variant font-semibold uppercase">Moy/jour créés</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-emerald-600 leading-none">{avgResolved}</p>
          <p className="text-[9px] text-on-surface-variant font-semibold uppercase">Moy/jour résolus</p>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <BarChart data={chartData} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }}
              axisLine={false}
              tickLine={false}
              width={30}
              allowDecimals={false}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-surface-container)' }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar
              dataKey="created"
              name="Créés"
              fill="var(--skin-primary)"
              radius={[4, 4, 0, 0]}
              maxBarThickness={22}
            />
            <Bar
              dataKey="resolved"
              name="Résolus"
              fill="#10b981"
              radius={[4, 4, 0, 0]}
              maxBarThickness={22}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
