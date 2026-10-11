import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Gauge, Timer, CheckCircle2, Star, Users, RefreshCw,
  TrendingUp, Clock, User, X, CalendarRange,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { toast } from 'sonner';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import DataGrid, { AvatarNameRenderer } from '../components/DataGrid';
import SearchableSelect from '../components/SearchableSelect';
import DateRangePicker from '../components/ui/date-range-picker';
import PageShell from '../components/PageShell';
import { KpiRow } from '../components/KpiRow';

const PERIODS = ['7 Jours', '1 Mois', '3 Mois', '6 Mois'];
const PERIOD_DAYS = { '7 Jours': 7, '1 Mois': 30, '3 Mois': 90, '6 Mois': 180 };

const ROW_HEIGHT = 60;
const HEADER_HEIGHT = 48;

const fmtH = (h) => (h == null ? '—' : `${h.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h`);
const fmtPct = (p) => (p == null ? '—' : `${p} %`);
const fmtCsat = (c) => (c == null ? '—' : `${c.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}/5`);
const fmtDate = (d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });

const ROLE_STYLES = {
  SUPERADMIN: { label: 'Super admin', cls: 'bg-purple-500/15 border-purple-500/30 text-purple-700 dark:text-purple-300' },
  ADMIN: { label: 'Admin', cls: 'bg-purple-500/15 border-purple-500/30 text-purple-700 dark:text-purple-300' },
  HOTLINE: { label: 'Hotline', cls: 'bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300' },
  TECHNICIAN: { label: 'Technicien', cls: 'bg-blue-500/15 border-blue-500/30 text-blue-700 dark:text-blue-300' },
};

function RoleBadge({ role }) {
  const style = ROLE_STYLES[role];
  if (!style) return <span className="text-on-surface-variant/40">—</span>;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-bold whitespace-nowrap ${style.cls}`}>
      {style.label}
    </span>
  );
}

function ChartCard({ icon: Icon, iconCls, title, subtitle, delay = 0, className = '', children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.16, 1, 0.3, 1] }}
      className={`rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm p-5 flex flex-col ${className}`}
    >
      <div className="flex items-start gap-3 mb-4">
        <div className={`p-2 rounded-xl shrink-0 ${iconCls}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-on-surface">{title}</h2>
          <p className="text-xs text-on-surface-variant mt-0.5">{subtitle}</p>
        </div>
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </motion.div>
  );
}

function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest shadow-lg px-3 py-2 text-xs">
      <p className="font-bold text-on-surface mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="flex items-center gap-2 text-on-surface-variant">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color || entry.fill }} />
          <span>{entry.name}</span>
          <span className="font-bold text-on-surface ml-auto tabular-nums">
            {formatter ? formatter(entry.value, entry.name) : entry.value}
          </span>
        </p>
      ))}
    </div>
  );
}

function EmptyChart({ label }) {
  return (
    <div className="flex h-64 items-center justify-center text-sm text-on-surface-variant/70">
      {label}
    </div>
  );
}

