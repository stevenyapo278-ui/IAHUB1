import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle, Plus, Search, RefreshCw, Filter, X, ChevronDown,
  ChevronLeft, ChevronRight,
  Clock, CheckCircle2, Radio, AlertCircle, User, Users, Tag, Calendar,
  Link2, Eye, Flame, Info, ArrowDown, Sparkles,
} from 'lucide-react';

function PaginationButtons({ page, totalPages, onPageChange }) {
  const [jumpValue, setJumpValue] = useState('');
  const jumpRef = useRef(null);

  const pages = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const result = [];
    result.push(1);
    if (page > 3) result.push('...');
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);
    for (let i = start; i <= end; i++) result.push(i);
    if (page < totalPages - 2) result.push('...');
    result.push(totalPages);
    return result;
  }, [page, totalPages]);

  function handleKeyDown(e) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onPageChange(Math.max(1, page - 1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onPageChange(Math.min(totalPages, page + 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onPageChange(1);
    } else if (e.key === 'End') {
      e.preventDefault();
      onPageChange(totalPages);
    }
  }

  function handleJump(e) {
    e.preventDefault();
    const val = parseInt(jumpValue, 10);
    if (!isNaN(val) && val >= 1 && val <= totalPages && val !== page) {
      onPageChange(val);
    }
    setJumpValue('');
    jumpRef.current?.blur();
  }

  const btnBase = 'h-10 min-w-[40px] flex items-center justify-center rounded-lg text-xs font-semibold transition-all duration-150 active:scale-95';
  const btnEnabled = 'text-muted-foreground hover:bg-surface-muted hover:text-foreground';
  const btnDisabled = 'text-muted-foreground/30 cursor-not-allowed';
  const btnActive = 'bg-primary text-primary-foreground shadow-sm shadow-primary/20';

  return (
    <div className="flex items-center gap-2" onKeyDown={handleKeyDown} role="navigation" aria-label="Pagination">
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(1)}
          disabled={page <= 1}
          aria-label="Première page"
          className={`${btnBase} px-1.5 ${page <= 1 ? btnDisabled : btnEnabled}`}
        >
          <ChevronsLeft className="w-4 h-4" />
        </button>
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          aria-label="Page précédente"
          className={`${btnBase} px-1.5 ${page <= 1 ? btnDisabled : btnEnabled}`}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`dots-${i}`} className="w-8 h-10 flex items-center justify-center text-xs text-muted-foreground/40">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              aria-label={`Page ${p}`}
              aria-current={p === page ? 'page' : undefined}
              className={`${btnBase} px-1 ${p === page ? btnActive : btnEnabled}`}
            >
              {p}
            </button>
          )
        )}

        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          aria-label="Page suivante"
          className={`${btnBase} px-1.5 ${page >= totalPages ? btnDisabled : btnEnabled}`}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={page >= totalPages}
          aria-label="Dernière page"
          className={`${btnBase} px-1.5 ${page >= totalPages ? btnDisabled : btnEnabled}`}
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
      </div>

      {/* Jump-to */}
      <form onSubmit={handleJump} className="flex items-center gap-1.5 ml-2">
        <span className="text-[11px] text-muted-foreground">→</span>
        <input
          ref={jumpRef}
          type="number"
          min={1}
          max={totalPages}
          value={jumpValue}
          onChange={(e) => setJumpValue(e.target.value)}
          placeholder={`1–${totalPages}`}
          className="w-16 h-8 px-2 text-[11px] text-center font-semibold bg-surface border border-border/40 rounded-lg text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
        />
      </form>
    </div>
  );
}

