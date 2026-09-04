import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Gauge, Timer, CheckCircle2, Star, Users, RefreshCw,
  TrendingUp, Clock, User, CalendarDays, X, ChevronDown,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { toast } from 'sonner';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import DataGrid from '../components/DataGrid';
import SearchableSelect from '../components/SearchableSelect';

const PERIODS = ['7 Jours', '1 Mois', '3 Mois', '6 Mois'];
const PERIOD_DAYS = { '7 Jours': 7, '1 Mois': 30, '3 Mois': 90, '6 Mois': 180 };

const fmtH = (h) => (h == null ? '—' : `${h.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h`);
const fmtPct = (p) => (p == null ? '—' : `${p} %`);
const fmtCsat = (c) => (c == null ? '—' : `${c.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}/5`);

const inputCls = 'px-3 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';
const dateInputCls = `${inputCls} py-2 text-xs w-[150px] cursor-pointer [color-scheme:light dark:color-scheme:dark]`;

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
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedTechId, setSelectedTechId] = useState('');
  const [teams, setTeams] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [data, setData] = useState({ items: [], totals: null, trend: [] });
  const [loading, setLoading] = useState(true);

  const hasCustomDates = dateFrom && dateTo;

  const buildParams = useCallback(() => {
    const params = {};
    if (hasCustomDates) {
      params.startDate = dateFrom;
      params.endDate = dateTo;
    } else {
      params.days = PERIOD_DAYS[activePeriod];
    }
    if (selectedTeamId) params.teamId = selectedTeamId;
    if (selectedTechId) params.assignedToId = selectedTechId;
    return params;
  }, [hasCustomDates, dateFrom, dateTo, activePeriod, selectedTeamId, selectedTechId]);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.get('/dashboard/technician-stats', { params: buildParams() });
      setData(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Échec du chargement des statistiques');
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (isTechnicianOnly) return;
    api.get('/teams').then((res) => {
      const list = Array.isArray(res.data) ? res.data : res.data?.teams || [];
      setTeams(list);
    }).catch(() => {});
    api.get('/users', { params: { role: 'TECHNICIAN', isActive: 'true', limit: 200 } }).then((res) => {
      const list = Array.isArray(res.data) ? res.data : res.data?.users || [];
      setTechnicians(list);
    }).catch(() => {});
  }, [isTechnicianOnly]);

  function handlePeriodChange(p) {
    setActivePeriod(p);
    setDateFrom('');
    setDateTo('');
  }

  function handleDateChange(which, val) {
    if (which === 'from') setDateFrom(val);
    else setDateTo(val);
    setActivePeriod('');
  }

  function handleReset() {
    setActivePeriod('1 Mois');
    setDateFrom('');
    setDateTo('');
    setSelectedTeamId('');
    setSelectedTechId('');
  }

  const activeFilterCount = [
    hasCustomDates,
    selectedTeamId,
    selectedTechId,
  ].filter(Boolean).length;

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

  const teamOptions = useMemo(() => [
    { label: 'Toutes les équipes', value: '' },
    ...teams.map((t) => ({ label: t.name, value: t.id })),
  ], [teams]);

  const techOptions = useMemo(() => [
    { label: 'Tous les techniciens', value: '' },
    ...technicians.map((t) => ({ label: t.fullName, value: t.id, sub: t.email })),
  ], [technicians]);

  return (
    <div className="flex flex-col h-full w-full min-w-0 gap-0">

      {/* Barre d'en-tête */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border/20 bg-surface shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-orange-500/10 rounded-xl shrink-0">
            <Gauge className="w-5 h-5 text-orange-600 dark:text-orange-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-display font-bold truncate text-on-surface">
              {isTechnicianOnly ? 'Mes Statistiques' : 'Performance Techniciens'}
            </h1>
            <p className="text-xs text-on-surface-variant truncate hidden sm:block">
              {isTechnicianOnly
                ? 'Vos statistiques individuelles : volumes, délais, SLA, CSAT, temps passé.'
                : 'Statistiques individuelles : volumes, délais, SLA, CSAT, temps passé.'}
            </p>
          </div>
        </div>

        <button
          onClick={loadData}
          disabled={loading}
          className="px-3 py-1.5 rounded-xl border border-outline-variant/30 bg-surface-container text-on-surface font-bold text-xs transition-all hover:bg-surface-container-high flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Actualiser</span>
        </button>
      </div>

      {/* Barre de filtres */}
      {!isTechnicianOnly && (
        <div className="flex items-center gap-2 px-4 sm:px-6 py-2.5 border-b border-border/10 bg-surface-container-low/50 shrink-0 flex-wrap">
          {/* Périodes prédéfinies */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-container border border-outline-variant/30">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => handlePeriodChange(p)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                  activePeriod === p && !hasCustomDates
                    ? 'bg-gradient-to-r from-orange-400 via-amber-500 to-yellow-400 text-slate-950 shadow-md'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Séparateur */}
          <div className="w-px h-6 bg-outline-variant/30 shrink-0" />

          {/* Dates custom */}
          <div className="flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5 text-on-surface-variant shrink-0" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => handleDateChange('from', e.target.value)}
              className={dateInputCls}
              placeholder="Du"
            />
            <span className="text-[10px] text-on-surface-variant font-medium">à</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => handleDateChange('to', e.target.value)}
              className={dateInputCls}
              placeholder="Au"
            />
          </div>

          {/* Séparateur */}
          <div className="w-px h-6 bg-outline-variant/30 shrink-0" />

          {/* Équipe */}
          <div className="flex items-center gap-1.5 min-w-[160px]">
            <SearchableSelect
              options={teamOptions}
              value={selectedTeamId}
              onChange={(v) => setSelectedTeamId(v)}
              placeholder="Équipe"
              searchPlaceholder="Rechercher une équipe…"
              className="text-xs"
            />
          </div>

          {/* Technicien */}
          <div className="flex items-center gap-1.5 min-w-[200px]">
            <SearchableSelect
              options={techOptions}
              value={selectedTechId}
              onChange={(v) => setSelectedTechId(v)}
              placeholder="Technicien"
              searchPlaceholder="Rechercher un technicien…"
              subLabelKey="sub"
              className="text-xs"
            />
          </div>

          {/* Reset */}
          {activeFilterCount > 0 && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-primary hover:bg-primary/10 cursor-pointer transition-colors shrink-0"
            >
              <X className="w-3 h-3" />
              Effacer
            </button>
          )}
        </div>
      )}

      {/* KPIs */}
      <div className={`grid gap-3 px-4 sm:px-6 py-3 shrink-0 ${isTechnicianOnly ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-5'}`}>
        {!isTechnicianOnly && <KpiCard label="Techniciens actifs" value={loading ? '…' : data.totals?.technicians ?? 0} icon={Users} color="#f97316" />}
        {isTechnicianOnly && <KpiCard label="Assignés" value={loading ? '…' : data.items?.[0]?.assigned ?? 0} icon={User} color="#f97316" />}
        <KpiCard label="Résolus" value={loading ? '…' : data.totals?.resolved ?? 0} sub={`${data.totals?.open ?? 0} ouverts`} icon={CheckCircle2} color="#10b981" />
        <KpiCard label="Délai moyen" value={loading ? '…' : fmtH(data.totals?.avgResolutionHours)} icon={Timer} color="#3b82f6" />
        <KpiCard label="SLA respecté" value={loading ? '…' : fmtPct(data.totals?.slaCompliancePct)} sub={`${data.totals?.slaRespected ?? 0}/${data.totals?.slaTotal ?? 0} éligibles`} icon={Clock} color="#8b5cf6" />
        <KpiCard label="CSAT moyen" value={loading ? '…' : fmtCsat(data.totals?.csatAvg)} icon={Star} color="#eab308" />
      </div>

      {/* Contenu principal */}
      <div className="flex-1 min-h-0 relative flex flex-col">
        <div className="flex-1 min-h-0 mx-4 sm:mx-6 lg:mx-8 mt-3.5 mb-4 flex flex-col gap-4">

          {/* Graphiques */}
          <div className="shrink-0 grid grid-cols-1 xl:grid-cols-5 gap-4">
            {!isTechnicianOnly && (
              <div className="xl:col-span-2 p-4 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <Timer className="w-4 h-4 text-blue-500" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-on-surface">Délai moyen / technicien</h2>
                </div>
                {chartData.length === 0 ? (
                  <EmptyStateInlineNoData label="Aucun ticket résolu sur la période." />
                ) : (
                  <ResponsiveContainer width="100%" height={Math.min(Math.max(200, chartData.length * 34), 360)}>
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

            <div className={`${isTechnicianOnly ? 'col-span-1' : 'xl:col-span-3'} p-4 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm`}>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-on-surface">Tickets créés vs résolus</h2>
              </div>
              {trendData.length === 0 ? (
                <EmptyStateInlineNoData label="Pas de données de tendance pour la période." />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
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
          <div className="flex-1 min-h-0 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest overflow-hidden flex flex-col">
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
