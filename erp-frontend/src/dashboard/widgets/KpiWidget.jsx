import { motion } from 'framer-motion';
import { TrendingUp, RefreshCw, AlertTriangle, Clock, CheckCircle2, Sparkles, Ticket } from 'lucide-react';

const ICONS = { RefreshCw, AlertTriangle, Clock, CheckCircle2, Sparkles, Ticket };

const TONE_STYLES = {
  primary: { bg: 'bg-primary/10', text: 'text-primary', border: 'border-primary/20', glow: 'hover:shadow-primary/10' },
  info: { bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/20', glow: 'hover:shadow-blue-500/10' },
  success: { bg: 'bg-emerald-500/10', text: 'text-emerald-500', border: 'border-emerald-500/20', glow: 'hover:shadow-emerald-500/10' },
  warning: { bg: 'bg-amber-500/10', text: 'text-amber-500', border: 'border-amber-500/20', glow: 'hover:shadow-amber-500/10' },
  danger: { bg: 'bg-red-500/10', text: 'text-red-500', border: 'border-red-500/20', glow: 'hover:shadow-red-500/10' },
};

function DeltaBadge({ value, suffix = '%' }) {
  if (value == null) return null;
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
      <TrendingUp className={`w-3 h-3 ${!up ? 'rotate-180' : ''}`} />
      {Math.abs(value)}{suffix}
    </span>
  );
}

function resolveKpiData(type, stats, slaAnalytics) {
  const byStatus = stats?.byStatus || [];
  const pendingCount = byStatus.find(s => s.status === 'PENDING')?.count ?? 0;
  const resolvedCount = stats?.resolved ?? 0;
  const resolutionRate = stats?.total > 0 ? Math.round((resolvedCount / stats.total) * 100) : 0;

  const map = {
    // Les libellés sont affichés par le header standard de WidgetRenderer
    kpi_open_tickets: { value: stats?.open || 0, icon: 'RefreshCw', tone: 'info' },
    kpi_sla_breach: { value: slaAnalytics?.totals?.breachRate || 0, suffix: '%', icon: 'AlertTriangle', tone: 'danger' },
    kpi_pending: { value: pendingCount, icon: 'Clock', tone: 'warning' },
    kpi_resolution_rate: { value: resolutionRate, suffix: '%', icon: 'CheckCircle2', tone: 'success' },
    kpi_ai_processed: { value: stats?.aiProcessed || 0, icon: 'Sparkles', tone: 'primary' },
    kpi_total_tickets: { value: stats?.total || 0, icon: 'Ticket', tone: 'primary' },
  };
  return map[type] || map.kpi_total_tickets;
}

export default function KpiWidget({ type, stats, slaAnalytics, config }) {
  const kpi = resolveKpiData(type, stats, slaAnalytics);
  const Icon = ICONS[kpi.icon] || Ticket;
  const t = TONE_STYLES[kpi.tone] || TONE_STYLES.primary;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`group h-full flex flex-col justify-center transition-all duration-300 ${t.glow}`}
    >
      <div className="p-2 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-3xl font-bold tracking-tight font-data text-foreground">{kpi.value}{kpi.suffix || ''}</p>
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${t.bg} ${t.text} border ${t.border} transition-transform group-hover:scale-110`}>
            <Icon className="h-5 w-5" />
          </span>
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="flex-1">
            <DeltaBadge value={config?.delta} />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
