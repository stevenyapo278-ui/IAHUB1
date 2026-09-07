import { motion } from 'framer-motion';

const PIE_COLORS = ['var(--skin-primary)', '#3b82f6', '#f97316', '#10b981', '#8b5cf6', '#ec4899'];

export default function TeamBreakdownWidget({ stats, config }) {
  const teamData = (stats?.byTeam || []).map(t => ({ name: t.teamName || 'Non assigné', value: t.count }));
  const total = teamData.reduce((s, t) => s + t.value, 0);

  if (!teamData.length) {
    return <p className="text-xs text-on-surface-variant italic">Aucune donnée d'équipe</p>;
  }

  return (
    <div className="space-y-2.5 h-full w-full">
      {teamData.slice(0, 6).map((t, i) => {
        const pct = total > 0 ? Math.round((t.value / total) * 100) : 0;
        return (
          <div key={t.name}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-on-surface truncate">{t.name}</span>
              <span className="text-xs font-bold text-on-surface-variant ml-2 shrink-0">
                {t.value} <span className="font-normal">({pct}%)</span>
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden bg-surface-container">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, delay: 0.3 + i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                className="h-full rounded-full"
                style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