function ChevronsLeft({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m11 17-5-5 5-5" /><path d="m18 17-5-5 5-5" />
    </svg>
  );
}
function ChevronsRight({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 17 5-5-5-5" /><path d="m13 17 5-5-5-5" />
    </svg>
  );
}
import api from '../api/client';
import { hasPermission } from '../utils/permissions';
import { useAuth } from '../context/AuthContext';
import useSystemSettings from '../hooks/useSystemSettings';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import DataGrid from '../components/DataGrid';

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
  const [pageSize, setPageSize] = useState(() => {
    const s = localStorage.getItem('problems_page_size');
    return s ? parseInt(s, 10) : 30;
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [stats, setStats] = useState({ total: 0, open: 0, solved: 0, closed: 0 });
  const [showCreateModal, setShowCreateModal] = useState(false);

  const loadProblems = useCallback(() => {
    setLoading(true);
    const params = { page, limit: pageSize };
    if (search) params.search = search;
    if (statusFilter) params.status = statusFilter;
    if (priorityFilter) params.priority = priorityFilter;

    api.get('/problems', { params })
      .then(({ data }) => { setProblems(data.problems || []); setTotal(data.total || 0); })
      .catch(() => toast.error('Erreur chargement problèmes'))
      .finally(() => setLoading(false));
  }, [page, pageSize, search, statusFilter, priorityFilter]);

  const loadStats = useCallback(() => {
    api.get('/problems/stats').then(({ data }) => setStats(data)).catch(() => {});
  }, []);

  useEffect(() => { loadProblems(); }, [loadProblems]);
  useEffect(() => { loadStats(); }, [loadStats]);

  useEffect(() => { setPage(1); }, [search, statusFilter, priorityFilter]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="flex flex-col h-full w-full min-w-0 gap-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border/20 bg-surface shrink-0">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <h1 className="text-sm font-bold text-on-surface whitespace-nowrap">Problèmes</h1>
          <span className="text-[11px] text-on-surface-variant font-medium tabular-nums">
            {total > 0 && `${total}`}
          </span>
        </div>
        {canManage && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Nouveau</span>
          </button>
        )}
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 sm:px-6 py-3 shrink-0">
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
      <div className="flex items-center gap-2 px-4 sm:px-6 py-3 shrink-0">
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
        <div className="bg-surface-container rounded-xl p-3 flex flex-wrap gap-3 items-center mx-4 sm:mx-6">
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

      {/* ── MAIN CONTENT ── */}
      <div className="flex-1 min-h-0 relative flex flex-col">
        {/* ── TABLE VIEW (AG Grid — same as Tickets) ── */}
        <div className="flex-1 min-h-0 mx-4 sm:mx-6 lg:mx-8 mt-3.5 mb-4 flex flex-col">
          <div className="flex-1 min-h-0 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest overflow-hidden flex flex-col">
            <DataGrid
              columns={[
                { field: 'title', headerName: 'Titre', flex: 1.5, minWidth: 200, cellRenderer: (p) => <span className="font-semibold text-sm text-on-surface group-hover:text-primary truncate max-w-[300px]">{p.value}</span> },
                { field: 'status', headerName: 'Statut', width: 130, cellRenderer: (p) => <StatusBadge status={p.value} /> },
                { field: 'priority', headerName: 'Priorité', width: 100, cellRenderer: (p) => <PriorityBadge priority={p.value} /> },
                { field: 'category', headerName: 'Catégorie', width: 140, cellRenderer: (p) => <span className="text-xs text-on-surface-variant">{p.value || '—'}</span> },
                {
                  field: 'assignedTo', headerName: 'Assigné à', width: 160,
                  valueGetter: (params) => params.data.assignedTo?.fullName || '',
                  cellRenderer: (params) => params.value
                    ? <span className="inline-flex items-center gap-1.5 text-xs text-on-surface">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[9px] font-bold">
                          {params.value?.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
                        </span>
                        {params.value}
                      </span>
                    : <span className="text-xs text-on-surface-variant italic">Non assigné</span>,
                },
                {
                  field: 'ticketCount', headerName: 'Tickets', width: 90, headerClass: 'text-center',
                  valueGetter: (params) => params.data._count?.tickets || 0,
                  cellRenderer: (params) => <span className="inline-flex items-center gap-1 text-xs text-on-surface-variant justify-center w-full"><Link2 className="w-3 h-3" />{params.value}</span>,
                },
                {
                  field: 'createdAt', headerName: 'Créé le', width: 110,
                  cellRenderer: (params) => <span className="text-xs text-on-surface-variant whitespace-nowrap">{new Date(params.value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</span>,
                  comparator: (a, b) => new Date(a).getTime() - new Date(b).getTime(),
                },
              ]}
              rowData={problems}
              loading={loading}
              onRowClick={(data) => navigate(`/problems/${data.id}`)}
              pagination={false}
              noRowsText="Aucun problème enregistré pour le moment."
              className="rounded-2xl overflow-hidden flex-1"
            />
          </div>
        </div>
      </div>

      {/* ── PAGINATION ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-4 sm:px-6 py-3 border-t border-border/20 bg-surface shrink-0">
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="font-medium tabular-nums">
            {total > 0
              ? `${Math.min((page - 1) * pageSize + 1, total)}–${Math.min(page * pageSize, total)} sur ${total.toLocaleString('fr-FR')}`
              : '0 résultat'}
          </span>
          <div className="w-px h-3.5 bg-border/40" />
          <select value={pageSize}
            onChange={(e) => { const v = Number(e.target.value); setPageSize(v); localStorage.setItem('problems_page_size', String(v)); setPage(1); }}
            className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-border/40 bg-background text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all">
            {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}/page</option>)}
          </select>
        </div>
        <PaginationButtons page={page} totalPages={Math.max(totalPages, 1)} onPageChange={setPage} />
      </div>



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
