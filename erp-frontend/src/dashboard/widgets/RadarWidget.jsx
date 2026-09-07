import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Tooltip } from 'recharts';

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-3 py-2 rounded-xl shadow-xl text-xs border border-outline-variant/40"
      style={{ backgroundColor: 'var(--color-surface-container-lowest)', color: 'var(--color-on-surface)' }}>
      {payload.map((p, i) => (
        <p key={i} className="font-bold" style={{ color: p.color }}>{p.name}: {p.value}</p>
      ))}
    </div>
  );
}

export default function RadarWidget({ stats, config }) {
  const teams = stats?.byTeam || [];
  const maxTeamCount = Math.max(1, ...teams.map((t) => t.count));
  const totalTeamTickets = teams.reduce((s, t) => s + t.count, 0);

  const radarData = teams.slice(0, 6).map((t) => ({
    team: t.teamName || 'Non assignée',
    volume: Math.round((t.count / maxTeamCount) * 100),
    resolution: totalTeamTickets > 0 ? Math.round((t.count / totalTeamTickets) * 100) : 0,
  }));

  if (!radarData.length) {
    return <div className="h-full flex items-center justify-center text-xs text-on-surface-variant">Aucune donnée d'équipe</div>;
  }

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        <RadarChart data={radarData} outerRadius="75%">
          <PolarGrid stroke="var(--color-outline-variant)" />
          <PolarAngleAxis dataKey="team" tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }} />
          <PolarRadiusAxis tick={false} axisLine={false} />
          <Radar name="Volume relatif" dataKey="volume" stroke="var(--skin-primary)" fill="var(--skin-primary)" fillOpacity={0.35} />
          <Tooltip content={<ChartTooltip />} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
