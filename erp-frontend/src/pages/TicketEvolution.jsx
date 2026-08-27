import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Calendar, Filter, RefreshCw,
  AlertTriangle, Clock, CheckCircle2, XCircle, BarChart3,
  SlidersHorizontal, ChevronDown, ChevronUp, Download,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { STATUS_CONFIG, PRIORITY_CONFIG } from '../constants/tickets';

const inputCls = 'px-3 py-1.5 rounded-xl border border-outline-variant/60 bg-surface text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';
const selectCls = `${inputCls} appearance-none cursor-pointer`;

const STATUS_COLORS = {
  NEW: '#3b82f6', OPEN: '#f59e0b', PENDING: '#8b5cf6',
  SOLVED: '#10b981', CLOSED: '#6b7280', PLANNED: '#06b6d4',
};

const PRIORITY_COLORS = {
  P1: '#ef4444', P2: '#f97316', P3: '#3b82f6', P4: '#6b7280',
};

function StatCard({ icon: Icon, label, value, color, sub }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-4">
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
  const [showFilters, setShowFilters] = useState(false);

  // Filtres
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [groupBy, setGroupBy] = useState('day');
  const [chartType, setChartType] = useState('area'); // area | bar | line

  // Lists pour filtres
  const [teams, setTeams] = useState([]);
  const [teamFilter, setTeamFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');

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

  const series = data?.series || [];
  const totals = data?.totals || {};
  const breakdown = data?.breakdown || {};

  // Données pour les graphiques de répartition
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
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-on-surface flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-primary" /> Évolution des tickets
          </h1>
          <p className="text-sm text-on-surface/50 mt-1">
            Suivi temporel des tickets — création, résolution, SLA
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCSV}
            className="px-3 py-2 rounded-xl border border-outline-variant/40 text-on-surface/60 hover:bg-surface-container-high text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors">
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button onClick={() => setShowFilters(!showFilters)}
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${showFilters ? 'bg-primary/10 text-primary border border-primary/30' : 'border border-outline-variant/40 text-on-surface/60 hover:bg-surface-container-high'}`}>
            <SlidersHorizontal className="w-3.5 h-3.5" /> Filtres
            {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Filtres */}
      {showFilters && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-on-surface/40 uppercase mb-1">Du</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={selectCls} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-on-surface/40 uppercase mb-1">Au</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={selectCls} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-on-surface/40 uppercase mb-1">Statut</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls}>
                <option value="">Tous</option>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-on-surface/40 uppercase mb-1">Priorité</label>
              <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className={selectCls}>
                <option value="">Toutes</option>
                {Object.keys(PRIORITY_CONFIG).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-on-surface/40 uppercase mb-1">Équipe</label>
              <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className={selectCls}>
                <option value="">Toutes</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-on-surface/40 uppercase mb-1">Source</label>
              <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className={selectCls}>
                <option value="">Toutes</option>
                <option value="Email">Email</option>
                <option value="Manual">Manuel</option>
                <option value="API">API</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-[10px] font-semibold text-on-surface/40 uppercase">Grouper par</label>
            {[['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois']].map(([v, l]) => (
              <button key={v} onClick={() => setGroupBy(v)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-all ${groupBy === v ? 'bg-primary/10 text-primary border border-primary/30' : 'border border-outline-variant/30 text-on-surface/50 hover:bg-surface-container-high'}`}>
                {l}
              </button>
            ))}
            <span className="ml-auto" />
            <label className="text-[10px] font-semibold text-on-surface/40 uppercase">Graphique</label>
            {[['area', 'Aires'], ['bar', 'Barres'], ['line', 'Lignes']].map(([v, l]) => (
              <button key={v} onClick={() => setChartType(v)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-all ${chartType === v ? 'bg-primary/10 text-primary border border-primary/30' : 'border border-outline-variant/30 text-on-surface/50 hover:bg-surface-container-high'}`}>
                {l}
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Loading / Error */}
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

      {/* Stats globales */}
      {data && !loading && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard icon={BarChart3} label="Créés" value={totals.created} color="bg-blue-500/10 text-blue-500" />
            <StatCard icon={CheckCircle2} label="Résolus" value={totals.resolved} color="bg-emerald-500/10 text-emerald-500" />
            <StatCard icon={AlertTriangle} label="P1 critiques" value={totals.p1} color="bg-red-500/10 text-red-500" />
            <StatCard icon={XCircle} label="SLA dépassés" value={totals.slaBreached} color="bg-orange-500/10 text-orange-500" />
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

          {/* Deuxième rangée : Priorités + SLA breach */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Répartition par priorité (barres) */}
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

            {/* SLA breach dans le temps */}
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

            {/* Répartition par statut (pie) */}
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
    </div>
  );
}
