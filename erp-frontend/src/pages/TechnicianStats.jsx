import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Gauge, Timer, CheckCircle2, Star, Users, RefreshCw,
  TrendingUp, Clock, AlertTriangle, User,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { staggerContainer, staggerItem } from '../utils/animations';
import { toast } from 'sonner';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import EmptyState from '../components/EmptyState';
import DataGrid from '../components/DataGrid';

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
  const { user } = useAuth();
  const isTechnicianOnly = user?.role === 'TECHNICIAN';
  const [activePeriod, setActivePeriod] = useState('1 Mois');
  const [data, setData] = useState({ items: [], totals: null, trend: [] });
  const [loading, setLoading] = useState(true);


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

  const sortedItems = data.items || [];

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



  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 pb-8 space-y-6 min-h-screen"
    >

      {/* En-tête */}
      <div className="p-6 sm:p-8 rounded-2xl sm:rounded-3xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-orange-500/10 rounded-xl">
                <Gauge className="w-6 h-6 text-orange-600 dark:text-orange-400" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-display font-bold truncate text-on-surface">
                {isTechnicianOnly ? 'Mes Statistiques' : 'Performance Techniciens'}
              </h1>
            </div>
            <p className="text-sm sm:text-base text-on-surface-variant font-medium">
              {isTechnicianOnly
                ? 'Vos statistiques individuelles : volumes, délais de résolution, respect des SLA, satisfaction et temps passé.'
                : 'Statistiques individuelles : volumes, délais de résolution, respect des SLA, satisfaction et temps passé.'}
            </p>
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
        <div className={`grid gap-4 mt-6 ${isTechnicianOnly ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-5'}`}>
          {!isTechnicianOnly && <KpiCard label="Techniciens actifs" value={loading ? '…' : data.totals?.technicians ?? 0} icon={Users} color="#f97316" />}
          {isTechnicianOnly && <KpiCard label="Assignés" value={loading ? '…' : data.items?.[0]?.assigned ?? 0} icon={User} color="#f97316" />}
          <KpiCard label="Tickets résolus" value={loading ? '…' : data.totals?.resolved ?? 0} sub={`${data.totals?.open ?? 0} encore ouverts`} icon={CheckCircle2} color="#10b981" />
          <KpiCard label="Délai moyen résolution" value={loading ? '…' : fmtH(data.totals?.avgResolutionHours)} icon={Timer} color="#3b82f6" />
          <KpiCard label="SLA respecté" value={loading ? '…' : fmtPct(data.totals?.slaCompliancePct)} sub={`${data.totals?.slaRespected ?? 0}/${data.totals?.slaTotal ?? 0} tickets éligibles`} icon={Clock} color="#8b5cf6" />
          <KpiCard label="CSAT moyen" value={loading ? '…' : fmtCsat(data.totals?.csatAvg)} icon={Star} color="#eab308" />
        </div>
      </div>

      {/* Graphiques */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {!isTechnicianOnly && (
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
        )}

        <div className={`${isTechnicianOnly ? 'col-span-1' : 'xl:col-span-3'} p-5 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm`}>
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

      {/* Tableau détaillé AG Grid */}
      <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm overflow-hidden">
        <DataGrid
          columns={[
            ...(!isTechnicianOnly ? [
              { field: 'fullName', headerName: 'Technicien', flex: 1.5, minWidth: 160, cellRenderer: (p) => <span className="font-semibold text-sm text-on-surface">{p.value}</span> },
              { field: 'teamName', headerName: 'Équipe', width: 130, cellRenderer: (p) => <span className="text-xs text-on-surface-variant">{p.value || '—'}</span> },
            ] : []),
            { field: 'assigned', headerName: 'Assignés', width: 90, cellRenderer: (p) => <span className="text-right block font-bold tabular-nums text-on-surface">{p.value}</span> },
            { field: 'open', headerName: 'Ouverts', width: 90, cellRenderer: (p) => <span className="text-right block font-bold tabular-nums text-blue-500">{p.value}</span> },
            { field: 'resolved', headerName: 'Résolus', width: 90, cellRenderer: (p) => <span className="text-right block font-bold tabular-nums text-emerald-500">{p.value}</span> },
            { field: 'avgResolutionHours', headerName: 'Délai moyen', width: 110, cellRenderer: (p) => <span className="text-right block font-mono text-xs tabular-nums text-on-surface-variant">{p.value != null ? `${p.value.toFixed(1)}h` : '—'}</span> },
            { field: 'avgFirstResponseHours', headerName: '1ère rép.', width: 100, cellRenderer: (p) => <span className="text-right block font-mono text-xs tabular-nums text-on-surface-variant">{p.value != null ? `${p.value.toFixed(1)}h` : '—'}</span> },
            { field: 'slaCompliancePct', headerName: 'SLA respecté', width: 110, cellRenderer: (p) => p.value != null ? (
              <div className="flex items-center gap-2 justify-end">
                <div className="w-16 h-1.5 rounded-full bg-surface-container-high overflow-hidden"><div className="h-full rounded-full" style={{ width: `${p.value}%`, backgroundColor: p.value >= 90 ? '#10b981' : p.value >= 70 ? '#f59e0b' : '#ef4444' }} /></div>
                <span className="text-xs font-mono tabular-nums" style={{ color: p.value >= 90 ? '#10b981' : p.value >= 70 ? '#f59e0b' : '#ef4444' }}>{p.value}%</span>
              </div>
            ) : <span className="text-right block text-on-surface-variant/40">—</span> },
            { field: 'csatAvg', headerName: 'CSAT', width: 80, cellRenderer: (p) => p.value != null ? (
              <span className="flex items-center gap-1 justify-end"><Star className="w-3 h-3 text-amber-400 fill-amber-400" /><span className="text-xs font-bold tabular-nums">{p.value.toFixed(1)}</span></span>
            ) : <span className="text-right block text-on-surface-variant/40">—</span> },
            { field: 'loggedMinutes', headerName: 'Temps loggé', width: 100, cellRenderer: (p) => {
              const h = Math.floor((p.value || 0) / 60); const m = (p.value || 0) % 60;
              return <span className="text-right block text-xs font-mono tabular-nums text-on-surface-variant">{h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`}</span>;
            } },
          ]}
          rowData={sortedItems}
          loading={loading}
          pagination={false}
          headerHeight={44}
          rowHeight={44}
          noRowsText="Aucune activité technicien détectée sur la période sélectionnée."
        />
      </div>
    </motion.div>
  );
}

function EmptyStateInlineNoData({ label }) {
  return (
    <div className="flex items-center justify-center h-56 text-sm text-on-surface-variant">
      {label}
    </div>
  );
}
