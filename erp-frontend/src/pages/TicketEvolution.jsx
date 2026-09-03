import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import {
  TrendingUp, TrendingDown, RefreshCw, Eye, X,
  AlertTriangle, Clock, CheckCircle2, XCircle, BarChart3,
  SlidersHorizontal, Download,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { STATUS_CONFIG, PRIORITY_CONFIG, SOURCE_LABELS } from '../constants/tickets';

const inputCls = 'px-3 py-1.5 rounded-xl border border-outline-variant/60 bg-surface text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';
const selectCls = `${inputCls} appearance-none cursor-pointer`;

const STATUS_COLORS = {
  NEW: '#3b82f6', OPEN: '#f59e0b', PENDING: '#8b5cf6',
  SOLVED: '#10b981', CLOSED: '#6b7280', PLANNED: '#06b6d4',
};

const PRIORITY_COLORS = {
  P1: '#ef4444', P2: '#f97316', P3: '#3b82f6', P4: '#6b7280',
};

const PRESETS = [
  { label: '7j', days: 7 },
  { label: '30j', days: 30 },
  { label: '90j', days: 90 },
  { label: '12 mois', days: 365 },
];

function StatCard({ icon: Icon, label, value, color, sub, onClick }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className={`bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-4 transition-all ${onClick ? 'cursor-pointer hover:border-primary/30 hover:shadow-sm' : ''}`}>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-xl ${color || 'bg-primary/10 text-primary'}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <p className="text-2xl font-bold text-on-surface">{value ?? '—'}</p>
          <p className="text-xs text-on-surface/50">{label}</p>
          {sub && <p className="text-[10px] text-on-surface/30">{sub}</p>}
        </div>
      </div>
    </motion.div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-container-lowest border border-outline-variant/40 rounded-xl shadow-lg p-3 text-xs">
      <p className="font-bold text-on-surface mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-on-surface/60">{entry.name}:</span>
          <span className="font-semibold text-on-surface">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

export default function TicketEvolution() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [groupBy, setGroupBy] = useState('day');
  const [chartType, setChartType] = useState('area');

  const [teams, setTeams] = useState([]);
  const [teamFilter, setTeamFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');

  // Drill-down modal
  const [drillDown, setDrillDown] = useState(null);
  const [drillTickets, setDrillTickets] = useState([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillTotal, setDrillTotal] = useState(0);

  useEffect(() => {
    api.get('/teams').then(({ data }) => setTeams(data)).catch(() => {});
  }, []);

  function fetchData() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set('startDate', startDate);
    params.set('endDate', endDate);
    params.set('groupBy', groupBy);
    if (statusFilter) params.set('status', statusFilter);
    if (priorityFilter) params.set('priority', priorityFilter);
    if (teamFilter) params.set('teamId', teamFilter);
    if (sourceFilter) params.set('source', sourceFilter);

    api.get(`/dashboard/ticket-evolution?${params}`)
      .then(({ data }) => setData(data))
      .catch((err) => setError(err.response?.data?.error || 'Erreur chargement'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchData(); }, [startDate, endDate, statusFilter, priorityFilter, groupBy, teamFilter, sourceFilter]);

  const applyPreset = useCallback((days) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    setStartDate(start.toISOString().slice(0, 10));
    setEndDate(end.toISOString().slice(0, 10));
  }, []);

  const activeFilters = useMemo(() => {
    const f = [];
    if (statusFilter) f.push({ label: STATUS_CONFIG[statusFilter]?.label || statusFilter, clear: () => setStatusFilter('') });
    if (priorityFilter) f.push({ label: priorityFilter, clear: () => setPriorityFilter('') });
    if (teamFilter) {
      const t = teams.find(t => String(t.id) === String(teamFilter));
      f.push({ label: t?.name || teamFilter, clear: () => setTeamFilter('') });
    }
    if (sourceFilter) f.push({ label: SOURCE_LABELS[sourceFilter] || sourceFilter, clear: () => setSourceFilter('') });
    return f;
  }, [statusFilter, priorityFilter, teamFilter, sourceFilter, teams]);

  const buildDrillParams = useCallback(() => {
    const p = { startDate, endDate };
    if (statusFilter) p.status = statusFilter;
    if (priorityFilter) p.priority = priorityFilter;
    if (teamFilter) p.teamId = teamFilter;
    if (sourceFilter) p.source = sourceFilter;
    return p;
  }, [startDate, endDate, statusFilter, priorityFilter, teamFilter, sourceFilter]);

  const openDrillDown = useCallback((title, extraParams) => {
    const params = { ...buildDrillParams(), ...extraParams };
    setDrillDown({ title, params });
    setDrillLoading(true);
    setDrillTickets([]);
    const qs = new URLSearchParams({ page: '1', limit: '100', sortBy: 'createdAt', sortOrder: 'desc', ...params });
    api.get(`/tickets?${qs}`)
      .then(({ data }) => { setDrillTickets(data.items || []); setDrillTotal(data.total || 0); })
      .catch(() => setDrillTickets([]))
      .finally(() => setDrillLoading(false));
  }, [buildDrillParams]);

  const series = data?.series || [];
  const totals = data?.totals || {};
  const breakdown = data?.breakdown || {};

  const statusPieData = useMemo(() =>
    (breakdown.status || []).map((s) => ({
      name: STATUS_CONFIG[s.status]?.label || s.status,
      value: s.count,
      color: STATUS_COLORS[s.status] || '#6b7280',
    })), [breakdown.status]);

  const priorityBarData = useMemo(() =>
    (breakdown.priority || []).map((p) => ({
      name: p.priority,
      count: p.count,
      fill: PRIORITY_COLORS[p.priority] || '#6b7280',
    })), [breakdown.priority]);

  function exportCSV() {
    if (!series.length) return;
    const header = ['Période', 'Créés', 'Résolus', 'P1', 'P2', 'P3', 'P4', 'SLA breach'];
    const rows = series.map((s) => [s.label, s.created, s.resolved, s.p1, s.p2, s.p3, s.p4, s.slaBreached]);
    const csv = [header.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `evolution-tickets-${startDate}_${endDate}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 pb-8 space-y-5 min-h-screen">
      {/* ── HERO HEADER ──────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="p-6 sm:p-8 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-1.5">
              <div className="p-2 rounded-xl bg-primary/10">
                <TrendingUp className="w-5 h-5 text-primary" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-on-surface tracking-tight">Évolution des tickets</h1>
            </div>
            <p className="text-sm text-on-surface-variant">Suivi temporel des tickets — création, résolution, SLA</p>
          </div>
          <div className="flex items-center gap-2.5">
            <button onClick={exportCSV}
              className="px-3.5 py-2 rounded-xl border border-outline-variant/40 text-on-surface/60 hover:bg-surface-container-high text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors">
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
          </div>
        </div>
      </motion.div>

      {/* ── FILTER BAR (compact, always visible) ────────────────────────── */}
      <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Period presets */}
          <div className="flex items-center gap-1">
            {PRESETS.map((p) => (
              <button key={p.days} onClick={() => applyPreset(p.days)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer transition-all ${
                  startDate === new Date(Date.now() - p.days * 86400000).toISOString().slice(0, 10)
                    ? 'bg-primary/10 text-primary border border-primary/30'
                    : 'text-on-surface-variant hover:bg-surface-container-high border border-transparent'
                }`}>
                {p.label}
              </button>
            ))}
          </div>

          <div className="w-px h-6 bg-outline-variant/30" />

          {/* Date inputs */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-on-surface/40 uppercase">Du</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="bg-surface border border-outline-variant/60 rounded-lg px-2 py-1 text-[11px] text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/20 w-[120px]" />
            <span className="text-[10px] font-bold text-on-surface/40 uppercase">Au</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="bg-surface border border-outline-variant/60 rounded-lg px-2 py-1 text-[11px] text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/20 w-[120px]" />
          </div>

          <div className="w-px h-6 bg-outline-variant/30" />

          {/* Quick filters */}
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-surface border border-outline-variant/60 rounded-lg px-2 py-1 text-[11px] text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/20 appearance-none cursor-pointer">
            <option value="">Tous statuts</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}
            className="bg-surface border border-outline-variant/60 rounded-lg px-2 py-1 text-[11px] text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/20 appearance-none cursor-pointer">
            <option value="">Toutes priorités</option>
            {Object.keys(PRIORITY_CONFIG).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>

          {/* Advanced toggle */}
          <button onClick={() => setShowAdvanced(!showAdvanced)}
            className={`ml-auto flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer transition-all ${showAdvanced ? 'bg-primary/10 text-primary' : 'text-on-surface-variant hover:bg-surface-container-high'}`}>
            <SlidersHorizontal className="w-3 h-3" /> Avancé
          </button>

          {/* GroupBy + ChartType inline */}
          <div className="flex items-center gap-1">
            {[['day', 'J'], ['week', 'S'], ['month', 'M']].map(([v, l]) => (
              <button key={v} onClick={() => setGroupBy(v)}
                className={`w-7 h-7 rounded-lg text-[10px] font-bold cursor-pointer transition-all flex items-center justify-center ${groupBy === v ? 'bg-primary/10 text-primary border border-primary/30' : 'text-on-surface/40 hover:bg-surface-container-high border border-transparent'}`}>
                {l}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {[['area', '〜'], ['bar', '▮'], ['line', '〜']].map(([v, l], idx) => (
              <button key={v} onClick={() => setChartType(v)}
                className={`w-7 h-7 rounded-lg text-[10px] font-bold cursor-pointer transition-all flex items-center justify-center ${chartType === v ? 'bg-primary/10 text-primary border border-primary/30' : 'text-on-surface/40 hover:bg-surface-container-high border border-transparent'}`}
                title={['Aires', 'Barres', 'Lignes'][idx]}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* Advanced filters row */}
        <AnimatePresence>
          {showAdvanced && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap items-center gap-3 pt-3 mt-3 border-t border-outline-variant/15">
                <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}
                  className="bg-surface border border-outline-variant/60 rounded-lg px-2 py-1 text-[11px] text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/20 appearance-none cursor-pointer">
                  <option value="">Toutes équipes</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
                  className="bg-surface border border-outline-variant/60 rounded-lg px-2 py-1 text-[11px] text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/20 appearance-none cursor-pointer">
                  <option value="">Toutes sources</option>
                  {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Active filter chips */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-2 mt-2 border-t border-outline-variant/15">
            <span className="text-[10px] font-bold text-on-surface/40 uppercase mr-1">Filtres actifs :</span>
            {activeFilters.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 text-[10px] font-bold">
                {f.label}
                <button onClick={f.clear} className="hover:bg-primary/20 rounded-full p-0.5"><X className="w-2.5 h-2.5" /></button>
              </span>
            ))}
            <button onClick={() => { setStatusFilter(''); setPriorityFilter(''); setTeamFilter(''); setSourceFilter(''); }}
              className="text-[10px] text-on-surface/40 hover:text-on-surface underline ml-1">Tout effacer</button>
          </div>
        )}
      </div>

      {/* ── Loading / Error ──────────────────────────────────────────────── */}
      {loading && (
        <div className="text-center py-12 text-on-surface/40">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
          Chargement des données...
        </div>
      )}
      {error && (
        <div className="text-center py-12 text-red-500">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
          {error}
        </div>
      )}

      {/* ── Stats + Charts ──────────────────────────────────────────────── */}
      {data && !loading && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard icon={BarChart3} label="Créés" value={totals.created} color="bg-blue-500/10 text-blue-500"
              onClick={() => openDrillDown('Tickets créés', {})} />
            <StatCard icon={CheckCircle2} label="Résolus" value={totals.resolved} color="bg-emerald-500/10 text-emerald-500"
              onClick={() => openDrillDown('Tickets résolus', { status: 'SOLVED' })} />
            <StatCard icon={AlertTriangle} label="P1 critiques" value={totals.p1} color="bg-red-500/10 text-red-500"
              onClick={() => openDrillDown('Tickets P1 critiques', { priority: 'P1' })} />
            <StatCard icon={XCircle} label="SLA dépassés" value={totals.slaBreached} color="bg-orange-500/10 text-orange-500"
              onClick={() => openDrillDown('SLA dépassés', { due: 'overdue' })} />
            <StatCard icon={Clock} label="Jours résol." value={totals.avgResolutionDays} color="bg-violet-500/10 text-violet-500" sub="moyen" />
            <StatCard icon={TrendingUp} label="Taux réponse" value={`${totals.responseRate || 0}%`} color="bg-teal-500/10 text-teal-500" />
          </div>

          {/* Graphique principal : Créés vs Résolus */}
          {series.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-4">
              <h3 className="text-sm font-bold text-on-surface mb-3">Créés vs Résolus</h3>
              <ResponsiveContainer width="100%" height={300}>
                {chartType === 'area' ? (
                  <AreaChart data={series} margin={{ top: 4, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" opacity={0.2} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="created" name="Créés" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2} />
                    <Area type="monotone" dataKey="resolved" name="Résolus" stroke="#10b981" fill="#10b981" fillOpacity={0.15} strokeWidth={2} />
                  </AreaChart>
                ) : chartType === 'bar' ? (
                  <BarChart data={series} margin={{ top: 4, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" opacity={0.2} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="created" name="Créés" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="resolved" name="Résolus" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                ) : (
                  <LineChart data={series} margin={{ top: 4, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" opacity={0.2} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="created" name="Créés" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="resolved" name="Résolus" stroke="#10b981" strokeWidth={2} dot={false} />
                  </LineChart>
                )}
              </ResponsiveContainer>
            </motion.div>
          )}

          {/* Deuxième rangée : Priorités + SLA breach + Statut */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {priorityBarData.length > 0 && (
              <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-4">
                <h3 className="text-sm font-bold text-on-surface mb-3">Par priorité</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={priorityBarData} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }} width={30} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="count" name="Tickets" radius={[0, 4, 4, 0]}>
                      {priorityBarData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {series.length > 0 && (
              <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-4">
                <h3 className="text-sm font-bold text-on-surface mb-3">SLA dépassés</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={series} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" opacity={0.2} />
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--color-on-surface-variant)' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="slaBreached" name="SLA breach" fill="#f97316" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {statusPieData.length > 0 && (
              <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-4">
                <h3 className="text-sm font-bold text-on-surface mb-3">Par statut</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={statusPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={35} paddingAngle={2}>
                      {statusPieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* P1/P2/P3/P4 dans le temps */}
          {series.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-4">
              <h3 className="text-sm font-bold text-on-surface mb-3">Évolution par priorité</h3>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={series} margin={{ top: 4, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" opacity={0.2} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="p1" name="P1" stackId="1" stroke="#ef4444" fill="#ef4444" fillOpacity={0.3} />
                  <Area type="monotone" dataKey="p2" name="P2" stackId="1" stroke="#f97316" fill="#f97316" fillOpacity={0.3} />
                  <Area type="monotone" dataKey="p3" name="P3" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
                  <Area type="monotone" dataKey="p4" name="P4" stackId="1" stroke="#6b7280" fill="#6b7280" fillOpacity={0.3} />
                </AreaChart>
              </ResponsiveContainer>
            </motion.div>
          )}
        </>
      )}

      {/* ── Drill-down Modal ──────────────────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {drillDown && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setDrillDown(null)}
                className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 16 }}
                transition={{ type: 'spring', duration: 0.35, bounce: 0.12 }}
                className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col overflow-hidden"
              >
                <div className="flex items-center gap-3 px-5 py-4 border-b border-outline-variant/30">
                  <div className="p-1.5 rounded-lg bg-primary/10">
                    <Eye className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-on-surface">{drillDown.title}</h3>
                    <p className="text-[10px] text-on-surface-variant">{drillTotal} ticket(s) — filtré par les filtres actifs</p>
                  </div>
                  <motion.button
                    onClick={() => setDrillDown(null)}
                    whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }}
                    className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"
                  ><X className="w-4 h-4" /></motion.button>
                </div>
                <div className="overflow-y-auto flex-1">
                  {drillLoading ? (
                    <div className="flex items-center justify-center py-12 gap-2 text-on-surface-variant">
                      <RefreshCw className="w-5 h-5 animate-spin text-primary" />
                      <span className="text-sm">Chargement...</span>
                    </div>
                  ) : drillTickets.length === 0 ? (
                    <div className="text-center py-12 text-on-surface-variant text-sm">Aucun ticket trouvé</div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-outline-variant/20 bg-surface-container-low/40 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                          <th className="px-4 py-2.5 text-left">#</th>
                          <th className="px-4 py-2.5 text-left">Titre</th>
                          <th className="px-4 py-2.5 text-left">Statut</th>
                          <th className="px-4 py-2.5 text-left">Priorité</th>
                          <th className="px-4 py-2.5 text-left">Demandeur</th>
                          <th className="px-4 py-2.5 text-left">Équipe</th>
                          <th className="px-4 py-2.5 text-left">Créé le</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/10">
                        {drillTickets.map((t) => (
                          <tr key={t.id} className="hover:bg-surface-container-low/50 transition-colors">
                            <td className="px-4 py-2.5 font-mono font-bold text-on-surface">#{t.id}</td>
                            <td className="px-4 py-2.5 text-on-surface font-medium max-w-[220px] truncate">{t.title}</td>
                            <td className="px-4 py-2.5">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border ${STATUS_CONFIG[t.status]?.bg || ''}`}>
                                {STATUS_CONFIG[t.status]?.label || t.status}
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border ${PRIORITY_CONFIG[t.priority]?.bg || ''}`}>
                                {t.priority}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-on-surface-variant">{t.requester?.fullName || '—'}</td>
                            <td className="px-4 py-2.5 text-on-surface-variant">{t.team?.name || '—'}</td>
                            <td className="px-4 py-2.5 text-on-surface-variant font-mono">{new Date(t.createdAt).toLocaleDateString('fr-FR')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
