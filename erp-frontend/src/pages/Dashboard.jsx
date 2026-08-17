import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import api from '../api/client';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { LayoutDashboard, Ticket, CheckCircle2, AlertTriangle, TrendingUp, Download, RefreshCw, Sparkles, ChevronRight, Zap, Bot, Layers, ArrowUpRight } from 'lucide-react';

/* ── Constantes ─────────────────────────────────────────────────────────────── */
const STATUS_LABELS = {
  NEW: 'Nouveau',
  OPEN: 'Ouvert',
  PENDING: 'En attente',
  SOLVED: 'Résolu',
  CLOSED: 'Fermé',
};

const PRIORITY_LABELS = {
  P1: 'P1 - Critique',
  P2: 'P2 - Haute',
  P3: 'P3 - Moyenne',
  P4: 'P4 - Basse',
};

const PIE_COLORS = ['#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE'];
const PERIODS = ['7 Jours', '1 Mois', '3 Mois', '6 Mois'];

/* ── Tooltip personnalisé ────────────────────────────────────────────────────── */
function EfferdTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-3 py-2 rounded-xl shadow-xl text-xs bg-surface-container-lowest border border-outline-variant/40 text-on-surface">
      <p className="font-semibold mb-1 text-on-surface-variant text-[11px]">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="font-bold text-on-surface">
          {p.value} tickets
        </p>
      ))}
    </div>
  );
}

/* ── Skeleton Loading ────────────────────────────────────────────────────────── */
function LoadingSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6 h-28 animate-pulse" />
        ))}
      </div>
      <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest h-64 animate-pulse" />
    </div>
  );
}

/* ── Section Card M3 ────────────────────────────────────────────────────────── */
function SectionCard({ title, icon, action, children, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={`rounded-2xl border border-outline-variant/30 bg-surface-container-lowest overflow-hidden shadow-sm ${className}`}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/20 bg-surface-container-low/40">
        <div className="flex items-center gap-2">
          {icon && (
            <span className="material-symbols-outlined text-[16px] text-on-surface-variant">
              {icon}
            </span>
          )}
          <h3 className="text-xs font-bold text-on-surface">
            {title}
          </h3>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </motion.div>
  );
}

/* ── Connection Dot ─────────────────────────────────────────────────────────── */
function ConnectionDot({ connected }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
  );
}

