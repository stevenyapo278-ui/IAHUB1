import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts';
import api from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';

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

const PIE_COLORS = ['#a1a1aa', '#71717a', '#52525b', '#3f3f46', '#27272a'];
const PERIODS = ['7 Jours', '1 Mois', '3 Mois', '6 Mois'];

/* ── Tooltip personnalisé ────────────────────────────────────────────────────── */
function EfferdTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="px-3 py-2 rounded-lg shadow-xl text-sm"
      style={{
        backgroundColor: 'var(--efferd-card)',
        border: '1px solid var(--efferd-border)',
        color: 'var(--efferd-text)',
      }}
    >
      <p className="font-semibold mb-1" style={{ color: 'var(--efferd-muted)', fontSize: '11px' }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="font-bold" style={{ color: 'var(--efferd-text)' }}>
          {p.value}
        </p>
      ))}
    </div>
  );
}

/* ── KPI Card style Efferd ───────────────────────────────────────────────────── */
function KpiCard({ label, value, icon, trendUp, trendValue, critical }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="efferd-kpi-card"
    >
      {/* Ligne supérieure : label + icon */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span
            className="material-symbols-outlined"
            style={{ fontSize: '14px', width: '14px', height: '14px', color: 'var(--efferd-muted)' }}
          >
            {icon}
          </span>
          <span className="text-[12px] font-medium uppercase tracking-wide" style={{ color: 'var(--efferd-muted)' }}>
            {label}
          </span>
        </div>
        {trendValue !== undefined && (
          <span className={trendUp ? 'efferd-trend-up' : 'efferd-trend-down'}>
            {trendUp ? '▲' : '▼'} {trendValue}
          </span>
        )}
      </div>

      {/* Valeur principale */}
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, delay: 0.08 }}
        className="font-bold"
        style={{
          fontSize: '2rem',
          lineHeight: 1.1,
          color: critical ? 'var(--efferd-red)' : 'var(--efferd-text)',
        }}
      >
        {value}
      </motion.div>

      {/* Indicateur critique */}
      {critical && (
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" style={{ flexShrink: 0 }} />
          <span className="text-[11px]" style={{ color: 'var(--efferd-red)' }}>Nécessite une attention immédiate</span>
        </div>
      )}
    </motion.div>
  );
}

/* ── Skeleton Loading ────────────────────────────────────────────────────────── */
function LoadingSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-xl p-5 animate-pulse"
            style={{ backgroundColor: 'var(--efferd-card)', border: '1px solid var(--efferd-border)', height: 100 }}
          />
        ))}
      </div>
      <div
        className="rounded-xl animate-pulse"
        style={{ backgroundColor: 'var(--efferd-card)', border: '1px solid var(--efferd-border)', height: 280 }}
      />
    </div>
  );
}

/* ── Section Card Efferd ─────────────────────────────────────────────────────── */
function SectionCard({ title, icon, action, children, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={`efferd-card overflow-hidden ${className}`}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid var(--efferd-border)' }}
      >
        <div className="flex items-center gap-2">
          {icon && (
            <span
              className="material-symbols-outlined"
              style={{ fontSize: '15px', width: '15px', height: '15px', color: 'var(--efferd-muted)' }}
            >
              {icon}
            </span>
          )}
          <h3 className="text-[13px] font-semibold" style={{ color: 'var(--efferd-text)' }}>
            {title}
          </h3>
        </div>
        {action}
      </div>

      {/* Body */}
      <div className="p-4">{children}</div>
    </motion.div>
  );
}

/* ── Badge statut pour le tableau ───────────────────────────────────────────── */
function StatusBadge({ status }) {
  const cfg = {
    NEW:     { cls: 'efferd-badge-pending', label: 'Nouveau' },
    OPEN:    { cls: 'efferd-badge-success', label: 'Ouvert' },
    PENDING: { cls: 'efferd-badge-pending', label: 'En attente' },
    SOLVED:  { cls: 'efferd-badge-muted',   label: 'Résolu' },
    CLOSED:  { cls: 'efferd-badge-muted',   label: 'Fermé' },
  }[status] || { cls: 'efferd-badge-muted', label: status };

  return <span className={cfg.cls}>{cfg.label}</span>;
}

