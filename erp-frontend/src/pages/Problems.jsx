import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle, Plus, Search, RefreshCw, Filter, X, ChevronDown,
  Clock, CheckCircle2, Radio, AlertCircle, User, Users, Tag, Calendar,
  Link2, Eye, Flame, Info, ArrowDown, Sparkles,
} from 'lucide-react';
import api from '../api/client';
import { hasPermission } from '../utils/permissions';
import { useAuth } from '../context/AuthContext';
import useSystemSettings from '../hooks/useSystemSettings';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';

const STATUS_OPTIONS = ['NEW', 'IN_PROGRESS', 'ASSIGNED', 'PLANNED', 'WAITING', 'SOLVED', 'CLOSED', 'OBSERVED'];
const STATUS_LABELS = {
  NEW: 'Nouveau', IN_PROGRESS: 'En cours', ASSIGNED: 'Attribué', PLANNED: 'Planifié',
  WAITING: 'En attente', SOLVED: 'Résolu', CLOSED: 'Fermé', OBSERVED: 'Observé',
};
const PRIORITY_OPTIONS = ['P1', 'P2', 'P3', 'P4'];
const PRIORITY_LABELS = { P1: 'Critique', P2: 'Haute', P3: 'Moyenne', P4: 'Basse' };

const STATUS_CONFIG = {
  NEW: { bg: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400 border border-blue-200 dark:border-blue-500/25', Icon: Sparkles },
  IN_PROGRESS: { bg: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/25', Icon: Radio },
  ASSIGNED: { bg: 'bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400 border border-purple-200 dark:border-purple-500/25', Icon: User },
  PLANNED: { bg: 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400 border border-violet-200 dark:border-violet-500/25', Icon: Calendar },
  WAITING: { bg: 'bg-amber-50 text-amber-800 dark:bg-yellow-500/15 dark:text-yellow-400 border border-amber-300 dark:border-yellow-500/25', Icon: Clock },
  SOLVED: { bg: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/25', Icon: CheckCircle2 },
  CLOSED: { bg: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-400 border border-slate-300 dark:border-slate-500/25', Icon: Clock },
  OBSERVED: { bg: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-500/25', Icon: Eye },
};

const PRIORITY_CONFIG = {
  P1: { label: 'P1', bg: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400 border border-red-200 dark:border-red-500/25', Icon: Flame },
  P2: { label: 'P2', bg: 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 border border-orange-200 dark:border-orange-500/25', Icon: AlertTriangle },
  P3: { label: 'P3', bg: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400 border border-amber-300 dark:border-amber-500/25', Icon: Info },
  P4: { label: 'P4', bg: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400 border border-blue-200 dark:border-blue-500/25', Icon: ArrowDown },
};

const inputCls = 'px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.NEW;
  const Icon = cfg.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${cfg.bg}`}>
      <Icon className="w-3 h-3" />
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const cfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.P3;
  const Icon = cfg.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${cfg.bg}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function ProblemRow({ problem, onClick }) {
  const countTickets = problem._count?.tickets || 0;
  return (
    <tr
      onClick={() => onClick(problem.id)}
      className="hover:bg-surface-container-high/50 cursor-pointer transition-colors group"
    >
      <td className="px-4 py-3 font-semibold text-sm text-on-surface group-hover:text-primary truncate max-w-[300px]">
        {problem.title}
      </td>
      <td className="px-4 py-3"><StatusBadge status={problem.status} /></td>
      <td className="px-4 py-3"><PriorityBadge priority={problem.priority} /></td>
      <td className="px-4 py-3 text-xs text-on-surface-variant">
        {problem.category || '—'}
      </td>
      <td className="px-4 py-3">
        {problem.assignedTo ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-on-surface">
            <span className="w-5 h-5 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[9px] font-bold">
              {problem.assignedTo.fullName?.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
            </span>
            {problem.assignedTo.fullName}
          </span>
        ) : (
          <span className="text-xs text-on-surface-variant italic">Non assigné</span>
        )}
      </td>
      <td className="px-4 py-3 text-center">
        <span className="inline-flex items-center gap-1 text-xs text-on-surface-variant">
          <Link2 className="w-3 h-3" />
          {countTickets}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-on-surface-variant whitespace-nowrap">
        {new Date(problem.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
      </td>
    </tr>
  );
}

export default function Problems() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const settings = useSystemSettings();
  const canManage = hasPermission(user, 'tickets.manage', settings);

  const [problems, setProblems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [stats, setStats] = useState({ total: 0, open: 0, solved: 0, closed: 0 });
  const [showCreateModal, setShowCreateModal] = useState(false);

  const loadProblems = useCallback(() => {
    setLoading(true);
    const params = { page, limit: 30 };
    if (search) params.search = search;
    if (statusFilter) params.status = statusFilter;
    if (priorityFilter) params.priority = priorityFilter;

    api.get('/problems', { params })
      .then(({ data }) => { setProblems(data.problems || []); setTotal(data.total || 0); })
      .catch(() => toast.error('Erreur chargement problèmes'))
      .finally(() => setLoading(false));
  }, [page, search, statusFilter, priorityFilter]);

  const loadStats = useCallback(() => {
    api.get('/problems/stats').then(({ data }) => setStats(data)).catch(() => {});
  }, []);

  useEffect(() => { loadProblems(); }, [loadProblems]);
  useEffect(() => { loadStats(); }, [loadStats]);

  useEffect(() => { setPage(1); }, [search, statusFilter, priorityFilter]);

  const totalPages = Math.ceil(total / 30);

  return (
    <div className="space-y-5 p-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-on-surface flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-amber-500" />
            Problèmes
          </h1>
          <p className="text-sm text-on-surface-variant mt-0.5">
            {total} problème(s) — causes racines et incidents récurrents
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-bold flex items-center gap-2 hover:opacity-90 cursor-pointer transition-opacity"
          >
            <Plus className="w-4 h-4" />
            Nouveau problème
          </button>
        )}
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: stats.total, color: 'text-on-surface' },
          { label: 'Ouverts', value: stats.open, color: 'text-amber-600 dark:text-amber-400' },
          { label: 'Résolus', value: stats.solved, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Fermés', value: stats.closed, color: 'text-slate-600 dark:text-slate-400' },
        ].map((s) => (
          <div key={s.label} className="bg-surface-container rounded-xl p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-on-surface-variant">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Search + Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface/30" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un problème..."
            className={`${inputCls} w-full pl-9`}
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`px-3 py-2 rounded-xl border text-sm font-medium flex items-center gap-1.5 cursor-pointer transition-colors ${
            showFilters || statusFilter || priorityFilter
              ? 'bg-primary/10 border-primary/30 text-primary'
              : 'border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high'
          }`}
        >
          <Filter className="w-4 h-4" />
          Filtres
        </button>
        <button onClick={loadProblems}
          className="p-2 rounded-xl border border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high cursor-pointer transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="bg-surface-container rounded-xl p-3 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <span className="text-xs text-on-surface-variant font-medium">Statut :</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={`${inputCls} py-1.5 text-xs pr-8`}
            >
              <option value="">Tous</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-on-surface-variant font-medium">Priorité :</span>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className={`${inputCls} py-1.5 text-xs pr-8`}
            >
              <option value="">Toutes</option>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>{p} — {PRIORITY_LABELS[p]}</option>
              ))}
            </select>
          </div>
          {(statusFilter || priorityFilter) && (
            <button
              onClick={() => { setStatusFilter(''); setPriorityFilter(''); }}
              className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Effacer
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-surface-container rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-outline-variant/40">
              <th className="px-4 py-3 text-left text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Titre</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Statut</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Priorité</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Catégorie</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Assigné à</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Tickets</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Créé le</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/20">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto text-on-surface-variant" />
                </td>
              </tr>
            ) : problems.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState icon={AlertTriangle} title="Aucun problème" description="Aucun problème enregistré pour le moment." />
                </td>
              </tr>
            ) : (
              problems.map((p) => (
                <ProblemRow key={p.id} problem={p} onClick={(id) => navigate(`/problems/${id}`)} />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-outline-variant/60 disabled:opacity-40 cursor-pointer"
          >
            Précédent
          </button>
          <span className="text-xs text-on-surface-variant">
            Page {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-outline-variant/60 disabled:opacity-40 cursor-pointer"
          >
            Suivant
          </button>
        </div>
      )}

      {/* Create modal */}
      {showCreateModal && (
        <CreateProblemModal onClose={() => setShowCreateModal(false)} onCreated={(id) => { setShowCreateModal(false); navigate(`/problems/${id}`); loadStats(); }} />
      )}
    </div>
  );
}

function CreateProblemModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ title: '', description: '', priority: 'P3', urgency: 'MEDIUM', impact: 'MEDIUM', category: '' });
  const [submitting, setSubmitting] = useState(false);
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    api.get('/users').then(({ data }) => setUsers(data.users || data || [])).catch(() => {});
    api.get('/categories').then(({ data }) => setCategories(Array.isArray(data) ? data : data.categories || [])).catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.description.trim()) return toast.error('Titre et description requis');
    setSubmitting(true);
    try {
      const { data } = await api.post('/problems', form);
      toast.success('Problème créé');
      onCreated(data.id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur création');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-on-surface">Nouveau problème</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-container-high cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">Titre *</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className={`${inputCls} w-full`} placeholder="Ex: Panne réseau récurrente site Abidjan" />
          </div>
          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">Description *</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={4} className={`${inputCls} w-full resize-none`} placeholder="Description détaillée du problème racine..." />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">Priorité</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}
                className={`${inputCls} w-full text-xs`}>
                {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p} — {PRIORITY_LABELS[p]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">Urgence</label>
              <select value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })}
                className={`${inputCls} w-full text-xs`}>
                {['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'].map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">Impact</label>
              <select value={form.impact} onChange={(e) => setForm({ ...form, impact: e.target.value })}
                className={`${inputCls} w-full text-xs`}>
                {['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'].map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">Catégorie</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
              className={`${inputCls} w-full text-xs`}>
              <option value="">Aucune</option>
              {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-xl border border-outline-variant/60 text-sm font-medium cursor-pointer hover:bg-surface-container-high">
              Annuler
            </button>
            <button type="submit" disabled={submitting}
              className="px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-bold cursor-pointer hover:opacity-90 disabled:opacity-50">
              {submitting ? <RefreshCw className="w-4 h-4 animate-spin inline" /> : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
