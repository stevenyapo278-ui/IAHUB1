import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Gauge, Timer, CheckCircle2, Star, Users, RefreshCw,
  TrendingUp, ArrowUpDown, Clock, AlertTriangle,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { toast } from 'sonner';
import api from '../api/client';
import EmptyState from '../components/EmptyState';

const PERIODS = ['7 Jours', '1 Mois', '3 Mois', '6 Mois'];
const PERIOD_DAYS = { '7 Jours': 7, '1 Mois': 30, '3 Mois': 90, '6 Mois': 180 };

const fmtH = (h) => (h == null ? '—' : `${h.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h`);
const fmtPct = (p) => (p == null ? '—' : `${p} %`);
const fmtCsat = (c) => (c == null ? '—' : `${c.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}/5`);

function slaColor(pct) {
  if (pct == null) return 'text-on-surface-variant';
  if (pct >= 90) return 'text-emerald-600 dark:text-emerald-400';
  if (pct >= 70) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function KpiCard({ label, value, sub, icon: Icon, color }) {
  return (
    <div className="p-4 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm flex flex-col items-start">
      <div className="p-2 rounded-xl mb-2" style={{ backgroundColor: `${color}15`, color }}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-2xl font-bold text-on-surface leading-none mb-1 tabular-nums">{value}</p>
      <p className="text-[11px] text-on-surface-variant uppercase font-black tracking-wider">{label}</p>
      {sub && <p className="text-[11px] text-on-surface-variant mt-1">{sub}</p>}
    </div>
  );
}

export default function TechnicianStats() {
  const [activePeriod, setActivePeriod] = useState('1 Mois');
  const [data, setData] = useState({ items: [], totals: null, trend: [] });
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState({ key: 'resolved', dir: 'desc' });

  const periodDays = PERIOD_DAYS[activePeriod];

  // Tous les setState sont post-await / dans des callbacks : jamais d'appel synchrone
  // dans le corps de l'effet, ce qui évite les rendus en cascade.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/dashboard/technician-stats', { params: { days: periodDays } });
        if (!cancelled) setData(res.data);
      } catch (err) {
        if (!cancelled) toast.error(err.response?.data?.error || 'Échec du chargement des statistiques');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [periodDays]);

  async function handleRefresh() {
    setLoading(true);
    try {
      const res = await api.get('/dashboard/technician-stats', { params: { days: PERIOD_DAYS[activePeriod] } });
      setData(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Échec du chargement des statistiques');
    } finally {
      setLoading(false);
    }
  }

  const sortedItems = useMemo(() => {
    const arr = [...(data.items || [])];
    arr.sort((a, b) => {
      const va = a[sort.key]; const vb = b[sort.key];
      const na = va == null ? -1 : va; const nb = vb == null ? -1 : vb;
      if (typeof na === 'string') return sort.dir === 'asc' ? na.localeCompare(nb) : nb.localeCompare(na);
      return sort.dir === 'asc' ? na - nb : nb - na;
    });
    return arr;
  }, [data.items, sort]);

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  }

  const chartData = useMemo(
    () => sortedItems
      .filter((t) => t.resolved > 0 && t.avgResolutionHours != null)
      .map((t) => ({ name: t.fullName.split(' ')[0], full: t.fullName, hours: t.avgResolutionHours })),
    [sortedItems]
  );

  const trendData = useMemo(
    () => (data.trend || []).map((d) => ({
      date: new Date(d.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
      Créés: d.created, Résolus: d.resolved,
    })),
    [data.trend]
  );

  const columns = [
    { key: 'fullName', label: 'Technicien' },
    { key: 'teamName', label: 'Équipe' },
    { key: 'assigned', label: 'Assignés', numeric: true },
    { key: 'open', label: 'Ouverts', numeric: true },
    { key: 'resolved', label: 'Résolus', numeric: true },
    { key: 'avgResolutionHours', label: 'Délai moyen', numeric: true },
    { key: 'avgFirstResponseHours', label: '1ère rép.', numeric: true },
    { key: 'slaCompliancePct', label: 'SLA respecté', numeric: true },
    { key: 'csatAvg', label: 'CSAT', numeric: true },
    { key: 'loggedMinutes', label: 'Temps loggé', numeric: true },
  ];

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 pb-8 space-y-6 min-h-screen">

      {/* En-tête */}
      <div className="p-6 sm:p-8 rounded-2xl sm:rounded-3xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-orange-500/10 rounded-xl">
                <Gauge className="w-6 h-6 text-orange-600 dark:text-orange-400" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-display font-bold truncate text-on-surface">Performance Techniciens</h1>
            </div>
            <p className="text-sm sm:text-base text-on-surface-variant font-medium">Statistiques individuelles : volumes, délais de résolution, respect des SLA, satisfaction et temps passé.</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-container border border-outline-variant/30">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  onClick={() => setActivePeriod(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    activePeriod === p
                      ? 'bg-gradient-to-r from-orange-400 via-amber-500 to-yellow-400 text-slate-950 shadow-md'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleRefresh}
              disabled={loading}
              className="px-4 py-2 rounded-xl border border-outline-variant/30 bg-surface-container text-on-surface font-bold text-xs transition-all hover:bg-surface-container-high flex items-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Actualiser
            </motion.button>
          </div>
        </div>

        {/* KPIs globaux */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mt-6">
          <KpiCard label="Techniciens actifs" value={loading ? '…' : data.totals?.technicians ?? 0} icon={Users} color="#f97316" />
          <KpiCard label="Tickets résolus" value={loading ? '…' : data.totals?.resolved ?? 0} sub={`${data.totals?.open ?? 0} encore ouverts`} icon={CheckCircle2} color="#10b981" />
          <KpiCard label="Délai moyen résolution" value={loading ? '…' : fmtH(data.totals?.avgResolutionHours)} icon={Timer} color="#3b82f6" />
          <KpiCard label="SLA respecté" value={loading ? '…' : fmtPct(data.totals?.slaCompliancePct)} sub={`${data.totals?.slaRespected ?? 0}/${data.totals?.slaTotal ?? 0} tickets éligibles`} icon={Clock} color="#8b5cf6" />
          <KpiCard label="CSAT moyen" value={loading ? '…' : fmtCsat(data.totals?.csatAvg)} icon={Star} color="#eab308" />
        </div>
      </div>

      {/* Graphiques */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <div className="xl:col-span-2 p-5 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Timer className="w-4 h-4 text-blue-500" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-on-surface">Délai moyen de résolution par technicien</h2>
          </div>
          {chartData.length === 0 ? (
            <EmptyStateInlineNoData label="Aucun ticket résolu sur la période." />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(220, chartData.length * 34)}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="currentColor" opacity={0.08} />
                <XAxis type="number" tick={{ fontSize: 11 }} unit=" h" stroke="currentColor" opacity={0.5} />
                <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.7} />
                <Tooltip
                  formatter={(v) => [fmtH(v), 'Délai moyen']}
                  labelFormatter={(label, payload) => payload?.[0]?.payload?.full || label}
                  contentStyle={{ borderRadius: 12, border: '1px solid rgba(120,120,120,0.25)', fontSize: 12 }}
                />
                <Bar dataKey="hours" fill="#f59e0b" radius={[0, 8, 8, 0]} barSize={16} name="Délai moyen" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="xl:col-span-3 p-5 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-on-surface">Tickets créés vs résolus</h2>
          </div>
          {trendData.length === 0 ? (
            <EmptyStateInlineNoData label="Pas de données de tendance pour la période." />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={trendData} margin={{ top: 4, right: 12, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="gCreated" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gResolved" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.08} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" stroke="currentColor" opacity={0.5} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.5} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid rgba(120,120,120,0.25)', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="Créés" stroke="#3b82f6" strokeWidth={2} fill="url(#gCreated)" />
                <Area type="monotone" dataKey="Résolus" stroke="#10b981" strokeWidth={2} fill="url(#gResolved)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Tableau détaillé */}
      <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-outline-variant/30 bg-surface-container/60">
                {columns.map((c) => (
                  <th key={c.key} className={`px-4 py-3 text-[11px] font-black uppercase tracking-wider text-on-surface-variant whitespace-nowrap ${c.numeric ? 'text-right' : 'text-left'}`}>
                    <button onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-on-surface cursor-pointer">
                      {c.label}
                      <ArrowUpDown className={`w-3 h-3 ${sort.key === c.key ? 'text-orange-500' : 'opacity-40'}`} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-outline-variant/20">
                    {columns.map((c) => (
                      <td key={c.key} className="px-4 py-3.5">
                        <span className="block h-3.5 w-full max-w-[80px] rounded bg-surface-container-high animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : sortedItems.length === 0 ? (
                <tr><td colSpan={columns.length}><EmptyState icon="users" title="Aucun technicien" description="Aucune activité technicien détectée sur la période sélectionnée." /></td></tr>
              ) : (
                sortedItems.map((t, i) => (
                  <motion.tr
                    key={t.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.02, 0.3) }}
                    className="border-b border-outline-variant/20 last:border-b-0 hover:bg-surface-container/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <p className="font-semibold text-on-surface whitespace-nowrap">{t.fullName}</p>
                      <p className="text-xs text-on-surface-variant">{t.email}</p>
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap">{t.teamName || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-on-surface">{t.assigned}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {t.open > 0 ? (
                        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
                          {t.open}
                          {t.breaches > 0 && <AlertTriangle className="w-3.5 h-3.5 text-red-500" title={`${t.breaches} dépassement(s) SLA`} />}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400 font-semibold">{t.resolved}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-on-surface">{fmtH(t.avgResolutionHours)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-on-surface-variant">{fmtH(t.avgFirstResponseHours)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums font-semibold ${slaColor(t.slaCompliancePct)}`}>
                      {t.slaTotal ? fmtPct(t.slaCompliancePct) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-on-surface">{fmtCsat(t.csatAvg)}{t.csatCount > 0 && <span className="text-xs text-on-surface-variant"> ({t.csatCount})</span>}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-on-surface-variant">{t.loggedMinutes > 0 ? fmtH(Math.round(t.loggedMinutes / 6) / 10) : '—'}</td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function EmptyStateInlineNoData({ label }) {
  return (
    <div className="flex items-center justify-center h-56 text-sm text-on-surface-variant">
      {label}
    </div>
  );
}
