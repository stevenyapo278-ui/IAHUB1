import { BarChart, Bar, Cell, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

const PRIORITY_COLORS = { P1: '#ef4444', P2: '#f97316', P3: '#3b82f6', P4: '#10b981' };

const PIE_COLORS = ['var(--skin-primary)', '#3b82f6', '#f97316', '#10b981', '#8b5cf6', '#ec4899'];

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

function PriorityBars({ stats }) {
  const data = ['P1', 'P2', 'P3', 'P4'].map((p) => ({
    name: p,
    value: stats?.byPriority?.find((x) => x.priority === p)?.count || 0,
  }));

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        <BarChart data={data} barCategoryGap="25%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-on-surface-variant)', fontWeight: 700 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--color-on-surface-variant)' }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-surface-container)' }} />
          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.name} fill={PRIORITY_COLORS[d.name] || 'var(--skin-primary)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function GroupedBars({ stats }) {
  const priorities = ['P1', 'P2', 'P3', 'P4'];

  // Croisement équipe × priorité fourni par /dashboard/stats (byTeamPriority)
  const byTeam = new Map();
  for (const r of stats?.byTeamPriority || []) {
    if (!byTeam.has(r.teamName)) {
      byTeam.set(r.teamName, { name: r.teamName, P1: 0, P2: 0, P3: 0, P4: 0, _total: 0 });
    }
    const row = byTeam.get(r.teamName);
    if (priorities.includes(r.priority)) row[r.priority] = r.count;
    row._total += r.count;
  }

  // Toutes les lignes : top 6 équipes + barre « Autres » pour le reste
  const teams = [...byTeam.values()].sort((a, b) => b._total - a._total);
  let data = teams.slice(0, 6).map(({ _total, ...row }) => row);
  if (teams.length > 6) {
    const autres = { name: 'Autres', P1: 0, P2: 0, P3: 0, P4: 0 };
    for (const t of teams.slice(6)) {
      for (const p of priorities) autres[p] += t[p];
    }
    data = [...data, autres];
  }

  if (!data.length) {
    return <div className="h-full flex items-center justify-center text-xs text-on-surface-variant">Aucune donnée</div>;
  }

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        <BarChart data={data} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--color-on-surface-variant)' }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-surface-container)' }} />
          {priorities.map((p) => (
            <Bar key={p} dataKey={p} fill={PRIORITY_COLORS[p]} radius={[4, 4, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function BarWidget({ stats, type, config }) {
  if (type === 'chart_bar_grouped') {
    return <GroupedBars stats={stats} />;
  }
  return <PriorityBars stats={stats} />;
}