function PriorityBadge({ priority }) {
  const cfg = {
    P1: { cls: 'efferd-badge-critical', label: 'P1' },
    P2: { cls: 'efferd-badge-pending',  label: 'P2' },
    P3: { cls: 'efferd-badge-muted',    label: 'P3' },
    P4: { cls: 'efferd-badge-muted',    label: 'P4' },
  }[priority] || { cls: 'efferd-badge-muted', label: priority };

  return <span className={cfg.cls}>{cfg.label}</span>;
}

/* ── Connection Dot ─────────────────────────────────────────────────────────── */
function ConnectionDot({ connected }) {
  return (
    <span className="relative inline-flex items-center justify-center">
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: connected ? 'var(--efferd-green)' : 'var(--efferd-muted)' }}
      />
      {connected && (
        <span
          className="absolute inset-0 w-1.5 h-1.5 rounded-full animate-ping"
          style={{ backgroundColor: 'var(--efferd-green)', opacity: 0.4 }}
        />
      )}
    </span>
  );
}

/* ── IntegrationGroup ────────────────────────────────────────────────────────── */
function IntegrationGroup({ label, items, getConnected, suffix }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--efferd-muted)' }}>
        {label}
      </p>
      <div className="space-y-1">
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between py-1">
            <span className="text-[12px] font-medium truncate capitalize" style={{ color: 'var(--efferd-text)' }}>
              {item.name || item.label}
            </span>
            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              <ConnectionDot connected={getConnected(item)} />
              <span className="text-[10px] uppercase" style={{ color: 'var(--efferd-muted)' }}>
                {suffix ? suffix(item) : getConnected(item) ? 'Connecté' : 'Non connecté'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════ */
/* DASHBOARD PRINCIPAL                                                           */
/* ══════════════════════════════════════════════════════════════════════════════ */
export default function Dashboard() {
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
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [reportLoading, setReportLoading] = useState(false);
  const signatureLogoUrlRef = useRef(null);
  const draftReminderDelayMinutesRef = useRef(30);

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
    api.get('/system-settings').then(({ data }) => {
      signatureLogoUrlRef.current = data.signatureLogoUrl || null;
      draftReminderDelayMinutesRef.current = data.draftReminderDelayMinutes || 30;
    }).catch(() => {});
    loadPendingAiDrafts();
    loadNeedsReview();

    let trendParams = '';
    if (customStartDate && customEndDate) {
      trendParams = `?startDate=${customStartDate}&endDate=${customEndDate}`;
    } else {
      const days = PERIOD_DAYS[activePeriod] || 30;
      trendParams = `?days=${days}`;
    }
    api.get(`/dashboard/activity-trend${trendParams}`).then(({ data }) => setActivityTrend(data)).catch(() => {});
  }

  async function handleDownloadReport() {
    setReportLoading(true);
    try {
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

      const response = await api.get(`/dashboard/report${queryParams}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `rapport-itsm-${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError('Erreur lors du téléchargement du rapport');
    } finally {
      setReportLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    const id = setInterval(loadAll, 15000);
    return () => clearInterval(id);
  }, [activePeriod, customStartDate, customEndDate]);

  /* ── Édition brouillons ── */
  const [editedDrafts, setEditedDrafts] = useState({});
  const [editedRecipients, setEditedRecipients] = useState({});
  const [editedCc, setEditedCc] = useState({});
  const [ccInput, setCcInput] = useState({});
  const [confirmReview, setConfirmReview] = useState(null);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  function toDisplayHtml(html) {
    if (!signatureLogoUrlRef.current) return html;
    return html.replaceAll('cid:logo-signature', signatureLogoUrlRef.current);
  }
  function fromDisplayHtml(html) {
    if (!signatureLogoUrlRef.current) return html;
    return html.split(signatureLogoUrlRef.current).join('cid:logo-signature');
  }
  function setDraftContent(id, content) {
    setEditedDrafts((prev) => ({ ...prev, [id]: fromDisplayHtml(content) }));
  }
  function getCcList(draft) {
    return editedCc[draft.id] !== undefined ? editedCc[draft.id] : (draft.ccRecipients || []);
  }
  function addCc(draft) {
    const value = (ccInput[draft.id] || '').trim();
    if (!value) return;
    const current = getCcList(draft);
    if (!current.includes(value)) setEditedCc((prev) => ({ ...prev, [draft.id]: [...current, value] }));
    setCcInput((prev) => ({ ...prev, [draft.id]: '' }));
  }
  function removeCc(draft, email) {
    setEditedCc((prev) => ({ ...prev, [draft.id]: getCcList(draft).filter((e) => e !== email) }));
  }
  function askReview(id, action, draft) { setConfirmReview({ id, action, draft }); }
  async function confirmReviewRun() {
    if (!confirmReview) return;
    const { id, action, draft } = confirmReview;
    setReviewSubmitting(true);
    try {
      const body = action === 'approve'
        ? {
            proposedContent: editedDrafts[id] !== undefined ? editedDrafts[id] : draft.proposedContent,
            recipientEmail: editedRecipients[id] !== undefined ? editedRecipients[id] : draft.recipientEmail,
            ccRecipients: getCcList(draft),
          }
        : {};
      await api.post(`/ai-email-drafts/${id}/${action}`, body);
      setEditedDrafts((prev) => { const n = { ...prev }; delete n[id]; return n; });
      setEditedRecipients((prev) => { const n = { ...prev }; delete n[id]; return n; });
      setEditedCc((prev) => { const n = { ...prev }; delete n[id]; return n; });
      setConfirmReview(null);
      loadPendingAiDrafts();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la validation');
    } finally {
      setReviewSubmitting(false);
    }
  }

  /* ── Etats d'erreur et chargement ── */
  if (error) {
    return (
      <div
        className="m-6 p-4 rounded-xl text-sm"
        style={{ backgroundColor: 'var(--efferd-red-bg)', border: '1px solid var(--efferd-red)', color: 'var(--efferd-red)' }}
      >
        {error}
      </div>
    );
  }
  if (!stats) return <LoadingSkeleton />;

  /* ── Données dérivées ── */
  const statusData = stats.byStatus.map((s) => ({ name: STATUS_LABELS[s.status] || s.status, value: s.count }));
  const priorityData = stats.byPriority.map((p) => ({ name: PRIORITY_LABELS[p.priority] || p.priority, value: p.count }));
  const teamData = stats.byTeam.map((t) => ({ name: t.teamName || 'Non assigné', value: t.count }));
  const p1Count = priorityData.find((p) => p.name.startsWith('P1'))?.value ?? 0;
  const totalTeamTickets = teamData.reduce((s, t) => s + t.value, 0);

  // Données réelles depuis l'API
  const trendData = activityTrend.map((d, i) => ({ day: i + 1, date: d.date, tickets: d.tickets, resolved: d.resolved }));

  // Sparkline (7 derniers jours)
  const sparkData = trendData.slice(-7);

  // Métriques calculées
  const resolvedCount = stats.byStatus.find(s => s.status === 'SOLVED')?.count ?? 0;
  const closedCount = stats.byStatus.find(s => s.status === 'CLOSED')?.count ?? 0;
  const resolvedTotal = resolvedCount + closedCount;
  const resolutionRate = stats.total > 0 ? Math.round((resolvedTotal / stats.total) * 100) : 0;
  const trendTicketsSum = trendData.reduce((s, d) => s + d.tickets, 0);
  const prevHalf = trendData.slice(0, Math.floor(trendData.length / 2)).reduce((s, d) => s + d.tickets, 0);
  const currHalf = trendData.slice(Math.floor(trendData.length / 2)).reduce((s, d) => s + d.tickets, 0);
  const globalTrendUp = currHalf >= prevHalf;

  // Checkbox helpers
  function toggleRow(id) {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (selectedRows.size === recentActivity.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(recentActivity.map((t) => t.id)));
  }

  return (
    <div className="p-6 space-y-5 min-h-screen" style={{ backgroundColor: 'var(--efferd-bg)' }}>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* HEADER — filtres de période + action                                  */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      >
        {/* Filtres de période & Date range */}
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex items-center gap-1 p-1 rounded-lg"
            style={{ backgroundColor: 'var(--efferd-card)', border: '1px solid var(--efferd-border)' }}
          >
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => {
                  setActivePeriod(p);
                  setCustomStartDate('');
                  setCustomEndDate('');
                }}
                className={`efferd-period-btn ${activePeriod === p && !customStartDate && !customEndDate ? 'active' : ''}`}
              >
                {p}
              </button>
            ))}
          </div>

          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm"
            style={{ backgroundColor: 'var(--efferd-card)', border: '1px solid var(--efferd-border)', color: 'var(--efferd-text)' }}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--efferd-muted)' }}>Du</span>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => {
                  setCustomStartDate(e.target.value);
                  setActivePeriod('');
                }}
                className="bg-transparent border-none text-xs focus:outline-none cursor-pointer"
                style={{ color: 'var(--efferd-text)', colorScheme: 'dark' }}
              />
            </div>
            <div className="w-[1px] h-4 bg-[var(--efferd-border)]" style={{ backgroundColor: 'var(--efferd-border)' }} />
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--efferd-muted)' }}>Au</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => {
                  setCustomEndDate(e.target.value);
                  setActivePeriod('');
                }}
                className="bg-transparent border-none text-xs focus:outline-none cursor-pointer"
                style={{ color: 'var(--efferd-text)', colorScheme: 'dark' }}
              />
            </div>
            {(customStartDate || customEndDate) && (
              <button
                onClick={() => {
                  setCustomStartDate('');
                  setCustomEndDate('');
                  setActivePeriod('1 Mois');
                }}
                className="ml-1 text-[16px] material-symbols-outlined hover:text-red-500 cursor-pointer flex items-center"
                title="Réinitialiser"
              >
                close
              </button>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadReport}
            disabled={reportLoading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors"
            style={{
              backgroundColor: 'var(--efferd-card)',
              border: '1px solid var(--efferd-border)',
              color: reportLoading ? 'var(--efferd-muted)' : 'var(--efferd-text)',
              cursor: reportLoading ? 'not-allowed' : 'pointer',
              opacity: reportLoading ? 0.7 : 1,
            }}
            onMouseEnter={(e) => { if (!reportLoading) e.currentTarget.style.backgroundColor = 'var(--efferd-card-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--efferd-card)'; }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '15px', width: '15px', height: '15px' }}>
              {reportLoading ? 'hourglass_empty' : 'download'}
            </span>
            {reportLoading ? 'Génération...' : 'Télécharger rapport'}
          </button>
          <button
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{
              backgroundColor: 'var(--efferd-card)',
              border: '1px solid var(--efferd-border)',
              color: 'var(--efferd-muted)',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px', width: '16px', height: '16px' }}>
              more_horiz
            </span>
          </button>
        </div>
      </motion.div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* RANGÉE 1 — 4 KPI Cards                                                */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Total tickets"
          value={stats.total}
          icon="confirmation_number"
          trendUp={globalTrendUp}
          trendValue={`${trendTicketsSum} sur ${activePeriod.toLowerCase()}`}
        />
        <KpiCard
          label="Tickets ouverts"
          value={stats.open}
          icon="pending_actions"
          trendUp={stats.open < stats.total / 2}
          trendValue={stats.total > 0 ? `${Math.round((stats.open / stats.total) * 100)}% du total` : '0%'}
        />
        <KpiCard
          label="Taux résolution"
          value={`${resolutionRate}%`}
          icon="check_circle"
          trendUp={resolutionRate >= 50}
          trendValue={`${resolvedTotal} résolus`}
        />
        <KpiCard
          label="Priorités P1"
          value={p1Count}
          icon="warning"
          critical={p1Count > 0}
          trendUp={false}
          trendValue={p1Count > 0 ? `${p1Count} urgent${p1Count > 1 ? 's' : ''}` : undefined}
        />
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* RANGÉE 2 — Graphique Area pleine largeur                              */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="efferd-card overflow-hidden"
      >
        {/* Header du graphique */}
        <div
          className="flex items-center justify-between px-5 pt-4 pb-2"
          style={{ borderBottom: '1px solid var(--efferd-border)' }}
        >
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-semibold" style={{ color: 'var(--efferd-text)' }}>
              Activité des tickets
            </span>
            <span className={globalTrendUp ? 'efferd-trend-up' : 'efferd-trend-down'}>
              {globalTrendUp ? '▲' : '▼'} {trendTicketsSum} tickets sur {activePeriod.toLowerCase()}
            </span>
          </div>
        </div>

        {/* Area Chart */}
        <div style={{ padding: '1rem 1rem 0' }}>
          {trendData.length === 0 ? (
            <div className="flex items-center justify-center h-[260px] text-[13px]" style={{ color: 'var(--efferd-muted)' }}>
              Aucune activité sur la période
            </div>
          ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={trendData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="ticketGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--efferd-text)" stopOpacity={0.08} />
                  <stop offset="95%" stopColor="var(--efferd-text)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="var(--efferd-border)"
                strokeOpacity={1}
              />
              <XAxis
                dataKey="day"
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--efferd-muted)', fontSize: 11 }}
                tickFormatter={(v) => `Jour ${v}`}
                interval={4}
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--efferd-muted)', fontSize: 11 }}
                tickFormatter={(v) => `${v}`}
              />
              <Tooltip content={<EfferdTooltip />} />
              <Area
                type="monotone"
                dataKey="tickets"
                stroke="var(--efferd-text)"
                strokeWidth={1.5}
                fill="url(#ticketGradient)"
                dot={false}
                activeDot={{ r: 4, fill: 'var(--efferd-text)', strokeWidth: 0 }}
                animationDuration={800}
              />
              <Area
                type="monotone"
                dataKey="resolved"
                stroke="var(--efferd-green)"
                strokeWidth={1}
                fill="none"
                dot={false}
                strokeDasharray="3 3"
                activeDot={{ r: 3, fill: 'var(--efferd-green)', strokeWidth: 0 }}
                animationDuration={800}
              />
            </AreaChart>
          </ResponsiveContainer>
          )}
        </div>
      </motion.div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* RANGÉE 3 — Donut + Sparkline + Panel performances                     */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Donut — Répartition par équipe (style Lead Sources Efferd) */}
        <SectionCard
          title="Répartition par équipe"
          icon="pie_chart"
          action={
            <button className="text-[12px] font-medium flex items-center gap-1 transition-opacity hover:opacity-70"
              style={{ color: 'var(--efferd-muted)' }}>
              Détails →
            </button>
          }
        >
          <div className="flex items-center gap-4">
            {/* Donut */}
            <div className="shrink-0">
              <ResponsiveContainer width={100} height={100}>
                <PieChart>
                  <Pie
                    data={teamData.length > 0 ? teamData : [{ name: 'Aucune', value: 1 }]}
                    cx="50%"
                    cy="50%"
                    innerRadius={30}
                    outerRadius={45}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                    animationDuration={700}
                  >
                    {(teamData.length > 0 ? teamData : [{ name: 'Aucune', value: 1 }]).map((entry, index) => (
                      <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <p className="text-center text-[10px] mt-0.5" style={{ color: 'var(--efferd-muted)' }}>
                {totalTeamTickets} tickets
              </p>
            </div>

            {/* Liste des sources */}
            <div className="flex-1 space-y-2 min-w-0">
              {teamData.slice(0, 4).map((t, i) => (
                <div key={t.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2 h-2 rounded-sm shrink-0"
                      style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                    />
                    <span className="text-[12px] truncate" style={{ color: 'var(--efferd-text)' }}>{t.name}</span>
                  </div>
                  <span className="text-[12px] font-semibold ml-2 shrink-0" style={{ color: 'var(--efferd-text)' }}>
                    {t.value}
                  </span>
                </div>
              ))}
              {teamData.length === 0 && (
                <p className="text-[12px] italic" style={{ color: 'var(--efferd-muted)' }}>Aucune équipe</p>
              )}
            </div>
          </div>
        </SectionCard>

        {/* Sparkline — Nouveaux tickets / jour */}
        <SectionCard
          title="Nouveaux tickets / jour"
          icon="trending_up"
          action={
            <Link to="/tickets" className="text-[12px] font-medium flex items-center gap-1 transition-opacity hover:opacity-70"
              style={{ color: 'var(--efferd-muted)' }}>
              Voir les tickets →
            </Link>
          }
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[28px] font-bold leading-none" style={{ color: 'var(--efferd-text)' }}>
                {trendTicketsSum}
              </span>
              <span className={globalTrendUp ? 'efferd-trend-up' : 'efferd-trend-down'}>
                {globalTrendUp ? '▲' : '▼'} sur {activePeriod.toLowerCase()}
              </span>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--efferd-muted)' }}>
              {resolvedTotal > 0 && `${resolvedTotal} résolus · `}{stats.open} ouverts actuellement
            </p>
            {/* Sparkline réelle */}
            <div className="mt-2">
              {sparkData.length > 0 ? (
                <ResponsiveContainer width="100%" height={60}>
                  <LineChart data={sparkData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                    <Line
                      type="monotone"
                      dataKey="tickets"
                      stroke="var(--efferd-text)"
                      strokeWidth={1.5}
                      dot={false}
                      animationDuration={600}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[60px] flex items-center justify-center text-[11px]" style={{ color: 'var(--efferd-muted)' }}>
                  Pas encore de données
                </div>
              )}
            </div>
          </div>
        </SectionCard>

        {/* Panel Performance IA — style Campaign ROI Efferd */}
        <SectionCard
          title="Performance IA"
          icon="smart_toy"
          action={
            <Link to="/supervision" className="text-[12px] font-medium transition-opacity hover:opacity-70"
              style={{ color: 'var(--efferd-muted)' }}>
              Supervision →
            </Link>
          }
        >
          <div className="space-y-3">
            {/* Métriques style ROI Efferd */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Brouillons', value: pendingAiDrafts.length, icon: 'drafts' },
                { label: 'À valider', value: needsReview.length, icon: 'rate_review' },
                { label: 'Approbation', value: pendingApprovals.length, icon: 'fact_check' },
              ].map((m) => (
                <div key={m.label}>
                  <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--efferd-muted)' }}>{m.label}</p>
                  <p className="text-[20px] font-bold leading-tight mt-0.5" style={{ color: 'var(--efferd-text)' }}>
                    {m.value}
                  </p>
                </div>
              ))}
            </div>

            {/* Progress bar style "Spend vs return mix" Efferd */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <p className="text-[11px]" style={{ color: 'var(--efferd-muted)' }}>Charge IA vs humain</p>
                <p className="text-[11px] font-semibold" style={{ color: 'var(--efferd-muted)' }}>
                  {stats.total > 0 ? `${Math.round(((pendingAiDrafts.length + needsReview.length) / Math.max(stats.total, 1)) * 100)}% IA` : '0%'}
                </p>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--efferd-border)' }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{
                    width: `${Math.min(100, Math.round(((pendingAiDrafts.length + needsReview.length) / Math.max(stats.total, 1)) * 100))}%`
                  }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  className="h-full rounded-full"
                  style={{ backgroundColor: 'var(--efferd-text)' }}
                />
              </div>
            </div>

            {/* Sous-métriques */}
            <div className="flex justify-between">
              <div>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--efferd-muted)' }} />
                  <span className="text-[10px]" style={{ color: 'var(--efferd-muted)' }}>IA traitée</span>
                </div>
                <p className="text-[14px] font-bold" style={{ color: 'var(--efferd-text)' }}>
                  {pendingAiDrafts.length + needsReview.length}
                </p>
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="w-2 h-2 rounded-full border" style={{ borderColor: 'var(--efferd-muted)' }} />
                  <span className="text-[10px]" style={{ color: 'var(--efferd-muted)' }}>Humain requis</span>
                </div>
                <p className="text-[14px] font-bold" style={{ color: 'var(--efferd-text)' }}>
                  {pendingApprovals.length}
                </p>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* RANGÉE 4 — Tableau "Tickets récents" style Efferd + sidebar droite     */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Tableau principal */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="efferd-card overflow-hidden lg:col-span-2"
        >
          {/* Header tableau */}
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: '1px solid var(--efferd-border)' }}
          >
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ fontSize: '15px', width: '15px', height: '15px', color: 'var(--efferd-muted)' }}>
                table_rows
              </span>
              <h3 className="text-[13px] font-semibold" style={{ color: 'var(--efferd-text)' }}>Tickets récents</h3>
            </div>
            {/* Search bar */}
            <div
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
              style={{
                backgroundColor: 'var(--efferd-card-hover)',
                border: '1px solid var(--efferd-border)',
                minWidth: 180,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '13px', width: '13px', height: '13px', color: 'var(--efferd-muted)' }}>
                search
              </span>
              <span className="text-[12px]" style={{ color: 'var(--efferd-muted)' }}>Rechercher...</span>
            </div>
          </div>

          {/* Tableau */}
          <div className="overflow-x-auto">
            <table className="efferd-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={selectedRows.size === recentActivity.length && recentActivity.length > 0}
                      onChange={toggleAll}
                      style={{ accentColor: 'var(--efferd-text)', cursor: 'pointer' }}
                    />
                  </th>
                  {['ID ↕', 'Demandeur ↕', 'Titre ↕', 'Statut ↕', 'Priorité ↕', 'Assigné ↕', 'Actions'].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentActivity.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-[12px]" style={{ color: 'var(--efferd-muted)' }}>
                      Aucune activité récente
                    </td>
                  </tr>
                )}
                {recentActivity.slice(0, 8).map((t) => (
                  <tr key={t.id}>
                    <td>
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={selectedRows.has(t.id)}
                        onChange={() => toggleRow(t.id)}
                        style={{ accentColor: 'var(--efferd-text)', cursor: 'pointer' }}
                      />
                    </td>
                    <td>
                      <span className="font-mono text-[11px]" style={{ color: 'var(--efferd-muted)' }}>
                        #{t.id}
                      </span>
                    </td>
                    <td>
                      <span className="font-semibold text-[12px]" style={{ color: 'var(--efferd-text)' }}>
                        {t.requester?.fullName || t.assignedTo?.fullName || '—'}
                      </span>
                    </td>
                    <td>
                      <Link
                        to={`/tickets/${t.id}`}
                        className="text-[12px] hover:underline truncate max-w-[140px] block"
                        style={{ color: 'var(--efferd-text)' }}
                      >
                        {t.title}
                      </Link>
                    </td>
                    <td><StatusBadge status={t.status} /></td>
                    <td><PriorityBadge priority={t.priority} /></td>
                    <td>
                      <span className="text-[12px]" style={{ color: 'var(--efferd-muted)' }}>
                        {t.assignedTo?.fullName || '—'}
                      </span>
                    </td>
                    <td>
                      <Link
                        to={`/tickets/${t.id}`}
                        className="w-7 h-7 rounded flex items-center justify-center transition-colors"
                        style={{ color: 'var(--efferd-muted)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--efferd-text)'; e.currentTarget.style.backgroundColor = 'var(--efferd-card-hover)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--efferd-muted)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '16px', width: '16px', height: '16px' }}>
                          more_horiz
                        </span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>

        {/* Panneau latéral droit — Approbations + Intégrations */}
        <div className="space-y-4">

          {/* Répartition par statut — mini bar chart */}
          <SectionCard title="Par statut" icon="bar_chart">
            <div className="space-y-2">
              {statusData.map((s) => (
                <div key={s.name}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[11px]" style={{ color: 'var(--efferd-muted)' }}>{s.name}</span>
                    <span className="text-[12px] font-semibold" style={{ color: 'var(--efferd-text)' }}>{s.value}</span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--efferd-border)' }}>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${stats.total > 0 ? (s.value / stats.total) * 100 : 0}%` }}
                      transition={{ duration: 0.7, ease: 'easeOut' }}
                      className="h-full rounded-full"
                      style={{ backgroundColor: 'var(--efferd-text)' }}
                    />
                  </div>
                </div>
              ))}
              {statusData.length === 0 && (
                <p className="text-[12px] italic" style={{ color: 'var(--efferd-muted)' }}>Aucun ticket</p>
              )}
            </div>
          </SectionCard>

          {/* Approbations en attente */}
          <SectionCard
            title="En attente d'approbation"
            icon="fact_check"
            action={
              <span
                className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: 'var(--efferd-border)', color: 'var(--efferd-muted)' }}
              >
                {pendingApprovals.length}
              </span>
            }
          >
            <div className="space-y-1">
              {pendingApprovals.length === 0 && (
                <p className="text-[12px] italic" style={{ color: 'var(--efferd-muted)' }}>Aucun ticket en attente.</p>
              )}
              {pendingApprovals.slice(0, 5).map((t) => (
                <Link
                  key={t.id}
                  to={`/tickets/${t.id}`}
                  className="flex items-center justify-between py-1.5 px-2 rounded-lg transition-colors"
                  style={{ color: 'var(--efferd-text)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--efferd-card-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium truncate">#{t.id} {t.title}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--efferd-muted)' }}>
                      {t.requester?.fullName || '—'}
                    </p>
                  </div>
                  <PriorityBadge priority={t.priority} />
                </Link>
              ))}
            </div>
          </SectionCard>

          {/* Statut des intégrations */}
          <SectionCard title="Intégrations" icon="cable">
            {integrations ? (
              <div className="space-y-3">
                <IntegrationGroup label="Services" items={integrations.apiConfigs} getConnected={(c) => c.connected} />
                <IntegrationGroup label="Modèles IA" items={integrations.aiProviders} getConnected={(p) => p.connected} suffix={(p) => p.connected ? `${p.activeKeys} clé(s)` : 'Non connecté'} />
              </div>
            ) : (
              <p className="text-[12px] italic" style={{ color: 'var(--efferd-muted)' }}>Chargement...</p>
            )}
          </SectionCard>
        </div>
      </div>

      {/* ── ConfirmDialog brouillons IA ── */}
      <ConfirmDialog
        open={!!confirmReview}
        title={confirmReview?.action === 'approve' ? 'Approuver et envoyer' : 'Rejeter cette réponse'}
        message={
          confirmReview?.action === 'approve'
            ? "Cette réponse va être envoyée immédiatement par email. Confirmer ?"
            : 'Ce brouillon sera rejeté définitivement.'
        }
        confirmLabel={confirmReview?.action === 'approve' ? 'Envoyer' : 'Rejeter'}
        danger={confirmReview?.action === 'reject'}
        loading={reviewSubmitting}
        onConfirm={confirmReviewRun}
        onCancel={() => setConfirmReview(null)}
      />
    </div>
  );
}
