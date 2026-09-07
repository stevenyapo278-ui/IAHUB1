import { motion } from 'framer-motion';

function getWorkloadColor(assigned, max) {
  if (max === 0) return 'bg-primary';
  const ratio = assigned / max;
  if (ratio >= 0.8) return 'bg-red-500';
  if (ratio >= 0.55) return 'bg-amber-500';
  return 'bg-primary';
}

function getWorkloadStatus(assigned, max) {
  if (max === 0) return 'Disponible';
  const ratio = assigned / max;
  if (ratio >= 0.8) return 'Surchargé';
  if (ratio >= 0.55) return 'Charge modérée';
  return 'Disponible';
}

function UserAvatar({ name }) {
  const initials = (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0">
      {initials}
    </div>
  );
}

export default function TeamWorkloadWidget({ techPerformance, config }) {
  const data = (techPerformance || []).slice(0, 8);
  const maxAssigned = Math.max(...data.map(t => t.assigned || 0), 1);

  if (!data.length) {
    return <p className="text-xs text-on-surface-variant italic text-center py-6">Aucune donnée</p>;
  }

  return (
    <div className="h-full flex flex-col p-4">
      {/* Header */}
      <div className="mb-4">
        <p className="text-sm font-semibold text-on-surface-variant uppercase tracking-wide">
          Équipe
        </p>
        <p className="text-xs text-muted-foreground">
          Charge de travail par membre
        </p>
      </div>

      {/* Member cards grid */}
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2.5 auto-rows-min overflow-auto">
        {data.map((tech, i) => {
          const assigned = tech.assigned || 0;
          const open = tech.open || 0;
          const solved = tech.solved || 0;
          const pct = Math.round((assigned / maxAssigned) * 100);
          const barColor = getWorkloadColor(assigned, maxAssigned);
          const status = getWorkloadStatus(assigned, maxAssigned);

          return (
            <motion.div
              key={tech.id || i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.3 }}
              className="flex items-center gap-3 rounded-xl border border-outline-variant/30 bg-surface-container-low/50 p-3"
            >
              <UserAvatar name={tech.fullName} />

              <div className="min-w-0 flex-1">
                {/* Name + count */}
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-on-surface">
                    {tech.fullName || 'Inconnu'}
                  </p>
                  <span className="shrink-0 text-xs text-on-surface-variant">
                    {assigned} tâche{assigned > 1 ? 's' : ''}
                  </span>
                </div>

                {/* Status label */}
                <p className="truncate text-xs text-muted-foreground">
                  {status} — {open} ouvert{open > 1 ? 's' : ''}, {solved} résolu{solved > 1 ? 's' : ''}
                </p>

                {/* Progress bar */}
                <div className="mt-2 h-1.5 rounded-full overflow-hidden bg-surface-container-high">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, delay: 0.2 + i * 0.04, ease: [0.16, 1, 0.3, 1] }}
                    className={`h-full rounded-full ${barColor}`}
                  />
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
