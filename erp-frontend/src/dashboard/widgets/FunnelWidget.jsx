import { motion } from 'framer-motion';

const STATUS_LABELS = { NEW: 'Nouveau', OPEN: 'Ouvert', PENDING: 'En attente', SOLVED: 'Résolu', CLOSED: 'Fermé' };
const FUNNEL_ORDER = ['NEW', 'OPEN', 'PENDING', 'SOLVED', 'CLOSED'];

export default function FunnelWidget({ stats, config }) {
  const byStatus = stats?.byStatus || [];
  const funnelData = FUNNEL_ORDER
    .map((s) => ({ name: STATUS_LABELS[s] || s, value: byStatus.find((x) => x.status === s)?.count || 0 }))
    .filter((d) => d.value > 0);
  const funnelMax = Math.max(1, ...funnelData.map((d) => d.value));

  if (!funnelData.length) {
    return <p className="h-full text-xs text-on-surface-variant italic text-center py-4">Aucun ticket</p>;
  }

  return (
    <div className="space-y-3 h-full w-full">
      {funnelData.map((d) => (
        <div key={d.name}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-on-surface">{d.name}</span>
            <span className="text-xs font-bold text-on-surface-variant">{d.value}</span>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden bg-surface-container">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(4, Math.round((d.value / funnelMax) * 100))}%` }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="h-full rounded-full"
              style={{ background: 'linear-gradient(90deg, var(--skin-primary), color-mix(in srgb, var(--skin-primary) 55%, transparent))' }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
