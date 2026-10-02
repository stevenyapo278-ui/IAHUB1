import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle, Plus, RefreshCw, X,
  Clock, CheckCircle2, Radio, User, Calendar,
  Link2, Eye, Flame, Info, ArrowDown, Sparkles,
} from 'lucide-react';

import api from '../api/client';
import { hasPermission } from '../utils/permissions';
import { useAuth } from '../context/AuthContext';
import useSystemSettings from '../hooks/useSystemSettings';
import DataGrid from '../components/DataGrid';
import RemoteUserSelect from '../components/RemoteUserSelect';
import PaginationButtons from '../components/PaginationButtons';
import ProblemFilterBar from '../components/ProblemFilterBar';
import ProblemFilterDrawer from '../components/ProblemFilterDrawer';

const STATUS_LABELS = {
  NEW: 'Nouveau', IN_PROGRESS: 'En cours', ASSIGNED: 'Attribué', PLANNED: 'Planifié',
  WAITING: 'En attente', SOLVED: 'Résolu', CLOSED: 'Fermé', OBSERVED: 'Observé',
};
const PRIORITY_OPTIONS = ['P1', 'P2', 'P3', 'P4'];
const PRIORITY_LABELS = { P1: 'Critique', P2: 'Haute', P3: 'Moyenne', P4: 'Basse' };

// Groupes envoyés au backend (STATUS_GROUPS côté serveur, alignés sur /problems/stats)
const OPEN_GROUP = 'OPEN_GROUP';

// Champs triables par GET /problems (paramètre sortBy) — doit rester aligné avec la
// whitelist SORTABLE_FIELDS de problem.routes.js.
const SERVER_SORTABLE = new Set([
  'id', 'title', 'status', 'priority', 'category', 'requester', 'assignedTo', 'createdAt',
]);

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

