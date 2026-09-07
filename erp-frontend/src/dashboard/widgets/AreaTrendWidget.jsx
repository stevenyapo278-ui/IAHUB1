import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-3 py-2 rounded-xl shadow-xl text-xs border border-outline-variant/40"
      style={{ backgroundColor: 'var(--color-surface-container-lowest)', color: 'var(--color-on-surface)' }}>
      <p className="font-semibold mb-1 text-on-surface-variant text-[11px]">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="font-bold" style={{ color: p.color }}>{p.value} tickets</p>
      ))}
    </div>
  );
}

export default function AreaTrendWidget({ trendData, config }) {
  const chartData = (trendData || []).map((d) => ({
    name: d.date ? d.date.slice(8, 10) + '/' + d.date.slice(5, 7) : '',
    tickets: d.tickets || 0,
    resolved: d.resolved || 0,
  }));

  if (!chartData.length) {
    return <div className="h-full flex items-center justify-center text-xs text-on-surface-variant">Chargement…</div>;
  }

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="widgetGradTickets" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--skin-primary)" stopOpacity={0.2} />
              <stop offset="100%" stopColor="var(--skin-primary)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="widgetGradResolved" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-on-surface-variant)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--color-on-surface-variant)' }} axisLine={false} tickLine={false} width={30} />
          <Tooltip content={<ChartTooltip />} />
          <Area type="monotone" dataKey="tickets" stroke="var(--skin-primary)" fill="url(#widgetGradTickets)" strokeWidth={2} dot={false} />
          <Area type="monotone" dataKey="resolved" stroke="#10b981" fill="url(#widgetGradResolved)" strokeWidth={2} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
