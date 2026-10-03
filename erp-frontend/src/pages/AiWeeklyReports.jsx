import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Brain, Sparkles, CheckCircle2, XCircle, Clock, RefreshCw,
  SlidersHorizontal, Check, AlertTriangle, ArrowRight, PenTool, BarChart3,
  Trash2, Power, TrendingUp, CalendarClock, Save, X, Eye, ChevronRight
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import api from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';

// Libellés lisibles des champs/valeurs de correspondance des règles de triage
const MATCH_FIELD_LABELS = {
  subject: 'Sujet', body: 'Corps', subject_or_body: 'Sujet ou corps',
  from: 'Expéditeur', sentiment: 'Sentiment', time_window: 'Créneau', domain: 'Domaine',
};
const MATCH_TYPE_LABELS = {
  contains: 'contient', regex: 'expression régulière', equals: 'égal à',
  starts_with: 'commence par', ai_semantic: 'sémantique IA',
};
// Cibles lisibles d'une règle proposée (fieldName → libellé)
const TARGET_LABELS = {
  category: 'Catégorie', priority: 'Priorité', ticketPriority: 'Priorité',
  teamId: 'Équipe', assignedToId: 'Technicien', type: 'Type',
  urgency: 'Urgence', impact: 'Impact', source: 'Source',
};
const WEEKDAY_LABELS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const FIELD_COLORS = ['#8b5cf6', '#6366f1', '#3b82f6', '#0ea5e9', '#14b8a6', '#10b981'];

function ChartTooltip({ active, payload, label, unit = '' }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-3 py-2 rounded-xl shadow-xl text-xs border border-outline-variant/40 bg-surface-container-lowest text-on-surface">
      <p className="font-semibold mb-1 text-on-surface-variant text-[11px]">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="font-bold" style={{ color: p.color }}>{p.value}{unit ? ` ${unit}` : ''}</p>
      ))}
    </div>
  );
}

