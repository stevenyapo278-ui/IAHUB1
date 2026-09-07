import { motion } from 'framer-motion';
import GaugeWidget from './GaugeWidget';

const PRIORITY_COLORS = { P1: '#ef4444', P2: '#f97316', P3: '#3b82f6', P4: '#10b981' };

export default function SlaStatusWidget({ slaAnalytics, config }) {
  if (!slaAnalytics) {
    return <p className="text-xs text-on-surface-variant italic text-center py-6">Données SLA indisponibles</p>;
  }

  return (
    <div className="space-y-4 h-full w-full">
      <div className="grid grid-cols-2 gap-4 justify-items-center">
        {['P1', 'P2', 'P3', 'P4'].map((p) => {
          const d = slaAnalytics.byPriority?.[p];
          if (!d) return null;
          const compliance = Math.max(0, 100 - (d.breachRate || 0));
          return (
            <motion.div
              key={p}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-1"
            >
              <GaugeWidget value={compliance} label={p} config={{ strokeWidth: 8 }} />
              <div className="text-center mt-1">
                <p className="text-[10px] text-on-surface-variant">
                  {d.breached ?? 0} breach(es) / {d.total} total
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-outline-variant/20">
              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Priorité</th>
              <th className="px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Total</th>
              <th className="px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Violation</th>
              <th className="px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Conformité</th>
            </tr>
          </thead>
          <tbody>
            {['P1', 'P2', 'P3', 'P4'].map((p) => {
              const d = slaAnalytics.byPriority?.[p];
              if (!d) return null;
              const compliance = Math.max(0, 100 - (d.breachRate || 0));
              return (
                <tr key={p} className="border-b border-outline-variant/10 last:border-0 hover:bg-primary/[0.03] transition-colors">
                  <td className="px-3 py-2"><span className="font-bold" style={{ color: PRIORITY_COLORS[p] }}>{p}</span></td>
                  <td className="px-3 py-2 text-center font-semibold text-on-surface">{d.total}</td>
                  <td className={`px-3 py-2 text-center font-bold ${(d.breachRate || 0) > 20 ? 'text-red-500' : (d.breachRate || 0) > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                    {d.breachRate || 0}%
                  </td>
                  <td className="px-3 py-2 text-center text-xs font-medium text-on-surface-variant">{Math.round(compliance)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
