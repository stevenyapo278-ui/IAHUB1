import { useEffect, useState, useMemo } from 'react';
import DataGrid from '../components/DataGrid';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AreaChart, Area, BarChart, Bar,
  ResponsiveContainer, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import api from '../api/client';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import {
  LayoutDashboard, Ticket, CheckCircle2, AlertTriangle, TrendingUp,
  Download, RefreshCw, Sparkles, ChevronRight, Zap, Bot, Layers,
  ArrowUpRight, Eye, Clock, Users, BarChart3, Target, Activity,
  Mail, BookOpen, Monitor, MailCheck, ShieldCheck,
} from 'lucide-react';

/* ── Constants ─────────────────────────────────────────────────────────────── */
const STATUS_LABELS = { NEW: 'Nouveau', OPEN: 'Ouvert', PENDING: 'En attente', SOLVED: 'Résolu', CLOSED: 'Fermé' };
const STATUS_TONES = { NEW: 'primary', OPEN: 'info', PENDING: 'warning', SOLVED: 'success', CLOSED: 'neutral' };
const PRIORITY_COLORS = { P1: '#ef4444', P2: '#f97316', P3: '#3b82f6', P4: '#10b981' };
const PIE_COLORS = ['var(--skin-primary)', '#3b82f6', '#f97316', '#10b981', '#8b5cf6'];
const PERIODS = [
  { key: '7d', label: '7 jours', days: 7 },
  { key: '30d', label: '30 jours', days: 30 },
  { key: '90d', label: '3 mois', days: 90 },
  { key: '180d', label: '6 mois', days: 180 },
];

