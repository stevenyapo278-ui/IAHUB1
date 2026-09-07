import { motion } from 'framer-motion';

export default function IntegrationsWidget({ integrations, config }) {
  const services = integrations ? [
    ...(integrations.apiConfigs || []).map((c) => ({ name: c.name, health: c.connected ? 'ok' : 'down' })),
    ...(integrations.aiProviders || []).map((p) => ({ name: p.label || p.name, health: p.connected ? 'ok' : 'down' })),
    ...(integrations.n8nWorkflows || []).slice(0, 4).map((w) => ({ name: w.name, health: w.lastStatus === 'success' ? 'ok' : w.lastStatus ? 'warn' : 'down' })),
  ].slice(0, 7) : [];

  if (!services.length) {
    return <p className="text-xs text-on-surface-variant italic text-center py-6">Aucune intégration configurée</p>;
  }

  return (
    <ul className="divide-y divide-outline-variant/20 h-full w-full">
      {services.map((s, i) => (
        <motion.li
          key={s.name}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: i * 0.04 }}
          className="flex items-center gap-3 py-2"
        >
          <span className={`w-2.5 h-2.5 shrink-0 rounded-full ${s.health === 'ok' ? 'bg-emerald-500' : s.health === 'warn' ? 'bg-amber-500' : 'bg-red-500'}`} />
          <span className="text-xs font-medium text-on-surface truncate flex-1">{s.name}</span>
          <span className={`text-[10px] font-bold uppercase tracking-wider shrink-0 ${s.health === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : s.health === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-red-500'}`}>
            {s.health === 'ok' ? 'OK' : s.health === 'warn' ? 'Dégradé' : 'Hors ligne'}
          </span>
        </motion.li>
      ))}
    </ul>
  );
}
