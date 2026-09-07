import { motion } from 'framer-motion';

const TECH_COLOR_CLASSES = ['bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-purple-500', 'bg-cyan-500', 'bg-rose-500', 'bg-indigo-500', 'bg-teal-500'];

function UserAvatar({ name, size = 'md' }) {
  const initials = (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const sizeClass = size === 'sm' ? 'w-7 h-7 text-[10px]' : 'w-9 h-9 text-xs';
  return (
    <div className={`${sizeClass} rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold shrink-0`}>
      {initials}
    </div>
  );
}

export default function TechTableWidget({ techPerformance, config }) {
  const data = (techPerformance || []).slice(0, 8);

  if (!data.length) {
    return <p className="text-xs text-on-surface-variant italic text-center py-6">Aucune donnée</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-outline-variant/20">
            <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Technicien</th>
            <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Assignés</th>
            <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Ouverts</th>
            <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Résolus</th>
            <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Taux</th>
          </tr>
        </thead>
        <tbody>
          {data.map((t, i) => {
            const assigned = t.assigned || 0;
            const solved = t.solved || 0;
            const rate = assigned > 0 ? Math.round((solved / assigned) * 100) : 0;
            return (
              <motion.tr
                key={t.id || t.fullName || i}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.03 }}
                className="border-b border-outline-variant/10 last:border-0 hover:bg-primary/[0.03] transition-colors"
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-full ${TECH_COLOR_CLASSES[i % TECH_COLOR_CLASSES.length]} flex items-center justify-center text-white text-[10px] font-bold shrink-0`}>
                      {(t.fullName || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <span className="text-xs font-medium text-on-surface truncate">{t.fullName || 'Inconnu'}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-center text-xs font-bold text-on-surface">{assigned}</td>
                <td className="px-4 py-2.5 text-center text-xs font-medium text-on-surface-variant">{t.open || 0}</td>
                <td className="px-4 py-2.5 text-center text-xs font-medium text-emerald-600 dark:text-emerald-400">{solved}</td>
                <td className={`px-4 py-2.5 text-center text-xs font-bold ${rate >= 70 ? 'text-emerald-600 dark:text-emerald-400' : rate >= 40 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500'}`}>{rate}%</td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