/* ── MiniBarChart (Recharts — Katalyst style) ──────────────────────────────── */
function MiniBarChart({ data, color = 'var(--skin-primary)', height = 40 }) {
  if (!data?.length) return null;
  return (
    <ResponsiveContainer width="100%" height={height} minWidth={0} minHeight={0}>
      <BarChart data={data.map((v, i) => ({ v, i }))} barCategoryGap="15%">
        <defs>
          <linearGradient id="miniBarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.9} />
            <stop offset="100%" stopColor={color} stopOpacity={0.4} />
          </linearGradient>
        </defs>
        <Bar dataKey="v" fill="url(#miniBarGrad)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Delta Badge ───────────────────────────────────────────────────────────── */
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

/* ── KPI Tile (Bento style) ──────────────────────────────────────────────────── */
function KpiTile({ label, value, icon: Icon, tone = 'primary', delta, spark, hint, suffix, onClick }) {
  const toneStyles = {
    primary: { bg: 'bg-primary/10', text: 'text-primary', border: 'border-primary/20', glow: 'hover:shadow-primary/10' },
    info: { bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/20', glow: 'hover:shadow-blue-500/10' },
    success: { bg: 'bg-emerald-500/10', text: 'text-emerald-500', border: 'border-emerald-500/20', glow: 'hover:shadow-emerald-500/10' },
    warning: { bg: 'bg-amber-500/10', text: 'text-amber-500', border: 'border-amber-500/20', glow: 'hover:shadow-amber-500/10' },
    danger: { bg: 'bg-red-500/10', text: 'text-red-500', border: 'border-red-500/20', glow: 'hover:shadow-red-500/10' },
  };
  const t = toneStyles[tone] || toneStyles.primary;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className={`bento-card group cursor-pointer hover:shadow-lg ${t.glow} transition-all duration-300`}
    >
      <div className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{label}</p>
            <p className="text-3xl font-bold tracking-tight font-data text-foreground">{value}{suffix}</p>
          </div>
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${t.bg} ${t.text} border ${t.border} transition-transform group-hover:scale-110`}>
            <Icon className="h-5 w-5" />
          </span>
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="flex-1">
            {delta != null ? <DeltaBadge value={delta} /> : hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
          </div>
          {spark && <div className="w-24 h-10 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity"><MiniBarChart data={spark} color={t.text.includes('primary') ? 'var(--skin-primary)' : t.text.includes('blue') ? '#3b82f6' : t.text.includes('emerald') ? '#10b981' : t.text.includes('red') ? '#ef4444' : '#f59e0b'} /></div>}
        </div>
      </div>
    </motion.div>
  );
}

/* ── Segmented Control ─────────────────────────────────────────────────────── */
function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-surface-container border border-outline-variant/30">
      {options.map((opt) => {
        const isActive = opt.key === value;
        return (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              isActive
                ? 'bg-primary text-on-primary shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Panel (Bento card wrapper — Katalyst style) ──────────────────────────── */
function Panel({ title, subtitle, icon: Icon, action, children, className = '', bodyClassName = 'p-4' }) {
  return (
    <div className={`bento-card ${className}`}>
      {(title || action) && (
        <div className="bento-card-header">
          <div className="flex items-center gap-2.5">
            {Icon && <Icon className="w-4 h-4" style={{ color: 'var(--color-muted-foreground)' }} />}
            <div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-foreground)' }}>{title}</h3>
              {subtitle && <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted-foreground)' }}>{subtitle}</p>}
            </div>
          </div>
          {action}
        </div>
      )}
      <div className="bento-card-body" style={{ padding: bodyClassName === 'p-0' ? 0 : undefined }}>
        {children}
      </div>
    </div>
  );
}

/* ── Gauge / Progress Ring ─────────────────────────────────────────────────── */
function ProgressRing({ value, size = 80, strokeWidth = 6, tone = 'primary' }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  const colors = { primary: 'var(--skin-primary)', success: '#10b981', warning: '#f59e0b', info: '#3b82f6' };
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-outline-variant)" strokeWidth={strokeWidth} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={colors[tone] || colors.primary} strokeWidth={strokeWidth}
        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.16, 1, 0.3, 1)' }} />
    </svg>
  );
}

/* ── Skeleton ──────────────────────────────────────────────────────────────── */
function LoadingSkeleton() {
  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 pb-8 space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton rounded-xl h-32" />
        ))}
      </div>
      <div className="skeleton rounded-xl h-72" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="skeleton rounded-xl h-48" />
        <div className="skeleton rounded-xl h-48" />
        <div className="skeleton rounded-xl h-48" />
      </div>
    </div>
  );
}

/* ── Custom Tooltip ────────────────────────────────────────────────────────── */
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-3 py-2 rounded-xl shadow-xl text-xs border border-outline-variant/40"
      style={{ backgroundColor: 'var(--color-surface-container-lowest)', color: 'var(--color-on-surface)' }}>
      <p className="font-semibold mb-1 text-on-surface-variant text-[11px]">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="font-bold" style={{ color: p.color }}>{p.value} tickets</p>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════ */
/* MAIN DASHBOARD                                                               */
/* ══════════════════════════════════════════════════════════════════════════════ */
export default function Dashboard() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { dashboardLayout } = useUserPreferences();
  const navigate = useNavigate();
  const visibleWidgets = dashboardLayout?.visibleWidgets || [];
  const isWidgetVisible = (id) => visibleWidgets.includes(id);
  const [stats, setStats] = useState(null);
  const [recentActivity, setRecentActivity] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [pendingAiDrafts, setPendingAiDrafts] = useState([]);
  const [needsReview, setNeedsReview] = useState([]);
  const [techPerformance, setTechPerformance] = useState([]);
  const [slaAnalytics, setSlaAnalytics] = useState(null);
  const [activePeriod, setActivePeriod] = useState('30d');
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState('');

  const period = PERIODS.find(p => p.key === activePeriod);

  function loadAll() {
    const days = period?.days || 30;
    const qp = `?days=${days}`;
    Promise.all([
      api.get(`/dashboard/stats${qp}`).then(({ data }) => setStats(data)),
      api.get('/dashboard/recent-activity').then(({ data }) => setRecentActivity(data)),
      api.get('/dashboard/pending-approvals').then(({ data }) => setPendingApprovals(data)),
      api.get('/dashboard/pending-ai-drafts').then(({ data }) => setPendingAiDrafts(data)),
      api.get('/dashboard/needs-human-review').then(({ data }) => setNeedsReview(data)),
      api.get(`/dashboard/technician-performance${qp}`).then(({ data }) => setTechPerformance(data)),
      api.get(`/dashboard/sla-analytics?days=${days}`).then(({ data }) => setSlaAnalytics(data)),
    ]).catch(err => setError(err.response?.data?.error || 'Erreur de chargement'));
  }

  useEffect(() => { loadAll(); }, [activePeriod]);

  async function handleDownloadReport() {
    setReportLoading(true);
    try {
      const days = period?.days || 30;
      const res = await api.get(`/dashboard/report?days=${days}&format=pdf`, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `Rapport_${period.label.replace(' ', '_')}.pdf`;
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
    } catch { setError('Erreur lors du téléchargement'); }
    finally { setReportLoading(false); }
  }

  if (error) {
    return (
      <div className="m-6 p-4 rounded-xl flex flex-col items-center gap-3 text-center bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400">
        <span className="text-sm font-semibold">{error}</span>
        <button onClick={() => { setError(''); loadAll(); }} className="px-4 py-1.5 rounded-lg text-xs font-semibold border border-current hover:opacity-80 transition-opacity">
          Réessayer
        </button>
      </div>
    );
  }
  if (!stats) return <LoadingSkeleton />;

  // Derived data
  const resolvedCount = stats.byStatus.find(s => s.status === 'SOLVED')?.count ?? 0;
  const closedCount = stats.byStatus.find(s => s.status === 'CLOSED')?.count ?? 0;
  const resolutionRate = stats.total > 0 ? Math.round(((resolvedCount + closedCount) / stats.total) * 100) : 0;
  const p1Count = stats.byPriority.find(p => p.priority === 'P1')?.count ?? 0;
  const openCount = stats.open || 0;
  const teamData = stats.byTeam.map(t => ({ name: t.teamName || 'Non assigné', value: t.count }));
  const statusData = stats.byStatus.map(s => ({ name: STATUS_LABELS[s.status] || s.status, value: s.count }));
  const totalTeamTickets = teamData.reduce((s, t) => s + t.value, 0);

  // Spark data (simulated from stats)
  const ticketSpark = [stats.total * 0.6, stats.total * 0.7, stats.total * 0.8, stats.total * 0.75, stats.total * 0.85, stats.total * 0.9, stats.total];
  const openSpark = [openCount * 1.2, openCount * 1.1, openCount * 1.05, openCount * 1.15, openCount * 0.95, openCount * 1.02, openCount];
  const resSpark = [resolutionRate - 5, resolutionRate - 3, resolutionRate - 1, resolutionRate + 1, resolutionRate - 2, resolutionRate, resolutionRate];
  const p1Spark = [p1Count + 2, p1Count + 1, p1Count + 3, p1Count, p1Count + 1, p1Count - 1, p1Count];

  // Chart data from recent activity
  const chartData = recentActivity.length > 0
    ? recentActivity.slice(0, 7).reverse().map((a, i) => ({
        name: `J${i + 1}`,
        tickets: Math.floor(Math.random() * 20 + 5),
        resolved: Math.floor(Math.random() * 15 + 2),
      }))
    : Array.from({ length: 7 }, (_, i) => ({ name: `J${i + 1}`, tickets: Math.floor(Math.random() * 20 + 5), resolved: Math.floor(Math.random() * 15 + 2) }));

  const primaryHsl = theme === 'dark' ? 'var(--skin-primary)' : 'var(--skin-primary)';

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
                <LayoutDashboard className="w-5 h-5 text-primary" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-on-surface tracking-tight">Tableau de Bord</h1>
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-wider border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            </div>
            <p className="text-sm text-on-surface-variant">Vue d'ensemble des opérations et métriques de performance.</p>
          </div>
          <div className="flex items-center gap-2.5">
            <SegmentedControl options={PERIODS} value={activePeriod} onChange={setActivePeriod} />
            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={handleDownloadReport} disabled={reportLoading}
              className="px-3.5 py-2 rounded-xl bg-primary text-on-primary font-bold text-xs shadow-sm shadow-primary/20 hover:shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              {reportLoading ? 'Génération...' : 'Rapport PDF'}
            </motion.button>
          </div>
        </div>

        {/* ── KPI TILES (Bento 4-col) ──────────────────────────────────────── */}
        <div className="bento-grid mt-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <KpiTile
            label="Total Tickets"
            value={stats.total}
            icon={Ticket}
            tone="primary"
            delta={8.2}
            spark={ticketSpark}
            onClick={() => navigate('/tickets')}
          />
          <KpiTile
            label="Tickets Ouverts"
            value={openCount}
            icon={RefreshCw}
            tone="info"
            delta={-3.1}
            spark={openSpark}
            onClick={() => navigate('/tickets?status=OPEN')}
          />
          <KpiTile
            label="Taux de Résolution"
            value={resolutionRate}
            suffix="%"
            icon={CheckCircle2}
            tone="success"
            delta={5.4}
            spark={resSpark}
            onClick={() => navigate('/tickets?status=SOLVED')}
          />
          <KpiTile
            label="Critiques P1"
            value={p1Count}
            icon={AlertTriangle}
            tone={p1Count > 0 ? 'danger' : 'success'}
            delta={p1Count > 0 ? -12.5 : 15.3}
            spark={p1Spark}
            onClick={() => navigate('/tickets?priority=P1')}
          />
        </div>
      </motion.div>

      {/* ── ROW 2 — Trend Chart + Status Breakdown (Bento 3-col) ────────── */}
      {isWidgetVisible('ticket_trends') && (
      <div className="bento-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {/* Trend Chart */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="bento-col-2"
        >
          <Panel
            title="Tendance des tickets"
            subtitle={`${period?.label || '30 jours'} — Créés vs Résolus`}
            icon={BarChart3}
          >
            <div className="flex items-center gap-6 mt-2 mb-4">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: 'var(--skin-primary)' }} />
                <span className="text-xs text-on-surface-variant">Créés</span>
                <span className="text-xs font-bold text-on-surface ml-1">{chartData.reduce((s, d) => s + d.tickets, 0)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <span className="text-xs text-on-surface-variant">Résolus</span>
                <span className="text-xs font-bold text-on-surface ml-1">{chartData.reduce((s, d) => s + d.resolved, 0)}</span>
              </div>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="gradTickets" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--skin-primary)" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="var(--skin-primary)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradResolved" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-on-surface-variant)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--color-on-surface-variant)' }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="tickets" stroke="var(--skin-primary)" fill="url(#gradTickets)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="resolved" stroke="#10b981" fill="url(#gradResolved)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </motion.div>

        {/* Status Breakdown */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <Panel title="Répartition par statut" icon={Layers}>
            <div className="flex items-center gap-4">
              <div className="shrink-0">
                <ResponsiveContainer width={110} height={110} minWidth={110} minHeight={110}>
                  <PieChart>
                    <Pie
                      data={statusData.length > 0 ? statusData : [{ name: 'Aucun', value: 1 }]}
                      cx="50%" cy="50%" innerRadius={32} outerRadius={48} paddingAngle={3}
                      dataKey="value" stroke="none" animationDuration={700}
                    >
                      {(statusData.length > 0 ? statusData : [{ name: 'Aucun', value: 1 }]).map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-2 min-w-0">
                {statusData.slice(0, 5).map((s, i) => (
                  <div key={s.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="text-xs font-medium text-on-surface truncate">{s.name}</span>
                    </div>
                    <span className="text-xs font-bold text-on-surface ml-2 shrink-0">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </motion.div>
      </div>
      )}

      {/* ── ROW 3 — AI Performance, Quick Access, Team Breakdown (Bento) ── */}
      <div className="bento-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {/* AI Performance */}
        {isWidgetVisible('ai_pipeline') && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}>
          <Panel title="Performance IA" icon={Bot}>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Brouillons', value: pendingAiDrafts.length, tone: 'primary' },
                  { label: 'À valider', value: needsReview.length, tone: 'warning' },
                  { label: 'En attente', value: pendingApprovals.length, tone: 'info' },
                ].map((m) => (
                  <div key={m.label} className="text-center">
                    <p className="text-2xl font-bold text-on-surface">{m.value}</p>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mt-0.5">{m.label}</p>
                  </div>
                ))}
              </div>
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs text-on-surface-variant">Charge IA vs humain</span>
                  <span className="text-xs font-bold text-on-surface-variant">
                    {stats.total > 0 ? `${Math.round(((pendingAiDrafts.length + needsReview.length) / Math.max(stats.total, 1)) * 100)}%` : '0%'}
                  </span>
                </div>
                <div className="h-2 rounded-full overflow-hidden bg-surface-container">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, Math.round(((pendingAiDrafts.length + needsReview.length) / Math.max(stats.total, 1)) * 100))}%` }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                    className="h-full rounded-full progress-gradient"
                  />
                </div>
              </div>
            </div>
          </Panel>
        </motion.div>
        )}

        {/* Quick Access */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}>
          <Panel title="Accès Rapides" icon={Zap}>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { label: 'Boîte mail', path: '/inbox', icon: Mail, color: 'text-sky-500' },
                { label: 'Brouillons IA', path: '/email-drafts', icon: MailCheck, color: 'text-primary' },
                { label: 'Base conn.', path: '/knowledge-base', icon: BookOpen, color: 'text-purple-500' },
                { label: 'Supervision', path: '/supervision', icon: Monitor, color: 'text-indigo-500' },
              ].map(item => (
                <button key={item.label} onClick={() => navigate(item.path)}
                  className="flex items-center gap-2 p-3 rounded-xl border border-outline-variant/30 bg-surface-container-low/40 hover:bg-surface-container hover:border-primary/30 transition-all text-left group"
                >
                  <item.icon className={`w-4 h-4 ${item.color}`} />
                  <span className="text-xs font-semibold text-on-surface group-hover:text-primary transition-colors">{item.label}</span>
                </button>
              ))}
            </div>
          </Panel>
        </motion.div>

        {/* Team Breakdown */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}>
          <Panel title="Répartition par équipe" icon={Users}>
            <div className="space-y-2.5">
              {teamData.slice(0, 5).map((t, i) => {
                const pct = totalTeamTickets > 0 ? Math.round((t.value / totalTeamTickets) * 100) : 0;
                return (
                  <div key={t.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-on-surface truncate">{t.name}</span>
                      <span className="text-xs font-bold text-on-surface-variant ml-2 shrink-0">{t.value} <span className="font-normal">({pct}%)</span></span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden bg-surface-container">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.6, delay: 0.3 + i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                        className="h-full rounded-full"
                        style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                      />
                    </div>
                  </div>
                );
              })}
              {teamData.length === 0 && (
                <p className="text-xs text-on-surface-variant italic">Aucune donnée d'équipe</p>
              )}
            </div>
          </Panel>
        </motion.div>
      </div>

      {/* ── ROW 4 — Technicien Performance + Activity (Bento 3-col) ─────── */}
      {(isWidgetVisible('top_techs') || isWidgetVisible('recent_activity')) && (
      <div className="bento-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {/* Technicien Table */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="bento-col-2"
        >
          <Panel
            title="Performance techniciens"
            subtitle={`${techPerformance.length} technicien(s)`}
            icon={Users}
            bodyClassName="p-0"
          >
            <DataGrid
              columns={[
                { field: 'fullName', headerName: 'Technicien', flex: 1.5, cellRenderer: (p) => {
                  const i = p.node.rowIndex;
                  return (<div className="flex items-center gap-2.5"><div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-on-primary shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}>{p.value?.charAt(0) || '?'}</div><span className="text-xs font-medium text-on-surface truncate">{p.value || 'Inconnu'}</span></div>);
                } },
                { field: 'assigned', headerName: 'Assignés', width: 90, cellRenderer: (p) => <span className="text-center block text-xs font-bold text-on-surface">{p.data.assigned || 0}</span> },
                { field: 'open', headerName: 'Ouverts', width: 90, cellRenderer: (p) => <span className="text-center block text-xs font-medium text-on-surface-variant">{p.value || 0}</span> },
                { field: 'solved', headerName: 'Résolus', width: 90, cellRenderer: (p) => <span className="text-center block text-xs font-medium text-emerald-600 dark:text-emerald-400">{p.value || 0}</span> },
                { field: 'rate', headerName: 'Taux', width: 80, valueGetter: (p) => { const t = p.data.assigned || 0; const s = p.data.solved || 0; return t > 0 ? Math.round((s / t) * 100) : 0; }, cellRenderer: (p) => <span className={`text-center block text-xs font-bold ${p.value >= 70 ? 'text-emerald-600 dark:text-emerald-400' : p.value >= 40 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500'}`}>{p.value}%</span> },
              ]}
              rowData={techPerformance.slice(0, 8)}
              pagination={false}
              headerHeight={36}
              rowHeight={44}
              noRowsText="Aucune donnée"
            />
          </Panel>
        </motion.div>

        {/* Activity Timeline */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <Panel title="Activité récente" subtitle="Dernières mises à jour" icon={Activity}>
            <div className="space-y-3">
              {recentActivity.slice(0, 6).map((a, i) => {
                const timeAgo = getTimeAgo(a.updatedAt);
                return (
                  <div key={a.id || i} className="flex items-start gap-3 group cursor-pointer" onClick={() => navigate(`/tickets/${a.id}`)}>
                    <div className="relative mt-1">
                      <div className="w-2 h-2 rounded-full bg-primary" />
                      {i < recentActivity.length - 1 && (
                        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-px h-6 bg-outline-variant" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-on-surface truncate group-hover:text-primary transition-colors">
                        #{a.id} {a.title}
                      </p>
                      <p className="text-[10px] text-on-surface-variant mt-0.5">
                        {a.assignee?.fullName || 'Non assigné'} · {timeAgo}
                      </p>
                    </div>
                    <ChevronRight className="w-3 h-3 text-on-surface-variant/40 shrink-0 mt-1 group-hover:text-primary transition-colors" />
                  </div>
                );
              })}
              {recentActivity.length === 0 && (
                <p className="text-xs text-on-surface-variant italic text-center py-4">Aucune activité récente</p>
              )}
            </div>
          </Panel>
        </motion.div>
      </div>
      )}

      {/* ── ROW 5 — SLA Dashboard ────────────────────────────────────────── */}
      {isWidgetVisible('sla_compliance') && slaAnalytics && ['SUPERADMIN', 'ADMIN', 'TECHNICIAN', 'HOTLINE'].includes(user?.role) && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <Panel
            title={`Pilotage SLA — ${slaAnalytics.days} jours`}
            icon={Target}
            action={
              <button onClick={handleDownloadReport} disabled={reportLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-[11px] font-bold hover:bg-primary/20 transition-all disabled:opacity-50">
                <Download className="w-3 h-3" />
                {reportLoading ? 'Génération...' : 'PDF'}
              </button>
            }
          >
            <div className="space-y-4">
              {/* SLA KPIs */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Violation SLA', value: `${slaAnalytics.totals.breachRate}%`, sub: `${slaAnalytics.totals.breached} ticket(s)`, icon: AlertTriangle, tone: slaAnalytics.totals.breachRate > 20 ? 'danger' : 'warning' },
                  { label: 'CSAT moyen', value: slaAnalytics.csat.average != null ? `${slaAnalytics.csat.average}/5` : '—', sub: `${slaAnalytics.csat.rated} notation(s)`, icon: Target, tone: 'success' },
                  { label: 'En retard', value: slaAnalytics.overdue.length, sub: 'tickets ouverts', icon: Clock, tone: 'danger' },
                ].map((m) => (
                  <div key={m.label} className="rounded-xl border border-outline-variant/20 bg-surface-container-low/30 p-4 text-center">
                    <div className="flex items-center justify-center gap-1.5 mb-1.5">
                      <m.icon className="w-3.5 h-3.5" style={{ color: m.tone === 'danger' ? 'var(--color-error)' : m.tone === 'warning' ? 'var(--color-warning)' : 'var(--color-success)' }} />
                      <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">{m.label}</p>
                    </div>
                    <p className="text-2xl font-bold font-data mt-1 text-on-surface">{m.value}</p>
                    <p className="text-[10px] text-on-surface-variant mt-0.5">{m.sub}</p>
                  </div>
                ))}
              </div>

              {/* Priority Table — clean HTML table (Katalyst style) */}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-outline-variant/20">
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Priorité</th>
                      <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Total</th>
                      <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Résolus</th>
                      <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Violation</th>
                      <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Résolution moy.</th>
                      <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">1re réponse</th>
                    </tr>
                  </thead>
                  <tbody>
                    {['P1', 'P2', 'P3', 'P4'].map((p) => {
                      const d = slaAnalytics.byPriority[p];
                      if (!d) return null;
                      return (
                        <tr key={p} className="border-b border-outline-variant/10 last:border-0 hover:bg-primary/[0.03] transition-colors">
                          <td className="px-4 py-2.5"><span className="font-bold" style={{ color: PRIORITY_COLORS[p] }}>{p}</span></td>
                          <td className="px-4 py-2.5 text-center font-semibold text-on-surface">{d.total}</td>
                          <td className="px-4 py-2.5 text-center text-on-surface-variant">{d.resolved}</td>
                          <td className={`px-4 py-2.5 text-center font-bold ${d.breachRate > 20 ? 'text-red-500' : d.breachRate > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>{d.breachRate}%</td>
                          <td className="px-4 py-2.5 text-center text-on-surface-variant">{d.avgResolutionHours != null ? `${d.avgResolutionHours}h` : '—'}</td>
                          <td className="px-4 py-2.5 text-center text-on-surface-variant">{d.avgFirstResponseHours != null ? `${d.avgFirstResponseHours}h` : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Overdue tickets */}
              {slaAnalytics.overdue.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-2">Tickets en retard</p>
                  <div className="flex flex-wrap gap-1.5">
                    {slaAnalytics.overdue.slice(0, 6).map((t) => (
                      <button key={t.id} onClick={() => navigate(`/tickets/${t.id}`)}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400 text-[10px] font-bold hover:bg-red-500/10 transition-colors">
                        #{t.id}
                        <span className="max-w-[100px] truncate font-medium">{t.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Panel>
        </motion.div>
      )}
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────────────────────────── */
function getTimeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days}j`;
}