const numCell = (cls = 'text-on-surface') => (p) => (
  <span className={`block text-right text-sm font-bold tabular-nums ${cls}`}>{p.value ?? 0}</span>
);

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
    api.get('/users', { params: { onlyStaff: 'true', isActive: 'true', limit: 200 } }).then((res) => {
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

  const items = data.items || [];
  const totals = data.totals || {};

  const periodLabel = useMemo(() => {
    if (data?.period) return `${fmtDate(data.period.since)} → ${fmtDate(data.period.until)}`;
    return activePeriod || 'Période personnalisée';
  }, [data, activePeriod]);

  const chartData = useMemo(
    () => items
      .filter((t) => t.resolved > 0 && t.avgResolutionHours != null)
      .map((t) => ({ name: t.fullName.split(' ')[0], full: t.fullName, hours: t.avgResolutionHours })),
    [items]
  );

  const trendData = useMemo(
    () => (data.trend || []).map((d) => ({
      date: new Date(d.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
      'Créés': d.created,
      'Résolus': d.resolved,
    })),
    [data.trend]
  );

  const teamOptions = useMemo(() => [
    { label: 'Toutes les équipes', value: '' },
    ...teams.map((t) => ({ label: t.name, value: t.id })),
  ], [teams]);

  const techOptions = useMemo(() => [
    { label: 'Tout le personnel', value: '' },
    ...technicians.map((t) => ({
      label: t.fullName,
      value: t.id,
      sub: [ROLE_STYLES[t.role]?.label, t.email].filter(Boolean).join(' · '),
    })),
  ], [technicians]);

  const kpiCards = useMemo(() => ([
    ...(isTechnicianOnly
      ? [{ label: 'Reçus', value: items[0]?.assigned ?? 0, icon: User, color: 'text-orange-500' }]
      : [{ label: 'Membres actifs', value: totals.technicians ?? 0, icon: Users, color: 'text-orange-500' }]),
    { label: 'Résolus', value: totals.resolved ?? 0, sub: `${totals.open ?? 0} encore ouverts`, icon: CheckCircle2, color: 'text-emerald-500' },
    { label: 'Délai moyen', value: fmtH(totals.avgResolutionHours), icon: Timer, color: 'text-blue-500' },
    { label: 'SLA respecté', value: fmtPct(totals.slaCompliancePct), sub: `${totals.slaRespected ?? 0}/${totals.slaTotal ?? 0} éligibles`, icon: Clock, color: 'text-purple-500' },
    { label: 'CSAT moyen', value: fmtCsat(totals.csatAvg), icon: Star, color: 'text-amber-500' },
  ]).map((card) => ({ ...card, loading })), [isTechnicianOnly, items, totals, loading]);

  const gridHeight = Math.min(Math.max(items.length, 3), 14) * ROW_HEIGHT + HEADER_HEIGHT;

  return (
    <PageShell
      icon={Gauge}
      iconColor="text-orange-500"
      title={isTechnicianOnly ? 'Mes statistiques' : 'Performance des membres'}
      subtitle={
        isTechnicianOnly
          ? 'Vos volumes, délais, SLA, CSAT et temps passé.'
          : 'Chaque personne ayant traité un ticket : titulaire, co-affecté ou auteur de suivis.'
      }
      actions={
        <div className="flex items-center gap-2">
          <span className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-outline-variant/30 bg-surface-container text-[11px] font-semibold text-on-surface-variant">
            <CalendarRange className="w-3.5 h-3.5" />
            {periodLabel}
          </span>
          <button
            onClick={() => loadData()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-outline-variant/40 bg-surface-container text-xs font-bold text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
        </div>
      }
    >
      {/* ── Filtres ─────────────────────────────────────────────────────── */}
      {!isTechnicianOnly && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="rounded-2xl border border-outline-variant/20 bg-surface-container-low/40 p-3 sm:p-4 mb-5"
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-container border border-outline-variant/30">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  onClick={() => handlePeriodChange(p)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    activePeriod === p && !hasCustomDates
                      ? 'bg-gradient-to-r from-orange-400 via-amber-500 to-yellow-400 text-slate-950 shadow-md'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            <div className="w-px h-6 bg-outline-variant/30 shrink-0" />

            <DateRangePicker
              value={{
                from: dateFrom ? new Date(dateFrom) : null,
                to: dateTo ? new Date(dateTo) : null,
              }}
              onChange={({ from, to }) => {
                handleDateChange('from', from ? from.toISOString().slice(0, 10) : '');
                handleDateChange('to', to ? to.toISOString().slice(0, 10) : '');
              }}
              presets={false}
            />

            <div className="w-px h-6 bg-outline-variant/30 shrink-0" />

            <div className="min-w-[180px]">
              <SearchableSelect
                options={teamOptions}
                value={selectedTeamId}
                onChange={(v) => setSelectedTeamId(v)}
                placeholder="Équipe"
                searchPlaceholder="Rechercher une équipe…"
                className="text-xs"
              />
            </div>

            <div className="min-w-[220px]">
              <SearchableSelect
                options={techOptions}
                value={selectedTechId}
                onChange={(v) => setSelectedTechId(v)}
                placeholder="Membre"
                searchPlaceholder="Rechercher un membre…"
                subLabelKey="sub"
                className="text-xs"
              />
            </div>

            {activeFilterCount > 0 && (
              <button
                onClick={handleReset}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-primary hover:bg-primary/10 cursor-pointer transition-colors shrink-0"
              >
                <X className="w-3 h-3" />
                Effacer les filtres
              </button>
            )}
          </div>
        </motion.div>
      )}

      {/* ── KPIs ────────────────────────────────────────────────────────── */}
      <KpiRow cards={kpiCards} />

      {/* ── Graphiques ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 mb-5">
        {!isTechnicianOnly && (
          <ChartCard
            icon={Timer}
            iconCls="bg-blue-500/10 text-blue-500"
            title="Délai moyen par membre"
            subtitle="Heures entre création et résolution"
            className="xl:col-span-2"
          >
            {chartData.length === 0 ? (
              <EmptyChart label="Aucun ticket résolu sur la période." />
            ) : (
              <ResponsiveContainer width="100%" height={Math.min(Math.max(chartData.length * 42, 220), 380)}>
                <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 28, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="currentColor" opacity={0.08} />
                  <XAxis type="number" tick={{ fontSize: 11 }} unit=" h" stroke="currentColor" opacity={0.5} />
                  <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.7} />
                  <Tooltip
                    cursor={{ fill: 'currentColor', opacity: 0.05 }}
                    content={<ChartTooltip formatter={(v) => fmtH(v)} />}
                    labelFormatter={(label, payload) => payload?.[0]?.payload?.full || label}
                  />
                  <Bar dataKey="hours" name="Délai moyen" fill="#f59e0b" radius={[0, 8, 8, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        )}

        <ChartCard
          icon={TrendingUp}
          iconCls="bg-emerald-500/10 text-emerald-500"
          title="Créés vs résolus"
          subtitle="Activité quotidienne sur la période"
          delay={0.06}
          className={isTechnicianOnly ? 'col-span-1' : 'xl:col-span-3'}
        >
          {trendData.length === 0 ? (
            <EmptyChart label="Pas de données de tendance pour la période." />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
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
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                <Area type="monotone" dataKey="Créés" stroke="#3b82f6" strokeWidth={2} fill="url(#gCreated)" />
                <Area type="monotone" dataKey="Résolus" stroke="#10b981" strokeWidth={2} fill="url(#gResolved)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* ── Détail par membre ───────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
        className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm overflow-hidden"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-b border-outline-variant/20">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-orange-500/10">
              <Users className="w-4 h-4 text-orange-500" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-on-surface">Détail par membre</h2>
              <p className="text-xs text-on-surface-variant">
                {loading
                  ? 'Chargement…'
                  : `${items.length} membre(s) · ${totals.assigned ?? 0} reçus · ${totals.resolved ?? 0} résolus · ${totals.followups ?? 0} suivis saisis`}
              </p>
            </div>
          </div>
        </div>

        <DataGrid
          storageKey="technician-stats"
          columns={[
            ...(!isTechnicianOnly ? [
              {
                field: 'fullName',
                headerName: 'Membre',
                minWidth: 200,
                flex: 1.3,
                cellRenderer: AvatarNameRenderer,
              },
              { field: 'role', headerName: 'Rôle', width: 110, cellRenderer: (p) => <RoleBadge role={p.value} /> },
              { field: 'teamName', headerName: 'Équipe', width: 120, cellRenderer: (p) => <span className="text-sm text-on-surface-variant">{p.value || '—'}</span> },
            ] : []),
            { field: 'created', headerName: 'Créés', width: 100, headerClass: 'ag-right-aligned-header', cellRenderer: numCell('text-on-surface-variant') },
            { field: 'assigned', headerName: 'Reçus', width: 100, headerClass: 'ag-right-aligned-header', cellRenderer: numCell('text-on-surface') },
            { field: 'open', headerName: 'Ouverts', width: 100, headerClass: 'ag-right-aligned-header', cellRenderer: numCell('text-blue-500') },
            { field: 'resolved', headerName: 'Résolus', width: 100, headerClass: 'ag-right-aligned-header', cellRenderer: numCell('text-emerald-500') },
            { field: 'followups', headerName: 'Suivis', width: 100, headerClass: 'ag-right-aligned-header', cellRenderer: numCell('text-teal-500') },
            {
              field: 'avgResolutionHours',
              headerName: 'Délai moyen',
              width: 115,
              headerClass: 'ag-right-aligned-header',
              cellRenderer: (p) => (
                <span className="block text-right text-sm font-mono tabular-nums text-on-surface-variant">
                  {p.value != null ? `${p.value.toFixed(1)} h` : '—'}
                </span>
              ),
            },
            {
              field: 'avgFirstResponseHours',
              headerName: '1ère rép.',
              width: 105,
              headerClass: 'ag-right-aligned-header',
              cellRenderer: (p) => (
                <span className="block text-right text-sm font-mono tabular-nums text-on-surface-variant">
                  {p.value != null ? `${p.value.toFixed(1)} h` : '—'}
                </span>
              ),
            },
            {
              field: 'slaCompliancePct',
              headerName: 'SLA respecté',
              width: 130,
              headerClass: 'ag-right-aligned-header',
              cellRenderer: (p) => (p.value != null ? (
                <div className="flex items-center gap-2 justify-end">
                  <div className="w-16 h-2 rounded-full bg-surface-container-high overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${p.value}%`, backgroundColor: p.value >= 90 ? '#10b981' : p.value >= 70 ? '#f59e0b' : '#ef4444' }}
                    />
                  </div>
                  <span className="text-xs font-bold font-mono tabular-nums" style={{ color: p.value >= 90 ? '#10b981' : p.value >= 70 ? '#f59e0b' : '#ef4444' }}>
                    {p.value}%
                  </span>
                </div>
              ) : <span className="block text-right text-on-surface-variant/40">—</span>),
            },
            {
              field: 'csatAvg',
              headerName: 'CSAT',
              width: 100,
              headerClass: 'ag-right-aligned-header',
              cellRenderer: (p) => (p.value != null ? (
                <span className="flex items-center gap-1 justify-end">
                  <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                  <span className="text-sm font-bold tabular-nums">{p.value.toFixed(1)}</span>
                </span>
              ) : <span className="block text-right text-on-surface-variant/40">—</span>),
            },
            {
              field: 'loggedMinutes',
              headerName: 'Temps',
              width: 110,
              headerClass: 'ag-right-aligned-header',
              cellRenderer: (p) => {
                const total = p.value || 0;
                const h = Math.floor(total / 60);
                const m = total % 60;
                return (
                  <span className="block text-right text-sm font-mono tabular-nums text-on-surface-variant">
                    {h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`}
                  </span>
                );
              },
            },
          ]}
          rowData={items}
          loading={loading}
          pagination={false}
          headerHeight={HEADER_HEIGHT}
          rowHeight={ROW_HEIGHT}
          height={gridHeight}
          noRowsText="Aucune activité détectée sur la période sélectionnée (assignations, suivis, tickets saisis)."
        />
      </motion.div>
    </PageShell>
  );
}