function initials(name) {
  return String(name || '').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function Problems() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const settings = useSystemSettings();
  const canManage = hasPermission(user, 'problems.manage', settings);

  const [searchParams, setSearchParams] = useSearchParams();

  // ── Filtres / tri / page / recherche : initialisés depuis l'URL ──────────
  // Miroir de la vue Tickets : l'URL fait foi (partageable, survit au F5) et
  // reflète ensuite l'état courant en replace (pas de pollution de l'historique).
  const readFiltersFromUrl = useCallback(() => ({
    status: searchParams.get('status') || '',
    priority: searchParams.get('priority') || '',
    category: searchParams.get('category') || '',
    teamId: searchParams.get('teamId') || '',
    assignedToId: searchParams.get('assignedToId') || '',
    requesterId: searchParams.get('requesterId') || '',
    dateFrom: searchParams.get('dateFrom') || '',
    dateTo: searchParams.get('dateTo') || '',
  }), [searchParams]);

  const [filters, setFilters] = useState(readFiltersFromUrl);
  const [sortBy, setSortBy] = useState(() => searchParams.get('sortBy') || 'createdAt');
  const [sortOrder, setSortOrder] = useState(() => searchParams.get('sortOrder') || 'desc');
  const [page, setPage] = useState(() => parseInt(searchParams.get('page'), 10) || 1);
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get('search') || '');
  const debounceRef = useRef(null);
  const searchInputRef = useRef(null);

  const [pageSize, setPageSize] = useState(() => {
    const s = localStorage.getItem('problems_page_size');
    return s ? parseInt(s, 10) : 30;
  });
  const [problems, setProblems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, open: 0, solved: 0, closed: 0 });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);

  // ── Colonnes (ordre, largeur, tri initial) ───────────────────────────────
  const problemColumns = useMemo(() => {
    const cols = [
      { field: 'id', headerName: 'N°', width: 78, pinned: 'left', cellRenderer: (params) => (
        <span className="font-mono text-xs font-extrabold tabular-nums text-on-surface-variant">#{params.value}</span>
      ) },
      { field: 'title', headerName: 'TITRE', flex: 2, minWidth: 250, cellRenderer: (params) => (
        <span className="text-sm font-semibold text-on-surface truncate">{params.value}</span>
      ) },
      { field: 'status', headerName: 'STATUT', width: 150, cellRenderer: (params) => <StatusBadge status={params.value} /> },
      { field: 'priority', headerName: 'PRIORITÉ', width: 130, cellRenderer: (params) => <PriorityBadge priority={params.value} /> },
      { field: 'category', headerName: 'CATÉGORIE', width: 140, valueFormatter: (params) => params.value || '—' },
      { field: 'requester', headerName: 'DEMANDEUR', width: 170, valueGetter: (params) => params.data?.requester?.fullName || '', cellRenderer: (params) => (
        params.value ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-on-surface">
            <span className="w-5 h-5 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[9px] font-bold">
              {initials(params.value)}
            </span>
            {params.value}
          </span>
        ) : (
          <span className="text-xs text-on-surface-variant italic">—</span>
        )
      ) },
      { field: 'assignedTo', headerName: 'ASSIGNÉ À', width: 180, valueGetter: (params) => params.data?.assignedTo?.fullName || '', cellRenderer: (params) => (
        params.value ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-on-surface">
            <span className="w-5 h-5 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[9px] font-bold">
              {initials(params.value)}
            </span>
            {params.value}
          </span>
        ) : (
          <span className="text-xs text-on-surface-variant italic">Non assigné</span>
        )
      ) },
      { field: '_count', headerName: 'TICKETS', width: 90, sortable: false, valueGetter: (params) => params.data?._count?.tickets || 0, cellRenderer: (params) => (
        <span className="inline-flex items-center gap-1 text-xs text-on-surface-variant justify-center w-full">
          <Link2 className="w-3 h-3" />{params.value}
        </span>
      ) },
      { field: 'createdAt', headerName: 'CRÉÉ LE', width: 120, valueFormatter: (params) => params.value ? new Date(params.value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '—' },
    ];
    // Tri serveur : l'état initial de tri passe par colDef.sort (comme Tickets)
    const serverSort = SERVER_SORTABLE.has(sortBy) ? (sortOrder === 'asc' ? 'asc' : 'desc') : null;
    for (const col of cols) {
      col.sort = col.field === sortBy ? serverSort : undefined;
    }
    return cols;
  }, [sortBy, sortOrder]);

  // ── Chargement ───────────────────────────────────────────────────────────
  const loadProblems = useCallback(() => {
    setLoading(true);
    const params = { page, limit: pageSize };
    if (debouncedSearch) params.search = debouncedSearch;
    for (const [key, value] of Object.entries(filters)) {
      if (value) params[key] = value;
    }
    params.sortBy = sortBy;
    params.sortOrder = sortOrder;

    api.get('/problems', { params })
      .then(({ data }) => { setProblems(data.problems || []); setTotal(data.total || 0); })
      .catch(() => toast.error('Erreur chargement problèmes'))
      .finally(() => setLoading(false));
  }, [page, pageSize, debouncedSearch, filters, sortBy, sortOrder]);

  const loadStats = useCallback(() => {
    api.get('/problems/stats').then(({ data }) => setStats(data)).catch(() => {});
  }, []);

  useEffect(() => { loadProblems(); }, [loadProblems]);
  useEffect(() => { loadStats(); }, [loadStats]);

  // Référentiels pour les filtres avancés (équipes = endpoint ouvert, /users = admins :
  // en cas d'échec les listes restent vides et les critères concernés sont simplement inutilisables)
  useEffect(() => {
    api.get('/teams').then(({ data }) => setTeams(Array.isArray(data) ? data : data.teams || [])).catch(() => {});
    api.get('/users').then(({ data }) => setUsers(Array.isArray(data) ? data : data.users || [])).catch(() => {});
    api.get('/categories').then(({ data }) => setCategories(Array.isArray(data) ? data : data.categories || [])).catch(() => {});
  }, []);

  // ── État → URL ───────────────────────────────────────────────────────────
  function buildUrlFromState() {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (sortBy && sortBy !== 'createdAt') params.set('sortBy', sortBy);
    if (sortOrder && sortOrder !== 'desc') params.set('sortOrder', sortOrder);
    if (page && page !== 1) params.set('page', String(page));
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
    return params;
  }

  useEffect(() => {
    setSearchParams(buildUrlFromState(), { replace: true });
  }, [debouncedSearch, sortBy, sortOrder, filters, page]);

  // ── URL → État (liens externes : ?priority=P1 depuis un widget, etc.) ───
  // On ne réapplique QUE si l'URL réelle diffère du reflet de l'état → aucune boucle.
  useEffect(() => {
    if (buildUrlFromState().toString() === searchParams.toString()) return undefined;
    const nextFilters = readFiltersFromUrl();
    const nextSearch = searchParams.get('search') || '';
    const nextSortBy = searchParams.get('sortBy') || 'createdAt';
    const nextSortOrder = searchParams.get('sortOrder') || 'desc';
    const nextPage = parseInt(searchParams.get('page'), 10) || 1;

    // Application DIFFÉRÉE : react-hooks/set-state-in-effect refuse tout setState
    // appelé synchrone­ment dans le corps d'un effet.
    const id = setTimeout(() => {
      setFilters((prev) => (Object.keys(nextFilters).some((k) => (prev[k] || '') !== nextFilters[k]) ? nextFilters : prev));
      if (nextSearch !== debouncedSearch) {
        setSearchQuery(nextSearch);
        setDebouncedSearch(nextSearch);
      }
      if (nextSortBy !== sortBy) setSortBy(nextSortBy);
      if (nextSortOrder !== sortOrder) setSortOrder(nextSortOrder);
      if (nextPage !== page) setPage(nextPage);
    }, 0);
    return () => clearTimeout(id);
  }, [searchParams]);

  // Recherche : debounce 300 ms puis recharge (page 1)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery]);

  function updateFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }

  function clearFilters() {
    setFilters({ status: '', priority: '', category: '', teamId: '', assignedToId: '', requesterId: '', dateFrom: '', dateTo: '' });
    setSearchQuery('');
    setDebouncedSearch('');
    setSortBy('createdAt');
    setSortOrder('desc');
    setPage(1);
  }

  const activeFilterCount = [
    filters.status, filters.priority, filters.category, filters.teamId,
    filters.assignedToId, filters.requesterId, filters.dateFrom, filters.dateTo,
  ].filter(Boolean).length;

  // ── Tri par clic sur un en-tête → TRI SERVEUR ────────────────────────────
  // Sans ça, un clic ne trierait que la page courante et serait écrasé au refresh.
  const handleGridSortChanged = useCallback((event) => {
    const cols = event.api?.getColumnState?.() || [];
    const sorted = cols.find((c) => c.sort);
    const dir = sorted?.sort === 'asc' || sorted?.sort === 'desc' ? sorted.sort : null;
    if (dir && SERVER_SORTABLE.has(sorted.colId)) {
      setSortBy(sorted.colId);
      setSortOrder(dir);
    } else {
      // Tri effacé (3e clic) ou colonne non triable côté serveur → tri par défaut
      setSortBy('createdAt');
      setSortOrder('desc');
    }
    setPage(1);
  }, []);

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
        <div className="flex items-center gap-2">
          <button onClick={loadProblems}
            className="p-2 rounded-xl border border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high cursor-pointer transition-colors"
            title="Recharger">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
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
      </div>

      {/* Stats cards — cliquables, comme sur la vue Tickets */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 sm:px-6 py-3 shrink-0">
        {[
          { label: 'Total', value: stats.total, statusVal: '', color: 'text-on-surface', borderActive: 'border-on-surface/40' },
          { label: 'Ouverts', value: stats.open, statusVal: OPEN_GROUP, color: 'text-amber-600 dark:text-amber-400', borderActive: 'border-amber-500/60' },
          { label: 'Résolus', value: stats.solved, statusVal: 'SOLVED', color: 'text-emerald-600 dark:text-emerald-400', borderActive: 'border-emerald-500/60' },
          { label: 'Fermés', value: stats.closed, statusVal: 'CLOSED', color: 'text-slate-600 dark:text-slate-400', borderActive: 'border-slate-500/60' },
        ].map((s) => {
          const isActive = s.statusVal !== '' && filters.status === s.statusVal;
          return (
            <button
              key={s.label}
              type="button"
              onClick={() => updateFilter('status', s.statusVal)}
              className={`bg-surface-container rounded-xl p-3 text-center transition-all cursor-pointer hover:bg-surface-container-high border-2 ${isActive ? `${s.borderActive} shadow-xs` : 'border-transparent'}`}
            >
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-on-surface-variant font-medium">{s.label}</p>
            </button>
          );
        })}
      </div>

      {/* Barre de filtres (recherche, puces, période, filtres avancés) */}
      <ProblemFilterBar
        filters={filters}
        onUpdate={updateFilter}
        onClear={clearFilters}
        onOpenDrawer={() => setFilterPanelOpen(true)}
        activeFilterCount={activeFilterCount}
        teams={teams}
        users={users}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onClearSearch={() => { setSearchQuery(''); setDebouncedSearch(''); setPage(1); }}
        searchInputRef={searchInputRef}
      />

      {/* ── MAIN CONTENT ── */}
      <div className="flex-1 min-h-0 relative flex flex-col">
        {/* ── TABLE VIEW (AG Grid — same as Tickets) ── */}
        <div className="flex-1 min-h-0 mx-4 sm:mx-6 lg:mx-8 mt-3.5 mb-4 flex flex-col">
          <div className="flex-1 min-h-0 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest overflow-hidden flex flex-col">
            <DataGrid
              storageKey="problems"
              columns={problemColumns}
              rowData={problems}
              loading={loading}
              onRowClick={(data) => navigate(`/problems/${data.id}`)}
              pagination={false}
              noRowsText="Aucun problème ne correspond à vos critères."
              extraGridOptions={{ onSortChanged: handleGridSortChanged }}
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

      {/* ── DRAWER DE FILTRES ────────────────────────────────────────────────── */}
      <ProblemFilterDrawer
        open={filterPanelOpen}
        onClose={() => setFilterPanelOpen(false)}
        activeFilterCount={activeFilterCount}
        filters={filters}
        onUpdate={updateFilter}
        onClear={clearFilters}
        teams={teams}
        users={users}
        categories={categories}
        searchQuery={searchQuery}
      />

      {/* Create modal */}
      {showCreateModal && (
        <CreateProblemModal onClose={() => setShowCreateModal(false)} onCreated={(id) => { setShowCreateModal(false); navigate(`/problems/${id}`); loadStats(); }} />
      )}
    </div>
  );
}

function CreateProblemModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ title: '', description: '', priority: 'P3', urgency: 'MEDIUM', impact: 'MEDIUM', category: '', requesterId: '' });
  const [submitting, setSubmitting] = useState(false);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    api.get('/categories').then(({ data }) => setCategories(Array.isArray(data) ? data : data.categories || [])).catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.description.trim()) return toast.error('Titre et description requis');
    setSubmitting(true);
    try {
      // requesterId arrive en chaîne du sélecteur : coercition en entier pour Prisma
      const payload = {
        ...form,
        requesterId: form.requesterId ? Number(form.requesterId) : null,
      };
      const { data } = await api.post('/problems', payload);
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
          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">Demandeur</label>
            <RemoteUserSelect
              value={form.requesterId}
              onChange={(val) => setForm((prev) => ({ ...prev, requesterId: val }))}
              placeholder="Rechercher un demandeur..."
              searchPlaceholder="Rechercher par nom ou email..."
            />
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
