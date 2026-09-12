import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

const COLORS = ['#6366f1', '#3b82f6', '#f97316', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6', '#f43f5e', '#0ea5e9', '#84cc16'];

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="px-3 py-2 rounded-xl shadow-xl text-xs border border-outline-variant/40"
      style={{ backgroundColor: 'var(--color-surface-container-lowest)', color: 'var(--color-on-surface)' }}>
      <p className="font-semibold" style={{ color: d.payload?.color || d.color }}>{d.name}</p>
      <p>{d.value} ticket{d.value > 1 ? 's' : ''} actif{d.value > 1 ? 's' : ''}</p>
    </div>
  );
}

function CustomLegend({ payload }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center mt-2">
      {payload?.map((entry, i) => (
        <div key={i} className="flex items-center gap-1.5 text-[11px] text-on-surface-variant">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: entry.color }} />
          <span className="truncate max-w-[100px]">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function WorkloadTeamsWidget({ workloadByTeam }) {
  const data = (workloadByTeam || []).map((t, i) => ({
    name: t.teamName || 'Non assignée',
    value: t.count,
    color: COLORS[i % COLORS.length],
  }));

  const chartData = data.length > 0 ? data : [{ name: 'Aucune donnée', value: 1, color: '#94a3b8' }];
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%" cy="48%"
              innerRadius="40%" outerRadius="72%"
              paddingAngle={2}
              dataKey="value"
              stroke="none"
              animationDuration={800}
            >
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.color || COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
            <Legend content={<CustomLegend />} />
            {/* Total au centre */}
            <text x="50%" y="46%" textAnchor="middle" dominantBaseline="central"
              className="fill-on-surface text-2xl font-bold" style={{ fontSize: '1.5rem', fontWeight: 700 }}>
              {total}
            </text>
            <text x="50%" y="56%" textAnchor="middle" dominantBaseline="central"
              className="fill-on-surface-variant" style={{ fontSize: '0.65rem' }}>
              actifs
            </text>
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
