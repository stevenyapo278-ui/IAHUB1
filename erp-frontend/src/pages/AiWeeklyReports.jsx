import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Brain, Sparkles, CheckCircle2, XCircle, Clock, RefreshCw,
  SlidersHorizontal, Check, AlertTriangle, ArrowRight, PenTool, BarChart3,
  Trash2, Power
} from 'lucide-react';
import api from '../api/client';

// Libellés lisibles des champs/valeurs de correspondance des règles de triage
const MATCH_FIELD_LABELS = {
  subject: 'Sujet', body: 'Corps', subject_or_body: 'Sujet ou corps',
  from: 'Expéditeur', sentiment: 'Sentiment', time_window: 'Créneau', domain: 'Domaine',
};
const MATCH_TYPE_LABELS = {
  contains: 'contient', regex: 'expression régulière', equals: 'égal à',
  starts_with: 'commence par', ai_semantic: 'sémantique IA',
};

export default function AiWeeklyReports() {
  const [reports, setReports] = useState([]);
  const [stats, setStats] = useState(null);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [actionId, setActionId] = useState(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rulesFilter, setRulesFilter] = useState('all'); // all | active | inactive

  async function loadAll() {
    setLoading(true);
    try {
      const [statsRes, reportsRes, rulesRes] = await Promise.all([
        api.get('/ai-weekly-reports/stats').catch(() => null),
        api.get('/ai-weekly-reports'),
        api.get('/ai-weekly-reports/rules').catch(() => []),
      ]);
      if (statsRes) setStats(statsRes.data);
      setReports(reportsRes.data);
      if (Array.isArray(rulesRes.data)) setRules(rulesRes.data);
    } catch (err) {
      toast.error('Erreur lors du chargement');
    } finally {
      setLoading(false);
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

  async function deleteRule(id) {
    if (!window.confirm('Supprimer définitivement cette règle de triage ?')) return;
    setActionId(`rule-${id}`);
    try {
      await api.delete(`/ai-weekly-reports/rules/${id}`);
      setRules((prev) => prev.filter((r) => r.id !== id));
      toast.success('Règle supprimée');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setActionId(null);
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await api.post('/ai-weekly-reports/generate');
      if (res.data.message) {
        toast.info(res.data.message);
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
      const res = await api.post(`/ai-weekly-reports/${id}/approve`);
      toast.success(`${res.data.createdRulesCount} règle(s) activée(s) !`);
      loadAll();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setActionId(null);
    }
  }

  async function handleReject(id) {
    setActionId(id);
    try {
      await api.post(`/ai-weekly-reports/${id}/reject`);
      toast.success('Rapport rejeté');
      loadAll();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setActionId(null);
    }
  }

  const maxFieldCount = stats?.correctionsByField?.length
    ? Math.max(...stats.correctionsByField.map((c) => c.count), 1)
    : 1;

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
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="px-5 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-lg shadow-purple-500/20 flex items-center gap-2 transition-all disabled:opacity-50 shrink-0"
        >
          <Sparkles className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
          {generating ? 'Analyse...' : 'Générer un rapport'}
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-surface-container-low animate-pulse border border-outline-variant/20" />
          ))}
        </div>
      ) : (
        <>
          {/* Stats cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Corrections Hotline', value: stats?.totalCorrections ?? 0, icon: PenTool, color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400' },
              { label: 'Règles actives', value: `${stats?.activeRules ?? 0}/${stats?.totalRules ?? 0}`, icon: SlidersHorizontal, color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
              { label: 'Rapports approuvés', value: stats?.approvedReports ?? 0, icon: CheckCircle2, color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
              { label: 'Précision IA', value: `${stats?.accuracyRate ?? 100}%`, icon: Sparkles, color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
            ].map((card) => (
              <div key={card.label} className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5 flex items-center gap-4 shadow-sm">
                <div className={`p-2.5 rounded-xl ${card.color}`}>
                  <card.icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-2xl font-black text-on-surface">{card.value}</p>
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">{card.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Learning pipeline */}
          <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-on-surface-variant mb-5">Pipeline d'apprentissage</h3>
            <div className="grid grid-cols-5 gap-3">
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
                {stats.recentCorrections.slice(0, 10).map((c) => (
                  <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl border border-outline-variant/20 bg-surface-container-low/40 text-xs">
                    <span className="px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 font-bold font-mono text-[10px] shrink-0 uppercase">{c.fieldName}</span>
                    <span className="text-on-surface-variant truncate min-w-0 flex-1">
                      {c.ticket?.title || `Ticket #${c.ticketId}`}
                    </span>
                    <span className="text-on-surface-variant/60 shrink-0">{c.oldValue || '—'}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-on-surface-variant/40 shrink-0" />
                    <span className="font-semibold text-on-surface shrink-0 max-w-[120px] truncate">{c.newValue}</span>
                    <span className="text-on-surface-variant/40 shrink-0">{new Date(c.createdAt).toLocaleDateString('fr-FR')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Corrections by field */}
          {stats?.correctionsByField?.length > 0 && (
            <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-on-surface-variant mb-4">Répartition par champ</h3>
              <div className="space-y-2">
                {stats.correctionsByField.map((c) => (
                  <div key={c.field} className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-on-surface w-24 shrink-0 uppercase">{c.field}</span>
                    <div className="flex-1 h-5 rounded-full bg-surface-container overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-purple-500 to-indigo-500 transition-all duration-500"
                        style={{ width: `${(c.count / maxFieldCount) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs font-bold text-on-surface w-8 text-right">{c.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

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
            {/* Filtre actives / inactives */}
            <div className="flex items-center gap-2">
              {[['all', 'Toutes'], ['active', 'Actives'], ['inactive', 'Inactives']].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setRulesFilter(value)}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all ${
                    rulesFilter === value
                      ? 'bg-primary text-white shadow-md'
                      : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {rules.filter((r) => rulesFilter === 'all' || (rulesFilter === 'active' ? r.isActive : !r.isActive)).length === 0 ? (
              <p className="text-xs text-on-surface-variant py-6 text-center">Aucune règle dans cette catégorie.</p>
            ) : (
              <div className="space-y-2">
                {rules
                  .filter((r) => rulesFilter === 'all' || (rulesFilter === 'active' ? r.isActive : !r.isActive))
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
                              onClick={() => deleteRule(rule.id)}
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
            )}
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
            <button onClick={loadAll} className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all">
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
              Généré automatiquement chaque semaine ou manuellement via le bouton ci-dessus.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {reports.map((r) => {
              const rules = Array.isArray(r.proposedRules) ? r.proposedRules : [];
              const isPending = r.status === 'PENDING';
              const isApproved = r.status === 'APPROVED';
              const isRejected = r.status === 'REJECTED';

              return (
                <div key={r.id} className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5 shadow-sm flex items-center justify-between gap-4">
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
                        {r.totalCorrections} corrections • {r.totalRejections} rejets • {rules.length} règle(s)
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

                    {isPending && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleReject(r.id)}
                          disabled={actionId === r.id}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-all"
                        >
                          Rejeter
                        </button>
                        <button
                          onClick={() => handleApprove(r.id)}
                          disabled={actionId === r.id}
                          className="px-4 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-500/20 transition-all flex items-center gap-1.5"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Approuver ({rules.length})
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
