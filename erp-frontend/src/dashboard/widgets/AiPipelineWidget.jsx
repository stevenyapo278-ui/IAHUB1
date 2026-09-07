import { motion } from 'framer-motion';

export default function AiPipelineWidget({ pendingAiDrafts, needsReview, pendingApprovals, stats, config }) {
  const total = stats?.total || 0;
  const aiTotal = (pendingAiDrafts?.length || 0) + (needsReview?.length || 0);
  const aiPct = total > 0 ? Math.min(100, Math.round((aiTotal / total) * 100)) : 0;

  const metrics = [
    { label: 'Brouillons', value: pendingAiDrafts?.length || 0, tone: 'primary' },
    { label: 'À valider', value: needsReview?.length || 0, tone: 'warning' },
    { label: 'En attente', value: pendingApprovals?.length || 0, tone: 'info' },
  ];

  return (
    <div className="space-y-4 h-full w-full">
      <div className="grid grid-cols-3 gap-3">
        {metrics.map((m) => (
          <div key={m.label} className="text-center">
            <p className="text-2xl font-bold text-on-surface">{m.value}</p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mt-0.5">{m.label}</p>
          </div>
        ))}
      </div>
      <div>
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-xs text-on-surface-variant">Charge IA vs humain</span>
          <span className="text-xs font-bold text-on-surface-variant">{aiPct}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden bg-surface-container">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${aiPct}%` }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="h-full rounded-full progress-gradient"
          />
        </div>
      </div>
    </div>
  );
}
