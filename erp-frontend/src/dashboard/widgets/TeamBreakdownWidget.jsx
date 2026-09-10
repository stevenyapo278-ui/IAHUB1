import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const PIE_COLORS = ['var(--skin-primary)', '#3b82f6', '#f97316', '#10b981', '#8b5cf6', '#ec4899'];

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="px-3 py-2 rounded-xl shadow-xl text-xs border border-outline-variant/40"
      style={{ backgroundColor: 'var(--color-surface-container-lowest)', color: 'var(--color-on-surface)' }}>
      <p className="font-semibold" style={{ color: d.payload?.color || d.color }}>{d.name}: {d.value}</p>
    </div>
  );
}

export default function TeamBreakdownWidget({ stats }) {
  const rawData = (stats?.byTeam || []).map((t, i) => ({
    name: t.teamName || 'Non assigné',
    value: t.count,
    color: PIE_COLORS[i % PIE_COLORS.length],
  }));
  const data = rawData.length > 0 ? rawData : [{ name: 'Aucun', value: 1, color: '#94a3b8' }];
  const total = rawData.reduce((s, d) => s + d.value, 0);

  return (
    <div className="flex items-center gap-4 h-full">
      <div className="shrink-0 relative w-[110px] h-[110px] min-w-[80px] min-h-[80px]">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <PieChart>
            <Pie
              data={data}
              cx="50%" cy="50%" innerRadius={32} outerRadius={48} paddingAngle={3}
              dataKey="value" stroke="none" animationDuration={700}
            >
              {data.map((d, i) => (
                <Cell key={i} fill={d.color || PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-sm font-bold text-on-surface">{total}</span>
        </div>
      </div>
      <div className="flex-1 space-y-1.5 min-w-0">
        {rawData.map((d, i) => (
          <div key={d.name} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: d.color || PIE_COLORS[i % PIE_COLORS.length] }} />
              <span className="text-xs font-medium text-on-surface truncate">{d.name}</span>
            </div>
            <span className="text-xs font-bold text-on-surface shrink-0">{d.value}</span>
          </div>
        ))}
        {rawData.length === 0 && (
          <p className="text-xs text-on-surface-variant italic">Aucune donnée</p>
        )}
      </div>
    </div>
  );
}