export default function Dashboard() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [integrations, setIntegrations] = useState(null);
  const [techPerformance, setTechPerformance] = useState([]);
  const [pendingAiDrafts, setPendingAiDrafts] = useState([]);
  const [needsReview, setNeedsReview] = useState([]);
  const [activityTrend, setActivityTrend] = useState([]);
  const [error, setError] = useState('');
  const [activePeriod, setActivePeriod] = useState('1 Mois');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [reportLoading, setReportLoading] = useState(false);
  const [slaAnalytics, setSlaAnalytics] = useState(null);

  function loadPendingAiDrafts() {
    api.get('/dashboard/pending-ai-drafts').then(({ data }) => setPendingAiDrafts(data)).catch(() => {});
  }
  function loadNeedsReview() {
    api.get('/dashboard/needs-human-review').then(({ data }) => setNeedsReview(data)).catch(() => {});
  }
  const PERIOD_DAYS = { '7 Jours': 7, '1 Mois': 30, '3 Mois': 90, '6 Mois': 180 };

  function loadAll() {
    let queryParams = '';
    if (customStartDate || customEndDate) {
      const params = new URLSearchParams();
      if (customStartDate) params.append('startDate', customStartDate);
      if (customEndDate) params.append('endDate', customEndDate);
      queryParams = '?' + params.toString();
    } else {
      const days = PERIOD_DAYS[activePeriod] || 30;
      queryParams = `?days=${days}`;
    }

    api.get(`/dashboard/stats${queryParams}`).then(({ data }) => setStats(data)).catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
    api.get('/dashboard/pending-approvals').then(({ data }) => setPendingApprovals(data)).catch(() => {});
    api.get('/dashboard/recent-activity').then(({ data }) => setRecentActivity(data)).catch(() => {});
    api.get('/dashboard/integrations').then(({ data }) => setIntegrations(data)).catch(() => {});
    api.get(`/dashboard/technician-performance${queryParams}`).then(({ data }) => setTechPerformance(data)).catch(() => {});
    const days = customStartDate || customEndDate ? (PERIOD_DAYS[activePeriod] || 30) : (PERIOD_DAYS[activePeriod] || 30);
    api.get(`/dashboard/sla-analytics?days=${days}`).then(({ data }) => setSlaAnalytics(data)).catch(() => {});
    loadPendingAiDrafts();
    loadNeedsReview();
  }

  useEffect(() => { loadAll(); }, [activePeriod, customStartDate, customEndDate]);

  async function handleDownloadReport() {
    setReportLoading(true);
    try {
      const days = PERIOD_DAYS[activePeriod] || 30;
      const res = await api.get(`/dashboard/report?days=${days}&format=pdf`, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `Rapport_ITSM_${activePeriod.replace(' ', '_')}.pdf`;
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
    } catch {
      setError('Erreur lors du téléchargement du rapport');
    } finally {
      setReportLoading(false);
    }
  }

  if (error) {
    return (
      <div className="m-6 p-4 rounded-xl flex flex-col items-center gap-3 text-center bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400">
        <span className="text-sm font-semibold">{error}</span>
        <button onClick={loadAll} className="px-4 py-1.5 rounded-lg text-xs font-semibold border border-current hover:opacity-80 transition-opacity">
          Réessayer
        </button>
      </div>
    );
  }
  if (!stats) return <LoadingSkeleton />;

  const statusData = stats.byStatus.map((s) => ({ name: STATUS_LABELS[s.status] || s.status, value: s.count }));
  const priorityData = stats.byPriority.map((p) => ({ name: PRIORITY_LABELS[p.priority] || p.priority, value: p.count }));
  const teamData = stats.byTeam.map((t) => ({ name: t.teamName || 'Non assigné', value: t.count }));
  const p1Count = priorityData.find((p) => p.name.startsWith('P1'))?.value ?? 0;
  const totalTeamTickets = teamData.reduce((s, t) => s + t.value, 0);

  const trendData = activityTrend.map((d, i) => ({ day: i + 1, date: d.date, tickets: d.tickets, resolved: d.resolved }));
  const sparkData = trendData.slice(-7);

  const resolvedCount = stats.byStatus.find(s => s.status === 'SOLVED')?.count ?? 0;
  const closedCount = stats.byStatus.find(s => s.status === 'CLOSED')?.count ?? 0;
  const resolvedTotal = resolvedCount + closedCount;
  const resolutionRate = stats.total > 0 ? Math.round((resolvedTotal / stats.total) * 100) : 0;
  const trendTicketsSum = trendData.reduce((s, d) => s + d.tickets, 0);
  const prevHalf = trendData.slice(0, Math.floor(trendData.length / 2)).reduce((s, d) => s + d.tickets, 0);
  const currHalf = trendData.slice(Math.floor(trendData.length / 2)).reduce((s, d) => s + d.tickets, 0);
  const globalTrendUp = currHalf >= prevHalf;

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 pb-8 space-y-6 min-h-screen">

      {/* HERO HEADER SEVEN-T */}
      <div className="p-6 sm:p-8 rounded-2xl sm:rounded-3xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-amber-500/10 rounded-xl">
                <LayoutDashboard className="w-6 h-6 text-amber-600 dark:text-amber-400" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-display font-bold truncate text-on-surface">Tableau de Bord Operations</h1>
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold uppercase tracking-wider animate-pulse border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Live Hub
              </span>
            </div>
            <p className="text-sm sm:text-base text-on-surface-variant font-medium">Vue d'ensemble analytique, tickets, SLA et métriques de performance en temps réel.</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Period selector */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-container border border-outline-variant/30">
              {PERIODS.map((p) => {
                const isActive = activePeriod === p && !customStartDate && !customEndDate;
                return (
                  <button
                    key={p}
                    onClick={() => {
                      setActivePeriod(p);
                      setCustomStartDate('');
                      setCustomEndDate('');
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      isActive
                        ? 'bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-400 text-slate-950 shadow-md'
                        : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleDownloadReport}
              disabled={reportLoading}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-400 text-slate-950 font-bold text-xs transition-all shadow-md shadow-amber-500/20 hover:brightness-110 flex items-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              {reportLoading ? 'Génération...' : 'Télécharger Rapport'}
            </motion.button>
          </div>
        </div>

        {/* Bento Stat Items SEVEN-T */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div onClick={() => navigate('/tickets')} className="p-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/40 flex flex-col items-start cursor-pointer hover:border-blue-500/50 transition-all group">
            <div className="p-2 rounded-xl mb-2 text-blue-600 dark:text-blue-400 bg-blue-500/10">
              <Ticket className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold text-on-surface leading-none mb-1">{stats.total}</p>
            <div className="flex items-center justify-between w-full">
              <p className="text-xs text-on-surface-variant uppercase font-black tracking-wider">Total Tickets</p>
              <ChevronRight className="w-4 h-4 text-on-surface-variant/50 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>

          <div onClick={() => navigate('/tickets?status=OPEN')} className="p-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/40 flex flex-col items-start cursor-pointer hover:border-indigo-500/50 transition-all group">
            <div className="p-2 rounded-xl mb-2 text-indigo-600 dark:text-indigo-400 bg-indigo-500/10">
              <RefreshCw className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold text-on-surface leading-none mb-1">{stats.open}</p>
            <div className="flex items-center justify-between w-full">
              <p className="text-xs text-on-surface-variant uppercase font-black tracking-wider">Tickets Ouverts</p>
              <ChevronRight className="w-4 h-4 text-on-surface-variant/50 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>

          <div onClick={() => navigate('/tickets?status=SOLVED')} className="p-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/40 flex flex-col items-start cursor-pointer hover:border-emerald-500/50 transition-all group">
            <div className="p-2 rounded-xl mb-2 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold text-on-surface leading-none mb-1">{resolutionRate}%</p>
            <div className="flex items-center justify-between w-full">
              <p className="text-xs text-on-surface-variant uppercase font-black tracking-wider">Résolution ({resolvedTotal})</p>
              <ChevronRight className="w-4 h-4 text-on-surface-variant/50 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>

          <div onClick={() => navigate('/tickets?priority=P1')} className="p-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/40 flex flex-col items-start cursor-pointer hover:border-red-500/50 transition-all group">
            <div className={`p-2 rounded-xl mb-2 ${p1Count > 0 ? 'text-red-600 dark:text-red-400 bg-red-500/10 animate-pulse' : 'text-slate-500 bg-slate-500/10'}`}>
              <AlertTriangle className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold text-on-surface leading-none mb-1">{p1Count}</p>
            <div className="flex items-center justify-between w-full">
              <p className="text-xs text-on-surface-variant uppercase font-black tracking-wider">Critiques P1</p>
              <ChevronRight className="w-4 h-4 text-on-surface-variant/50 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>
        </div>
      </div>

      {/* RANGÉE 2 — Performance IA & Actions Rapides */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SectionCard title="Répartition par équipe" icon="pie_chart">
          <div className="flex items-center gap-4">
            <div className="shrink-0">
              <ResponsiveContainer width={100} height={100}>
                <PieChart>
                  <Pie
                    data={teamData.length > 0 ? teamData : [{ name: 'Aucune', value: 1 }]}
                    cx="50%" cy="50%" innerRadius={30} outerRadius={45} paddingAngle={3}
                    dataKey="value" stroke="none" animationDuration={700}
                  >
                    {(teamData.length > 0 ? teamData : [{ name: 'Aucune', value: 1 }]).map((entry, index) => (
                      <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <p className="text-center text-[10px] font-bold text-on-surface-variant mt-0.5">
                {totalTeamTickets} tickets
              </p>
            </div>

            <div className="flex-1 space-y-2 min-w-0">
              {teamData.slice(0, 4).map((t, i) => (
                <div key={t.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-xs font-semibold text-on-surface truncate">{t.name}</span>
                  </div>
                  <span className="text-xs font-bold text-on-surface ml-2 shrink-0">{t.value}</span>
                </div>
              ))}
              {teamData.length === 0 && (
                <p className="text-xs italic text-on-surface-variant">Aucune équipe</p>
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Performance IA" icon="smart_toy">
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Brouillons', value: pendingAiDrafts.length },
                { label: 'À valider', value: needsReview.length },
                { label: 'Approbation', value: pendingApprovals.length },
              ].map((m) => (
                <div key={m.label}>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">{m.label}</p>
                  <p className="text-xl font-bold leading-tight mt-0.5 text-on-surface">{m.value}</p>
                </div>
              ))}
            </div>
            <div>
              <div className="flex justify-between items-center mb-1">
                <p className="text-[11px] font-medium text-on-surface-variant">Charge IA vs humain</p>
                <p className="text-[11px] font-bold text-on-surface-variant">
                  {stats.total > 0 ? `${Math.round(((pendingAiDrafts.length + needsReview.length) / Math.max(stats.total, 1)) * 100)}% IA` : '0%'}
                </p>
              </div>
              <div className="h-2 rounded-full overflow-hidden bg-surface-container border border-outline-variant/30">
                <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full" style={{ width: `${Math.min(100, Math.round(((pendingAiDrafts.length + needsReview.length) / Math.max(stats.total, 1)) * 100))}%` }} />
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Accès Rapides" icon="bolt">
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Inbox Email', path: '/inbox', icon: 'mail' },
              { label: 'Brouillons IA', path: '/email-drafts', icon: 'edit_note' },
              { label: 'Base Connaissances', path: '/knowledge-base', icon: 'menu_book' },
              { label: 'NOC Supervision', path: '/supervision', icon: 'monitor' },
            ].map(item => (
              <button key={item.label} onClick={() => navigate(item.path)}
                className="flex items-center gap-2 p-2.5 rounded-xl border border-outline-variant/30 bg-surface-container-low/40 hover:bg-surface-container transition-all text-left group"
              >
                <span className="material-symbols-outlined text-[18px] text-primary">{item.icon}</span>
                <span className="text-xs font-semibold text-on-surface group-hover:text-primary transition-colors">{item.label}</span>
              </button>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* Pilotage SLA */}
      {slaAnalytics && ['SUPERADMIN', 'ADMIN', 'TECHNICIAN', 'HOTLINE'].includes(user?.role) && (
        <SectionCard
          title={`Pilotage SLA (${slaAnalytics.days} jours)`}
          icon="timer"
          action={
            <button
              onClick={handleDownloadReport}
              disabled={reportLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-[11px] font-bold hover:bg-primary/20 transition-all disabled:opacity-50 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[14px]">picture_as_pdf</span>
              {reportLoading ? 'Génération…' : 'Télécharger le rapport PDF'}
            </button>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Rate de violation', value: `${slaAnalytics.totals.breachRate}%`, sub: `${slaAnalytics.totals.breached} ticket(s) en retard` },
                { label: 'CSAT moyen', value: slaAnalytics.csat.average != null ? `${slaAnalytics.csat.average}/5` : '—', sub: `${slaAnalytics.csat.rated} notation(s)` },
                { label: 'En retard', value: slaAnalytics.overdue.length, sub: 'ouverts hors SLResol' },
              ].map((m) => (
                <div key={m.label} className="rounded-xl border border-outline-variant/30 bg-surface-container-low/40 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">{m.label}</p>
                  <p className="text-2xl font-bold leading-tight mt-1 text-on-surface">{m.value}</p>
                  <p className="text-[10px] text-on-surface-variant mt-0.5">{m.sub}</p>
                </div>
              ))}
            </div>

            {/* Tableau par priorité */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-outline-variant/30 text-[10px] uppercase tracking-wider text-on-surface-variant">
                    <th className="py-2 pr-3 font-bold">Priorité</th>
                    <th className="py-2 pr-3 font-bold">Total</th>
                    <th className="py-2 pr-3 font-bold">Résolus</th>
                    <th className="py-2 pr-3 font-bold">Taux violation</th>
                    <th className="py-2 pr-3 font-bold">Résolution moy.</th>
                    <th className="py-2 pr-3 font-bold">1re réponse moy.</th>
                  </tr>
                </thead>
                <tbody>
                  {['P1', 'P2', 'P3', 'P4'].map((p) => {
                    const s = slaAnalytics.byPriority[p];
                    return (
                      <tr key={p} className="border-b border-outline-variant/15">
                        <td className={`py-2 pr-3 font-black ${p === 'P1' ? 'text-red-600 dark:text-red-400' : p === 'P2' ? 'text-orange-600 dark:text-orange-400' : 'text-on-surface'}`}>{p}</td>
                        <td className="py-2 pr-3 font-semibold text-on-surface">{s.total}</td>
                        <td className="py-2 pr-3 text-on-surface-variant">{s.resolved}</td>
                        <td className="py-2 pr-3">
                          <span className={`inline-flex items-center gap-1.5 font-bold ${s.breachRate > 20 ? 'text-red-600 dark:text-red-400' : s.breachRate > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-current" />
                            {s.breachRate}%
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-on-surface-variant">{s.avgResolutionHours != null ? `${s.avgResolutionHours} h` : '—'}</td>
                        <td className="py-2 pr-3 text-on-surface-variant">{s.avgFirstResponseHours != null ? `${s.avgFirstResponseHours} h` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Tickets ouverts en retard */}
            {slaAnalytics.overdue.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5">
                  Tickets ouverts échéance dépassée
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {slaAnalytics.overdue.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => navigate(`/tickets/${t.id}`)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400 text-[10px] font-bold hover:bg-red-500/10 transition-colors cursor-pointer"
                    >
                      #{t.id}
                      <span className="max-w-[120px] truncate font-medium">{t.title}</span>
                      <span className="text-[9px] text-on-surface-variant font-semibold">{t.priority}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SectionCard>
      )}

    </div>
  );
}