// Modale de détail d'un rapport : montre TOUTES les règles qui seront créées avant
// approbation. Racine motion locale (initial/animate explicites) — jamais de variants
// hérités, sinon les enfants montés après l'animation de page restent en opacity 0.
function ReportDetailModal({ report, onClose, onApprove, onReject, busy, note, setNote }) {
  return createPortal(
    <AnimatePresence>
      {report && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={busy ? undefined : onClose}
            className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }}
            className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-y-auto"
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 p-6 pb-4 bg-surface-container-lowest border-b border-outline-variant/30">
              <div className="space-y-1 min-w-0">
                <p className="text-sm font-extrabold text-on-surface flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary shrink-0" />
                  Rapport {report.startDate ? new Date(report.startDate).toLocaleDateString('fr-FR') : ''} → {report.endDate ? new Date(report.endDate).toLocaleDateString('fr-FR') : ''}
                </p>
                <p className="text-[11px] text-on-surface-variant font-medium">
                  {report.totalCorrections} corrections Hotline • {report.totalRejections} rejets •{' '}
                  {(Array.isArray(report.proposedRules) ? report.proposedRules : []).length} règle(s) proposée(s)
                </p>
              </div>
              <button
                onClick={onClose} disabled={busy}
                className="p-2 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {(Array.isArray(report.proposedRules) ? report.proposedRules : []).length === 0 ? (
                <div className="p-8 text-center rounded-2xl border border-dashed border-outline-variant/40 space-y-2">
                  <Brain className="w-8 h-8 text-outline mx-auto" />
                  <p className="text-sm font-bold text-on-surface">Aucune règle proposée</p>
                  <p className="text-xs text-on-surface-variant">
                    Les corrections de la période n'ont pas atteint les seuils de confiance configurés.
                  </p>
                </div>
              ) : (
                (Array.isArray(report.proposedRules) ? report.proposedRules : []).map((rule, i) => (
                  <div key={i} className="p-4 rounded-xl border border-outline-variant/30 bg-surface-container-low/40 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs font-bold text-on-surface">{rule.label}</p>
                      <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase shrink-0 ${
                        rule.isSpam ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      }`}>
                        {rule.isSpam ? 'Anti-spam' : 'Triage'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-on-surface-variant">
                      <span className="px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold font-mono">
                        {MATCH_FIELD_LABELS[rule.matchField] || rule.matchField}
                      </span>
                      <span>{MATCH_TYPE_LABELS[rule.matchType] || rule.matchType}</span>
                      <span className="font-mono font-semibold text-on-surface bg-surface-container px-1.5 py-0.5 rounded-md">
                        « {String(rule.matchValue || '').substring(0, 100)} »
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap text-[11px]">
                      {rule.isSpam ? (
                        <span className="text-red-600 dark:text-red-400 font-semibold">→ marqué spam, exclu du triage</span>
                      ) : rule.fieldName ? (
                        <span className="text-on-surface font-semibold">
                          → {TARGET_LABELS[rule.fieldName] || rule.fieldName} = {String(rule.suggestedValue || '—')}
                        </span>
                      ) : null}
                      {rule.occurrenceCount > 1 && (
                        <span className="text-on-surface-variant/70">({rule.occurrenceCount} fois observé)</span>
                      )}
                      {typeof rule.confidence === 'number' && (
                        <span className="px-1.5 py-0.5 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 font-bold">
                          confiance {Math.round(rule.confidence * 100)}%
                        </span>
                      )}
                    </div>
                    {Array.isArray(rule.sampleTitles) && rule.sampleTitles.length > 0 && (
                      <ul className="space-y-0.5 text-[10px] text-on-surface-variant/70 list-disc pl-4">
                        {rule.sampleTitles.map((t, j) => <li key={j} className="truncate">{t}</li>)}
                      </ul>
                    )}
                  </div>
                ))
              )}

              {report.status === 'PENDING' && (
                <div className="space-y-3 pt-2 border-t border-outline-variant/30">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                    Note (optionnelle)
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    placeholder="Motif du rejet, commentaire d'approbation…"
                    className="w-full bg-surface border border-outline-variant/40 rounded-xl px-3 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={onReject} disabled={busy}
                      className="px-4 py-2 rounded-xl text-xs font-semibold border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
                    >
                      Rejeter le rapport
                    </button>
                    <button
                      onClick={onApprove} disabled={busy}
                      className="px-4 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-500/20 transition-all flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Approuver et activer les règles
                    </button>
                  </div>
                </div>
              )}

              {report.status !== 'PENDING' && (
                <div className={`p-3 rounded-xl text-xs font-semibold border ${
                  report.status === 'APPROVED'
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                    : 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
                }`}>
                  {report.status === 'APPROVED' ? 'Rapport approuvé' : 'Rapport rejeté'}
                  {report.reviewedAt ? ` le ${new Date(report.reviewedAt).toLocaleString('fr-FR')}` : ''}
                  {report.reviewedBy?.fullName ? ` par ${report.reviewedBy.fullName}` : ''}
                  {report.reviewNote ? ` — « ${report.reviewNote} »` : ''}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export default function AiWeeklyReports() {
  const navigate = useNavigate();
  const [reports, setReports] = useState([]);
  const [stats, setStats] = useState(null);
  const [rules, setRules] = useState([]);
  const [cfg, setCfg] = useState(null);          // formulaire de configuration (PATCH /settings)
  const [savedCfg, setSavedCfg] = useState(null); // dernière config persistée (pour le dirty check)
  const [loading, setLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [actionId, setActionId] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rulesFilter, setRulesFilter] = useState('all'); // all | active | inactive | spam
  const [rulesSearch, setRulesSearch] = useState('');
  const [detail, setDetail] = useState(null);    // rapport affiché dans la modale de détail
  const [reviewNote, setReviewNote] = useState('');
  const [confirmApproveId, setConfirmApproveId] = useState(null);
  const [deleteRuleId, setDeleteRuleId] = useState(null);

  async function loadAll() {
    setLoading(true);
    setStatsError(false);
    try {
      const [statsRes, reportsRes, rulesRes, settingsRes] = await Promise.all([
        api.get('/ai-weekly-reports/stats').catch(() => null),
        api.get('/ai-weekly-reports'),
        api.get('/ai-weekly-reports/rules').catch(() => []),
        api.get('/ai-weekly-reports/settings').catch(() => null),
      ]);
      if (statsRes) setStats(statsRes.data); else setStatsError(true);
      setReports(reportsRes.data);
      if (Array.isArray(rulesRes.data)) setRules(rulesRes.data);
      if (settingsRes) {
        setCfg(settingsRes.data);
        setSavedCfg(settingsRes.data);
      }
    } catch (err) {
      toast.error('Erreur lors du chargement');
      setStatsError(true);
    } finally {
      setLoading(false);
    }
  }

  // Premier chargement : l'état initial (loading=true, statsError=false) est déjà correct,
  // les setState de loadAll sont asynchrones (après await) — seul setLoading(true) est sync.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadAll(); }, []);

  const cfgDirty = !!cfg && !!savedCfg && JSON.stringify(cfg) !== JSON.stringify(savedCfg);

  async function saveSettings() {
    setSavingSettings(true);
    try {
      const res = await api.patch('/ai-weekly-reports/settings', cfg);
      setCfg(res.data);
      setSavedCfg(res.data);
      toast.success('Configuration enregistrée');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de l\'enregistrement');
    } finally {
      setSavingSettings(false);
    }
  }

  function setCfgField(key, value) {
    setCfg((prev) => ({ ...prev, [key]: value }));
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await api.post('/ai-weekly-reports/generate');
      if (res.data.message) {
        toast.info(res.data.message);
        loadAll();
      } else {
        toast.success('Rapport généré avec succès');
        loadAll();
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur de génération');
    } finally {
      setGenerating(false);
    }
  }

  async function handleApprove(id) {
    setActionId(id);
    try {
      const res = await api.post(`/ai-weekly-reports/${id}/approve`, { note: reviewNote.trim() || undefined });
      const skipped = res.data.skippedInternalDomainCount || 0;
      toast.success(
        `${res.data.createdRulesCount} règle(s) activée(s) !` +
        (skipped > 0 ? ` (${skipped} ignorée(s) : domaine interne protégé)` : '')
      );
      setDetail(null);
      setConfirmApproveId(null);
      setReviewNote('');
      loadAll();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de l\'approbation');
    } finally {
      setActionId(null);
    }
  }

  async function handleReject(id) {
    setActionId(id);
    try {
      await api.post(`/ai-weekly-reports/${id}/reject`, { note: reviewNote.trim() || undefined });
      toast.success('Rapport rejeté');
      setDetail(null);
      setReviewNote('');
      loadAll();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors du rejet');
    } finally {
      setActionId(null);
    }
  }

  async function toggleRule(id) {
    setActionId(`rule-${id}`);
    try {
      const updated = await api.patch(`/ai-weekly-reports/rules/${id}/toggle`);
      setRules((prev) => prev.map((r) => (r.id === id ? updated.data : r)));
      toast.success(updated.data.isActive ? 'Règle activée' : 'Règle désactivée');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setActionId(null);
    }
  }

  async function confirmDeleteRule() {
    const id = deleteRuleId;
    setActionId(`rule-${id}`);
    try {
      await api.delete(`/ai-weekly-reports/rules/${id}`);
      setRules((prev) => prev.filter((r) => r.id !== id));
      setDeleteRuleId(null);
      toast.success('Règle supprimée');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setActionId(null);
    }
  }

  const maxFieldCount = stats?.correctionsByField?.length
    ? Math.max(...stats.correctionsByField.map((c) => c.count), 1)
    : 1;

  const trendData = (stats?.weeklyTrend || []).map((w) => ({
    label: new Date(w.week).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
    count: w.count,
  }));
  const fieldData = (stats?.correctionsByField || []).slice(0, 6).map((c) => ({
    field: c.field,
    count: c.count,
  }));
  const hasTrendData = trendData.some((d) => d.count > 0);

  return (
    <div className="p-6 sm:p-8 max-w-7xl mx-auto space-y-8 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 shadow-lg shadow-purple-500/20">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-black text-on-surface tracking-tight">Apprentissage IA</h1>
          </div>
          <p className="text-xs text-on-surface-variant max-w-xl font-medium pl-11">
            La plateforme apprend chaque correction de la Hotline pour améliorer automatiquement le triage des futurs tickets.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => { setSettingsOpen((v) => !v); if (!settingsOpen) setTimeout(() => document.getElementById('ai-weekly-settings')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60); }}
            className="px-4 py-2.5 rounded-xl text-xs font-bold border border-outline-variant/40 bg-surface-container-lowest text-on-surface hover:bg-surface-container transition-all flex items-center gap-2"
          >
            <SlidersHorizontal className="w-4 h-4" />
            Paramètres
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-lg shadow-purple-500/20 flex items-center gap-2 transition-all disabled:opacity-50"
          >
            <Sparkles className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
            {generating ? 'Analyse...' : 'Générer un rapport'}
          </button>
        </div>
      </div>

      {statsError && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 flex items-center justify-between gap-4 text-xs">
          <span className="text-red-600 dark:text-red-400 font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Impossible de charger les statistiques d'apprentissage.
          </span>
          <button onClick={loadAll} className="px-3 py-1.5 rounded-lg font-bold bg-red-600 hover:bg-red-700 text-white transition-all">
            Réessayer
          </button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-surface-container-low animate-pulse border border-outline-variant/20" />
          ))}
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Corrections (30 j)', value: stats?.corrections30d ?? 0, sub: `${stats?.totalCorrections ?? 0} au total`, icon: PenTool, color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400' },
              { label: 'Règles actives', value: `${stats?.activeRules ?? 0}/${stats?.totalRules ?? 0}`, sub: 'triage automatique', icon: SlidersHorizontal, color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
              { label: 'Rapports approuvés', value: stats?.approvedReports ?? 0, sub: `${stats?.pendingReports ?? 0} en attente`, icon: CheckCircle2, color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
              {
                label: "Taux d'approbation",
                value: stats?.approvalRate !== null && stats?.approvalRate !== undefined ? `${stats.approvalRate}%` : '—',
                sub: `${stats?.rejectedReports ?? 0} rejeté(s)`,
                icon: TrendingUp, color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
              },
            ].map((card) => (
              <div key={card.label} className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5 flex items-center gap-4 shadow-sm">
                <div className={`p-2.5 rounded-xl ${card.color}`}>
                  <card.icon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-black text-on-surface truncate">{card.value}</p>
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider truncate">{card.label}</p>
                  <p className="text-[10px] text-on-surface-variant/60 truncate">{card.sub}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Graphiques */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-on-surface-variant mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-purple-500" />
                Tendance hebdomadaire (8 semaines)
              </h3>
              {hasTrendData ? (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={trendData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradWeeklyTrend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }} axisLine={false} tickLine={false} allowDecimals={false} width={40} />
                    <Tooltip content={<ChartTooltip unit="corrections" />} />
                    <Area type="monotone" dataKey="count" stroke="#8b5cf6" strokeWidth={2} fill="url(#gradWeeklyTrend)" dot={{ r: 3, fill: '#8b5cf6' }} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[220px] flex flex-col items-center justify-center gap-2 text-on-surface-variant/60">
                  <BarChart3 className="w-8 h-8" />
                  <p className="text-xs font-semibold">Aucune correction sur les 8 dernières semaines</p>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-on-surface-variant mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-indigo-500" />
                Corrections par champ (30 j)
              </h3>
              {fieldData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={fieldData} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" horizontal={false} />
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis
                      type="category" dataKey="field" width={90}
                      tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }}
                      axisLine={false} tickLine={false}
                    />
                    <Tooltip content={<ChartTooltip unit="corrections" />} cursor={{ fill: 'var(--color-surface-container)' }} />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={22}>
                      {fieldData.map((entry, i) => (
                        <Cell key={entry.field} fill={FIELD_COLORS[i % FIELD_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[220px] flex flex-col items-center justify-center gap-2 text-on-surface-variant/60">
                  <PenTool className="w-8 h-8" />
                  <p className="text-xs font-semibold">Aucune correction sur les 30 derniers jours</p>
                </div>
              )}
            </div>
          </div>

          {/* Learning pipeline */}
          <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-on-surface-variant mb-5">Pipeline d'apprentissage</h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { step: 1, label: 'Corrections Hotline', desc: `${stats?.totalCorrections ?? 0} corrections`, icon: PenTool, color: 'text-purple-500' },
                { step: 2, label: 'Détection de Patterns', desc: `${stats?.correctionsByField?.length ?? 0} champs distincts`, icon: BarChart3, color: 'text-blue-500' },
                { step: 3, label: 'Génération de Règles', desc: `${stats?.totalRules ?? 0} règles créées`, icon: SlidersHorizontal, color: 'text-indigo-500' },
                { step: 4, label: 'Validation', desc: `${stats?.approvedReports ?? 0} rapports approuvés`, icon: CheckCircle2, color: 'text-emerald-500' },
                { step: 5, label: 'Triage amélioré', desc: `${stats?.activeRules ?? 0} règles actives`, icon: Sparkles, color: 'text-amber-500' },
              ].map((s, i) => (
                <div key={s.step} className="relative flex flex-col items-center text-center gap-2 p-4 rounded-xl bg-surface-container/60 border border-outline-variant/20">
                  {i < 4 && (
                    <ArrowRight className="hidden sm:block absolute -right-[14px] top-1/2 -translate-y-1/2 w-5 h-5 text-outline z-10" />
                  )}
                  <div className={`p-2 rounded-lg ${s.color}/10 ${s.color}`}>
                    <s.icon className="w-5 h-5" />
                  </div>
                  <span className="text-[11px] font-bold text-on-surface">{s.label}</span>
                  <span className="text-[10px] text-on-surface-variant font-medium">{s.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent corrections */}
          {stats?.recentCorrections?.length > 0 && (
            <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-on-surface-variant mb-4">Dernières corrections (30 jours)</h3>
              <div className="space-y-2">
                {stats.recentCorrections.slice(0, 8).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => c.ticketId && navigate(`/tickets/${c.ticketId}`)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-outline-variant/20 bg-surface-container-low/40 text-xs hover:bg-surface-container/60 transition-all text-left"
                  >
                    <span className="px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 font-bold font-mono text-[10px] shrink-0 uppercase">{c.fieldName}</span>
                    <span className="text-on-surface-variant truncate min-w-0 flex-1">
                      {c.ticket?.title || `Ticket #${c.ticketId}`}
                    </span>
                    <span className="text-on-surface-variant/60 shrink-0">{c.oldValue || '—'}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-on-surface-variant/40 shrink-0" />
                    <span className="font-semibold text-on-surface shrink-0 max-w-[120px] truncate">{c.newValue}</span>
                    <span className="text-on-surface-variant/40 shrink-0 hidden sm:block">{new Date(c.createdAt).toLocaleDateString('fr-FR')}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Paramètres de génération ── */}
      <div id="ai-weekly-settings" className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm overflow-hidden">
        <button
          onClick={() => setSettingsOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-4 px-6 py-4 hover:bg-surface-container/50 transition-all"
        >
          <span className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider text-on-surface-variant">
            <CalendarClock className="w-4 h-4 text-primary" />
            Paramètres de génération
            {cfg && (
              <span className="text-[10px] font-semibold text-on-surface-variant/60 normal-case">
                {cfg.aiWeeklyAutoEnabled
                  ? `auto : ${WEEKDAY_LABELS[cfg.aiWeeklyDay]} à ${String(cfg.aiWeeklyHour).padStart(2, '0')}h`
                  : 'génération auto désactivée'}
              </span>
            )}
          </span>
          <ArrowRight className={`w-4 h-4 text-on-surface-variant transition-transform ${settingsOpen ? 'rotate-90' : ''}`} />
        </button>

        {settingsOpen && cfg && (
          <div className="px-6 pb-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-surface-container/60 border border-outline-variant/20 sm:col-span-2 lg:col-span-1">
                <div>
                  <p className="text-xs font-bold text-on-surface">Génération automatique</p>
                  <p className="text-[10px] text-on-surface-variant">Rapport créé selon le jour et l'heure ci-dessous</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!cfg.aiWeeklyAutoEnabled}
                  onClick={() => setCfgField('aiWeeklyAutoEnabled', !cfg.aiWeeklyAutoEnabled)}
                  className={`relative w-11 h-6 rounded-full transition-all shrink-0 ${cfg.aiWeeklyAutoEnabled ? 'bg-primary' : 'bg-outline-variant/60'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${cfg.aiWeeklyAutoEnabled ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>

              <label className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Jour de génération</span>
                <select
                  value={cfg.aiWeeklyDay}
                  onChange={(e) => setCfgField('aiWeeklyDay', Number(e.target.value))}
                  className="w-full bg-surface border border-outline-variant/40 rounded-xl px-3 py-2 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                >
                  {WEEKDAY_LABELS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </label>

              <label className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Heure (serveur, UTC)</span>
                <input
                  type="number" min={0} max={23} step={1}
                  value={cfg.aiWeeklyHour}
                  onChange={(e) => setCfgField('aiWeeklyHour', Number(e.target.value))}
                  className="w-full bg-surface border border-outline-variant/40 rounded-xl px-3 py-2 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Fenêtre d'analyse (jours)</span>
                <input
                  type="number" min={1} max={90} step={1}
                  value={cfg.aiWeeklyWindowDays}
                  onChange={(e) => setCfgField('aiWeeklyWindowDays', Number(e.target.value))}
                  className="w-full bg-surface border border-outline-variant/40 rounded-xl px-3 py-2 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Corrections min. par règle</span>
                <input
                  type="number" min={1} max={50} step={1}
                  value={cfg.aiWeeklyMinOccurrences}
                  onChange={(e) => setCfgField('aiWeeklyMinOccurrences', Number(e.target.value))}
                  className="w-full bg-surface border border-outline-variant/40 rounded-xl px-3 py-2 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Rejets min. (règle domaine)</span>
                <input
                  type="number" min={2} max={100} step={1}
                  value={cfg.aiWeeklyDomainThreshold}
                  onChange={(e) => setCfgField('aiWeeklyDomainThreshold', Number(e.target.value))}
                  className="w-full bg-surface border border-outline-variant/40 rounded-xl px-3 py-2 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Confiance minimale (0 → 1)</span>
                <input
                  type="number" min={0} max={1} step={0.05}
                  value={cfg.aiWeeklyConfidenceThreshold}
                  onChange={(e) => setCfgField('aiWeeklyConfidenceThreshold', Number(e.target.value))}
                  className="w-full bg-surface border border-outline-variant/40 rounded-xl px-3 py-2 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </label>
            </div>

            <div className="flex justify-end mt-4">
              <button
                onClick={saveSettings}
                disabled={!cfgDirty || savingSettings}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-md shadow-purple-500/20 flex items-center gap-2 transition-all disabled:opacity-40"
              >
                <Save className={`w-3.5 h-3.5 ${savingSettings ? 'animate-spin' : ''}`} />
                {savingSettings ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Règles de triage (issues de l'apprentissage + manuelles) ── */}
      <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm overflow-hidden">
        <button
          onClick={() => setRulesOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-4 px-6 py-4 hover:bg-surface-container/50 transition-all"
        >
          <span className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider text-on-surface-variant">
            <SlidersHorizontal className="w-4 h-4 text-primary" />
            Règles de triage
            <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">{rules.length}</span>
            {rules.filter((r) => r.isActive).length !== rules.length && (
              <span className="text-[10px] font-semibold text-on-surface-variant/60 normal-case">({rules.filter((r) => r.isActive).length} active(s))</span>
            )}
          </span>
          <ArrowRight className={`w-4 h-4 text-on-surface-variant transition-transform ${rulesOpen ? 'rotate-90' : ''}`} />
        </button>

        {rulesOpen && (
          <div className="px-6 pb-6 space-y-3">
            {/* Barre de recherche */}
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-on-surface-variant/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
              <input
                type="text"
                placeholder="Rechercher par label, valeur, domaine, catégorie…"
                value={rulesSearch}
                onChange={(e) => setRulesSearch(e.target.value)}
                className="w-full bg-surface border border-outline-variant/40 rounded-xl pl-9 pr-8 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
              />
              {rulesSearch && (
                <button onClick={() => setRulesSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50 hover:text-on-surface">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              )}
            </div>

            {/* Filtres actives / inactives / anti-spam */}
            <div className="flex items-center gap-2 flex-wrap">
              {[['all', 'Toutes'], ['active', 'Actives'], ['inactive', 'Inactives'], ['spam', '🚫 Anti-spam']].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setRulesFilter(value)}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all ${
                    rulesFilter === value
                      ? value === 'spam' ? 'bg-red-600 text-white shadow-md' : 'bg-primary text-white shadow-md'
                      : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {(() => {
              const q = rulesSearch.toLowerCase().trim();
              const filtered = rules.filter((r) => {
                const matchStatus = rulesFilter === 'all' || (rulesFilter === 'active' ? r.isActive : rulesFilter === 'inactive' ? !r.isActive : rulesFilter === 'spam' ? r.isSpam : true);
                const matchSearch = !q || [
                  r.label, r.matchValue, r.category, r.matchField, r.matchType, r.ticketPriority
                ].some((v) => v && String(v).toLowerCase().includes(q));
                return matchStatus && matchSearch;
              });
              if (filtered.length === 0) return (
                <p className="text-xs text-on-surface-variant py-6 text-center">
                  {q || rulesFilter !== 'all' ? 'Aucune règle ne correspond à cette recherche.' : 'Aucune règle dans cette catégorie.'}
                </p>
              );
              return (
                <div className="space-y-2">
                  {filtered
                    .map((rule) => {
                      const isSpamRule = rule.isSpam === true;
                      return (
                        <div
                          key={rule.id}
                          className={`p-3.5 rounded-xl border text-xs ${
                            rule.isActive
                              ? 'border-outline-variant/20 bg-surface-container-low/40'
                              : 'border-outline-variant/10 bg-surface-container-low/20 opacity-60'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1 space-y-1.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-on-surface">{rule.label}</span>
                                {isSpamRule && (
                                  <span className="px-1.5 py-0.5 rounded-md bg-red-500/10 text-red-600 dark:text-red-400 text-[9px] font-bold uppercase">Anti-spam</span>
                                )}
                                <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase ${
                                  rule.isActive ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-surface-container text-on-surface-variant'
                                }`}>{rule.isActive ? 'Active' : 'Inactive'}</span>
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-on-surface-variant">
                                <span className="px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold font-mono">
                                  {MATCH_FIELD_LABELS[rule.matchField] || rule.matchField}
                                </span>
                                <span>{MATCH_TYPE_LABELS[rule.matchType] || rule.matchType}</span>
                                <span className="font-mono font-semibold text-on-surface bg-surface-container px-1.5 py-0.5 rounded-md">« {rule.matchValue} »</span>
                                {rule.category && <span className="px-1.5 py-0.5 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 font-semibold">Catégorie : {rule.category}</span>}
                                {rule.ticketPriority && <span className="px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold">Priorité : {rule.ticketPriority}</span>}
                                {rule.teamName && <span className="px-1.5 py-0.5 rounded-md bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-semibold">Équipe : {rule.teamName}</span>}
                                {rule.isSpam && <span className="text-red-500 font-semibold">→ marqué spam</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => toggleRule(rule.id)}
                                disabled={actionId === `rule-${rule.id}`}
                                title={rule.isActive ? 'Désactiver' : 'Activer'}
                                className="p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all disabled:opacity-40"
                              >
                                <Power className={`w-3.5 h-3.5 ${rule.isActive ? 'text-emerald-500' : ''}`} />
                              </button>
                              <button
                                onClick={() => setDeleteRuleId(rule.id)}
                                disabled={actionId === `rule-${rule.id}`}
                                title="Supprimer"
                                className="p-2 rounded-lg text-on-surface-variant hover:text-red-500 hover:bg-red-500/10 transition-all disabled:opacity-40"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Weekly reports */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-on-surface-variant flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            Rapports hebdomadaires
          </h2>
          {reports.length > 0 && (
            <button onClick={loadAll} className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all" title="Rafraîchir">
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-20 rounded-2xl bg-surface-container-low animate-pulse border border-outline-variant/20" />
            ))}
          </div>
        ) : reports.length === 0 ? (
          <div className="p-10 text-center rounded-2xl border border-dashed border-outline-variant/40 bg-surface-container-lowest space-y-3">
            <Brain className="w-10 h-10 text-outline mx-auto" />
            <p className="text-sm font-bold text-on-surface">Aucun rapport pour le moment</p>
            <p className="text-xs text-on-surface-variant max-w-md mx-auto">
              Généré automatiquement chaque semaine (voir Paramètres) ou manuellement via le bouton ci-dessus.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {reports.map((r) => {
              const ruleCount = Array.isArray(r.proposedRules) ? r.proposedRules.length : 0;
              const isPending = r.status === 'PENDING';
              const isApproved = r.status === 'APPROVED';
              const isRejected = r.status === 'REJECTED';

              return (
                <button
                  key={r.id}
                  onClick={() => { setDetail(r); setReviewNote(''); }}
                  className="w-full rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5 shadow-sm flex items-center justify-between gap-4 hover:border-primary/40 hover:bg-surface-container/40 transition-all text-left"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`p-2 rounded-xl ${
                      isApproved ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                      isRejected ? 'bg-red-500/10 text-red-600 dark:text-red-400' :
                      'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    }`}>
                      {isApproved ? <CheckCircle2 className="w-4 h-4" /> :
                       isRejected ? <XCircle className="w-4 h-4" /> :
                       <Clock className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-on-surface truncate">
                        {new Date(r.startDate).toLocaleDateString('fr-FR')} → {new Date(r.endDate).toLocaleDateString('fr-FR')}
                      </p>
                      <p className="text-[10px] font-medium text-on-surface-variant">
                        {r.totalCorrections} corrections • {r.totalRejections} rejets • {ruleCount} règle(s) proposée(s)
                        {isPending && ' — cliquez pour voir le détail'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                      isApproved ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' :
                      isRejected ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' :
                      'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                    }`}>
                      {isApproved ? 'Approuvé' : isRejected ? 'Rejeté' : 'En attente'}
                    </span>
                    <span className="text-on-surface-variant/50 flex items-center gap-1 text-[10px] font-bold uppercase">
                      <Eye className="w-3.5 h-3.5" /> Voir
                      <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Modale de détail d'un rapport */}
      <ReportDetailModal
        report={detail}
        onClose={() => setDetail(null)}
        onApprove={() => setConfirmApproveId(detail?.id)}
        onReject={() => handleReject(detail?.id)}
        busy={actionId === detail?.id}
        note={reviewNote}
        setNote={setReviewNote}
      />

      {/* Confirmation d'approbation : la modale détail montre déjà tout, ici on valide l'activation */}
      <ConfirmDialog
        open={confirmApproveId !== null}
        title="Activer les règles proposées ?"
        message={
          detail
            ? `Les ${(Array.isArray(detail.proposedRules) ? detail.proposedRules : []).length} règle(s) de ce rapport seront créées et activées immédiatement dans le triage automatique. Les règles ciblant un domaine interne de l'organisation seront ignorées.`
            : ''
        }
        confirmLabel="Approuver"
        loading={actionId === confirmApproveId}
        onConfirm={() => handleApprove(confirmApproveId)}
        onCancel={() => setConfirmApproveId(null)}
      />

      {/* Confirmation de suppression de règle */}
      <ConfirmDialog
        open={deleteRuleId !== null}
        title="Supprimer la règle"
        message="Supprimer définitivement cette règle de triage ? Le triage reviendra au comportement précédent pour ces tickets."
        confirmLabel="Supprimer"
        danger
        loading={actionId === `rule-${deleteRuleId}`}
        onConfirm={confirmDeleteRule}
        onCancel={() => setDeleteRuleId(null)}
      />
    </div>
  );
}
