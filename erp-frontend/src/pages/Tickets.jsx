import { useEffect, useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Ticket,
  Radio,
  Clock,
  CheckCircle2,
  Lock,
  AlertTriangle,
  Info,
  ArrowDown,
  Sparkles,
  Table,
  LayoutGrid,
  RefreshCw,
  Download,
  FileSpreadsheet,
  FileCode2,
  Plus,
  X,
  Search,
  SlidersHorizontal,
  User,
  Users,
  MapPin,
  Tag,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  KanbanSquare,
  ListChecks,
  Boxes,
  Calendar,
  CheckSquare,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { hasPermission } from '../utils/permissions';
import useSystemSettings from '../hooks/useSystemSettings';
import ConfirmDialog from '../components/ConfirmDialog';
import { flattenCategoryTree } from '../utils/categoryTree';
import EmptyState from '../components/EmptyState';
import TicketCoverflowCarousel from '../components/TicketCoverflowCarousel';
import KanbanBoard from '../components/KanbanBoard';
import SearchableSelect from '../components/SearchableSelect';
import TicketFilterDrawer from '../components/TicketFilterDrawer';
import SearchableMultiSelect from '../components/SearchableMultiSelect';
import RemoteUserSelect from '../components/RemoteUserSelect';
import RemoteUserMultiSelect from '../components/RemoteUserMultiSelect';
import SlaBadge from '../components/SlaBadge';
import {
  STATUS_OPTIONS, STATUS_LABELS, PRIORITY_OPTIONS, TYPE_OPTIONS, SOURCE_OPTIONS, URGENCY_IMPACT_OPTIONS,
  STATUS_CONFIG,
} from '../constants/tickets';

// Vue par défaut « à la GLPI » : tous les statuts sont visibles (NEW, OPEN,
// PLANNED, PENDING, SOLVED…) sauf les tickets CLOSE — notamment ceux fermés
// automatiquement après 3 jours. Un statut présent dans l'URL (?status=SOLVED…)
// prime toujours, et « Tous les statuts » dans le panneau restaure la vue complète.
const DEFAULT_STATUS_FILTER = 'NOT_CLOSED';

const EMPTY_FORM = {  title: '',
  content: '',
  openedAt: '',
  dueDate: '',
  type: 'INCIDENT',
  category: '',
  status: 'NEW',
  source: 'Direct',
  urgency: 'MEDIUM',
  impact: 'MEDIUM',
  priority: 'P3',
  externalId: '',
  locationId: '',
  teamId: '',
  assignedToId: '',
  requesterId: '',
  observerIds: [],
  assetIds: [],
  requiresApproval: false,
};

function HighlightText({ text, query }) {
  if (!query || !text) return <>{text}</>;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = String(text).split(regex);
  return <>{parts.map((part, i) =>
    regex.test(part) ? <mark key={i} className="bg-amber-300/40 text-on-surface rounded-sm px-0.5">{part}</mark> : part
  )}</>;
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function formatDateTimeShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
}

// ── Priority dot config ──────────────────────────────────────────────────────
const PRIORITY_DOT = {
  P1: { color: 'bg-red-500',    label: 'P1', text: 'text-red-500'    },
  P2: { color: 'bg-orange-400', label: 'P2', text: 'text-orange-400' },
  P3: { color: 'bg-amber-400',  label: 'P3', text: 'text-amber-400'  },
  P4: { color: 'bg-emerald-500',label: 'P4', text: 'text-emerald-500'},
};

// STATUS_CONFIG importé depuis constants/tickets.js — pas de doublon local

function PriorityDot({ priority, showLabel = false }) {
  const conf = PRIORITY_DOT[priority] || PRIORITY_DOT.P4;
  return (
    <span className="inline-flex items-center gap-1.5 shrink-0" title={`Priorité ${conf.label}`}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${conf.color}`} />
      {showLabel && <span className={`text-[11px] font-bold tabular-nums ${conf.text}`}>{conf.label}</span>}
    </span>
  );
}

function StatusPill({ status }) {
  const conf = STATUS_CONFIG[status] || STATUS_CONFIG.NEW;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap ${conf.bg}`}>
      <conf.Icon className="w-3 h-3 shrink-0" />
      {conf.label}
    </span>
  );
}

function Avatar({ name, colorClass = 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20' }) {
  if (!name) return null;
  return (
    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full border text-[10px] font-bold shrink-0 ${colorClass}`}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export default function Tickets() {
  const { user } = useAuth();
  const { autonomousMode } = useSystemSettings();
  const canAssign = hasPermission(user, 'tickets.assign') || user?.role === 'HOTLINE' || user?.role === 'SUPERADMIN';
  const canApprove = hasPermission(user, 'tickets.approve') || user?.role === 'HOTLINE' || user?.role === 'SUPERADMIN';
  const canDelete = hasPermission(user, 'tickets.delete') || user?.role === 'SUPERADMIN';
  const canBulkDelete = hasPermission(user, 'tickets.bulkDelete') || user?.role === 'SUPERADMIN';
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [tickets, setTickets] = useState([]);
  const [serverStats, setServerStats] = useState({ open: 0, pending: 0, resolved: 0, p1: 0, p2: 0, ai: 0, unassigned: 0 });
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [categories, setCategories] = useState([]);
  const [glpiUsers, setGlpiUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const flatCategories = useMemo(() => flattenCategoryTree(categories), [categories]);
  const [refreshing, setRefreshing] = useState(false);
  const isFirstLoad = useRef(true);

  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [viewMode, setViewMode] = useState(() => localStorage.getItem('tickets_view_mode') || 'table');
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);

  const [sortBy, setSortBy] = useState(() => searchParams.get('sortBy') || 'createdAt');
  const [sortOrder, setSortOrder] = useState(() => searchParams.get('sortOrder') || 'desc');

  const savedViewsKey = user ? `tickets_saved_views_${user.id}` : null;
  const [savedViews, setSavedViews] = useState(() => {
    try { return savedViewsKey ? JSON.parse(localStorage.getItem(savedViewsKey) || '[]') : []; } catch { return []; }
  });

  function persistSavedViews(views) {
    setSavedViews(views);
    if (savedViewsKey) localStorage.setItem(savedViewsKey, JSON.stringify(views));
  }

  function saveCurrentView() {
    if (!savedViewsKey) return;
    const name = window.prompt('Nom de la vue à enregistrer :');
    if (!name) return;
    const view = { name, filters: { ...filters }, search: searchQuery, sortBy, sortOrder };
    const existing = savedViews.findIndex((v) => v.name === name);
    const next = existing >= 0 ? savedViews.map((v, i) => (i === existing ? view : v)) : [...savedViews, view];
    persistSavedViews(next);
    toast.success(`Vue « ${name} » enregistrée`);
  }

  function restoreView(view) {
    setFilters(view.filters || {});
    setSearchQuery(view.search || '');
    setDebouncedSearch(view.search || '');
    setSortBy(view.sortBy || 'createdAt');
    setSortOrder(view.sortOrder || 'desc');
    setPage(1);
    toast.success(`Vue « ${view.name} » appliquée`);
  }

  function deleteSavedView(name) {
    persistSavedViews(savedViews.filter((v) => v.name !== name));
    toast.success('Vue supprimée');
  }

  const [filters, setFilters] = useState({
    status: searchParams.get('status') || DEFAULT_STATUS_FILTER,
    approvalStatus: searchParams.get('approvalStatus') || '',
    priority: searchParams.get('priority') || '',
    source: searchParams.get('source') || '',
    category: searchParams.get('category') || '',
    teamId: searchParams.get('teamId') || '',
    assignedToId: searchParams.get('assignedToId') || '',
    mine: searchParams.get('mine') || '',
    aiProcessed: searchParams.get('aiProcessed') || '',
    closeSuggested: searchParams.get('closeSuggested') || '',
  });

  const [showForm, setShowForm] = useState(searchParams.get('new') === '1');
  const [form, setForm] = useState(EMPTY_FORM);
  const [attachment, setAttachment] = useState(null);
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [customValues, setCustomValues] = useState({});
  const [assetOptions, setAssetOptions] = useState([]);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(() => {
    const p = searchParams.get('page');
    return p ? parseInt(p, 10) : 1;
  });
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [pageSize, setPageSize] = useState(() => {
    const s = localStorage.getItem('tickets_page_size');
    return s ? parseInt(s, 10) : 50;
  });
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get('search') || '');
  const debounceRef = useRef(null);

  function changeViewMode(mode) {
    setViewMode(mode);
    localStorage.setItem('tickets_view_mode', mode);
  }

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (debouncedSearch) params.set('search', debouncedSearch); else params.delete('search');
    if (sortBy && sortBy !== 'createdAt') params.set('sortBy', sortBy); else params.delete('sortBy');
    if (sortOrder && sortOrder !== 'desc') params.set('sortOrder', sortOrder); else params.delete('sortOrder');
    if (page && page !== 1) params.set('page', String(page)); else params.delete('page');
    Object.entries(filters).forEach(([k, v]) => {
      // Le statut par défaut reste implicite : /tickets ne s'alourdit pas de ?status=OPEN_GROUP
      if (v && !(k === 'status' && v === DEFAULT_STATUS_FILTER)) params.set(k, v); else params.delete(k);
    });
    setSearchParams(params, { replace: true });
  }, [debouncedSearch, sortBy, sortOrder, filters, page]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery]);

  const showSelectionColumn = canBulkDelete || canAssign;

  function updateFilter(key, value) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    setPage(1);
  }

  function toggleSort(field) {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setPage(1);
  }

  function clearFilters() {
    setFilters({ status: '', priority: '', source: '', category: '', teamId: '', assignedToId: '', mine: '', aiProcessed: '', approvalStatus: '', closeSuggested: '' });
    setSearchQuery('');
    setDebouncedSearch('');
    setSortBy('createdAt');
    setSortOrder('desc');
    setPage(1);
  }

  function loadTickets(isManualRefresh = false) {
    if (isManualRefresh) {
      setRefreshing(true);
    } else if (isFirstLoad.current) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    const params = { page, limit: pageSize, sortBy, sortOrder };
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;
    if (filters.source) params.source = filters.source;
    if (filters.category) params.category = filters.category;
    if (filters.teamId) params.teamId = filters.teamId;
    if (filters.assignedToId) params.assignedToId = filters.assignedToId;
    if (filters.mine) params.mine = filters.mine;
    if (filters.aiProcessed) params.aiProcessed = filters.aiProcessed;
    if (filters.approvalStatus) params.approvalStatus = filters.approvalStatus;
    if (filters.closeSuggested) params.closeSuggested = filters.closeSuggested;
    if (debouncedSearch) params.search = debouncedSearch;
    api.get('/tickets', { params })
      .then(({ data }) => {
        setTickets(data.items);
        setTotalPages(data.pages);
        setTotalCount(data.total);
        if (data.stats) setServerStats(data.stats);
        setSelectedIds([]);
        if (isManualRefresh) toast.success('Tickets rafraîchis');
      })
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'))
      .finally(() => {
        isFirstLoad.current = false;
        setLoading(false);
        setRefreshing(false);
      });
  }

  function refreshTicketsSilently() {
    const params = { page, limit: pageSize, sortBy, sortOrder };
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;
    if (filters.source) params.source = filters.source;
    if (filters.category) params.category = filters.category;
    if (filters.teamId) params.teamId = filters.teamId;
    if (filters.assignedToId) params.assignedToId = filters.assignedToId;
    if (filters.mine) params.mine = filters.mine;
    if (filters.aiProcessed) params.aiProcessed = filters.aiProcessed;
    if (filters.approvalStatus) params.approvalStatus = filters.approvalStatus;
    if (filters.closeSuggested) params.closeSuggested = filters.closeSuggested;
    if (debouncedSearch) params.search = debouncedSearch;
    api.get('/tickets', { params }).then(({ data }) => { setTickets(data.items); setTotalPages(data.pages); setTotalCount(data.total); if (data.stats) setServerStats(data.stats); }).catch(() => {});
  }

  useEffect(() => { loadTickets(); }, [filters, page, pageSize, debouncedSearch, sortBy, sortOrder]);
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') refreshTicketsSilently();
    }, 15000);
    return () => clearInterval(intervalId);
  }, [filters, debouncedSearch, sortBy, sortOrder]);

  const searchInputRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); searchInputRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function toggleSelect(id) {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  }
  function toggleSelectAll() {
    setSelectedIds((ids) => (ids.length === tickets.length ? [] : tickets.map((t) => t.id)));
  }

  const [bulkChanges, setBulkChanges] = useState({ status: '', priority: '', assignedToId: '' });
  const [bulkUpdating, setBulkUpdating] = useState(false);

  async function handleBulkUpdate() {
    const payload = { ids: selectedIds };
    if (bulkChanges.status) payload.status = bulkChanges.status;
    if (bulkChanges.priority) payload.priority = bulkChanges.priority;
    if (bulkChanges.assignedToId) payload.assignedToId = Number(bulkChanges.assignedToId);
    if (Object.keys(payload).length === 1) return toast.error('Choisissez une modification à appliquer');
    setBulkUpdating(true);
    try {
      const { data } = await api.post('/tickets/bulk-update', payload);
      toast.success(`${data.updatedCount}/${data.total} ticket(s) mis à jour`);
      if (data.failures?.length > 0) toast.error(`${data.failures.length} ticket(s) en échec`);
      setBulkChanges({ status: '', priority: '', assignedToId: '' });
      setSelectedIds([]);
      loadTickets();
    } catch (err) {
      toast.error(err.response?.data?.error || "Échec de l'opération groupée");
    } finally {
      setBulkUpdating(false);
    }
  }

  async function exportAll(fmt = 'csv') {
    const params = {};
    for (const key of ['status', 'priority', 'category', 'teamId', 'assignedToId', 'mine', 'approvalStatus', 'source', 'aiProcessed', 'closeSuggested']) {
      const v = filters[key];
      if (v !== undefined && v !== '' && v !== null) params[key] = v;
    }
    if (debouncedSearch) params.search = debouncedSearch;
    params.sortBy = sortBy; params.sortOrder = sortOrder; params.format = fmt;
    try {
      // Téléchargement via axios pour envoyer le header Authorization
      const res = await api.get('/tickets/export', { params, responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tickets_export_${new Date().toISOString().slice(0, 10)}.${fmt}`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`Export ${fmt.toUpperCase()} généré`);
    } catch {
      toast.error("Échec de l'export");
    }
  }

  async function handleQuickStatusChange(ticketId, newStatus, e) {
    if (e) e.stopPropagation();
    try {
      await api.patch(`/tickets/${ticketId}`, { status: newStatus });
      toast.success(`Statut : ${newStatus}`);
      refreshTicketsSilently();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Échec mise à jour statut');
    }
  }

  const [confirmDelete, setConfirmDelete] = useState(null);
  function askDeleteOne(id) { setConfirmDelete({ mode: 'one', id }); }
  function askDeleteSelected() { if (selectedIds.length > 0) setConfirmDelete({ mode: 'bulk' }); }

  async function confirmDeleteAction() {
    if (!confirmDelete) return;
    setDeleting(true); setError('');
    try {
      if (confirmDelete.mode === 'one') {
        await api.delete(`/tickets/${confirmDelete.id}`);
        toast.success('Ticket supprimé');
      } else {
        await api.post('/tickets/bulk-delete', { ids: selectedIds });
        toast.success(`${selectedIds.length} ticket(s) supprimé(s)`);
      }
      loadTickets(); setConfirmDelete(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    api.get('/locations').then(({ data }) => setLocations(data)).catch(() => {});
    api.get('/glpi/categories').then(({ data }) => setCategories(data)).catch(() => {});
    api.get('/glpi/users').then(({ data }) => setGlpiUsers(data)).catch(() => {});
    api.get('/ticket-templates').then(({ data }) => setTemplates(data)).catch(() => {});
    api.get('/assets', { params: { pageSize: 200 } })
      .then(({ data }) => {
        const list = Array.isArray(data) ? data : (data.assets || []);
        setAssetOptions(list.map((a) => ({ id: a.id, label: a.name, subLabel: [a.serialNumber, a.inventoryNumber, a.model].filter(Boolean).join(' — ') || undefined })));
      }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!canAssign) return;
    api.get('/teams').then(({ data }) => setTeams(data)).catch(() => {});
    api.get('/users').then(({ data }) => setUsers(Array.isArray(data) ? data : (data.users || []))).catch(() => {});
  }, [canAssign]);

  useEffect(() => {
    const cat = flatCategories.find((c) => c.name === form.category);
    const params = cat ? { categoryId: cat.id } : {};
    api.get('/custom-fields', { params })
      .then(({ data }) => {
        const active = (data || []).filter((f) => f.isActive);
        setCustomFieldDefs(active);
        setCustomValues((prev) => {
          const ids = new Set(active.map((f) => String(f.id)));
          const next = {};
          for (const [k, v] of Object.entries(prev)) if (ids.has(k)) next[k] = v;
          return next;
        });
      }).catch(() => setCustomFieldDefs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.category]);

  async function handleCreate(e) {
    e.preventDefault(); setError(''); setCreating(true);
    try {
      const payload = new FormData();
      Object.entries(form).forEach(([key, value]) => {
        if (key === 'observerIds') { if (value.length > 0) payload.append('observerIds', JSON.stringify(value)); return; }
        if (key === 'assetIds') { if (value.length > 0) payload.append('assetIds', JSON.stringify(value)); return; }
        if (value !== '' && value !== undefined && value !== null) payload.append(key, value);
      });
      if (Object.keys(customValues).length > 0) payload.append('customFields', JSON.stringify(customValues));
      if (attachment) payload.append('attachment', attachment);
      await api.post('/tickets', payload, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Ticket créé');
      setForm(EMPTY_FORM); setCustomValues({}); setAttachment(null); setShowForm(false); setSearchParams({});
      loadTickets();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la création');
    } finally {
      setCreating(false);
    }
  }

  function toggleForm() {
    setShowForm((v) => !v);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (next.get('new') === '1') next.delete('new'); else next.set('new', '1');
      return next;
    });
  }

  function applyTemplate(templateId) {
    setSelectedTemplate(templateId);
    if (!templateId) return;
    const t = templates.find((x) => String(x.id) === String(templateId));
    if (!t) return;
    setForm((prev) => ({ ...prev, title: t.title || prev.title, content: t.content || prev.content, priority: t.priority || prev.priority, category: t.category || prev.category, type: t.type || prev.type, urgency: t.urgency || prev.urgency, impact: t.impact || prev.impact }));
    toast.success(`Modèle « ${t.name} » appliqué`);
  }

  useEffect(() => {
    if (!showForm) return;
    const onKey = (e) => { if (e.key === 'Escape') toggleForm(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm]);

  const hasActiveFilters = Boolean(
    filters.status || filters.priority || filters.source || filters.category ||
    filters.teamId || filters.assignedToId || filters.mine || filters.aiProcessed ||
    filters.approvalStatus || filters.closeSuggested || searchQuery
  );

  const activeFilterCount = [
    filters.status, filters.priority, filters.source, filters.category,
    filters.teamId, filters.assignedToId, filters.mine, filters.aiProcessed,
    filters.approvalStatus, filters.closeSuggested,
  ].filter(Boolean).length;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full w-full min-w-0 gap-0">

      {/* ── COMPACT HEADER ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-outline-variant/20 bg-surface-container-lowest shrink-0">
        {/* Title */}
        <div className="flex items-center gap-2 min-w-0">
          <Ticket className="w-4 h-4 text-primary shrink-0" />
          <h1 className="text-sm font-bold text-on-surface whitespace-nowrap">Tickets</h1>
          <span className="text-[11px] text-on-surface-variant font-medium tabular-nums">
            {totalCount > 0 && `${totalCount}`}
          </span>
        </div>

        {/* Live badge */}
        <span className="hidden sm:flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Live
        </span>

        {/* Stats pills */}
        <div className="hidden lg:flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
          <div className="w-px h-3.5 bg-outline-variant/40 mx-1 shrink-0" />
          {serverStats.open > 0 && <StatPill color="bg-blue-500" count={serverStats.open} label="ouverts" onClick={() => updateFilter('status', 'OPEN_GROUP')} />}
          {serverStats.pending > 0 && <StatPill color="bg-amber-400" count={serverStats.pending} label="en attente" onClick={() => updateFilter('status', 'PENDING')} />}
          {serverStats.p1 > 0 && <StatPill color="bg-red-500" count={serverStats.p1} label="P1" onClick={() => updateFilter('priority', 'P1')} />}
          {serverStats.p2 > 0 && <StatPill color="bg-orange-400" count={serverStats.p2} label="P2" onClick={() => updateFilter('priority', 'P2')} />}
          {serverStats.ai > 0 && <StatPill color="bg-purple-500" count={serverStats.ai} label="IA" onClick={() => updateFilter('aiProcessed', 'true')} />}
          {serverStats.unassigned > 0 && <StatPill color="bg-rose-500" count={serverStats.unassigned} label="orphelins" onClick={() => updateFilter('assignedToId', 'none')} />}
        </div>

        {/* Spacer */}
        <div className="flex-1 lg:hidden" />

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Export */}
          <div className="relative group">
            <button
              className="p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"
              title="Exporter"
            >
              <FileSpreadsheet className="w-4 h-4" />
            </button>
            <div className="absolute right-0 top-full pt-1 z-30 hidden group-hover:block">
              <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest shadow-xl p-1.5 min-w-[180px]">
                <button onClick={() => exportAll('xlsx')} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-on-surface hover:bg-surface-container transition-colors cursor-pointer text-left">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-green-600" /> Exporter tout (XLSX)
                </button>
                <button onClick={() => exportAll('csv')} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-on-surface hover:bg-surface-container transition-colors cursor-pointer text-left">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" /> Exporter tout (CSV)
                </button>
                <button onClick={() => exportAll('json')} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-on-surface hover:bg-surface-container transition-colors cursor-pointer text-left">
                  <FileCode2 className="w-3.5 h-3.5 text-blue-500" /> Exporter tout (JSON)
                </button>
              </div>
            </div>
          </div>

          {/* Refresh */}
          <button
            onClick={() => loadTickets(true)}
            disabled={refreshing}
            className="p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all disabled:opacity-40"
            title="Rafraîchir"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>

          {/* View mode */}
          <div className="flex items-center p-0.5 rounded-lg border border-outline-variant/30 bg-surface-container gap-0.5">
            {[
              { mode: 'table', Icon: Table, label: 'Tableau' },
              { mode: 'grid', Icon: LayoutGrid, label: 'Grille' },
              { mode: 'carousel', Icon: Sparkles, label: 'Coverflow' },
              { mode: 'kanban', Icon: KanbanSquare, label: 'Kanban' },
            ].map(({ mode, Icon, label }) => (
              <button
                key={mode}
                onClick={() => changeViewMode(mode)}
                title={label}
                className={`p-1.5 rounded-md transition-all ${viewMode === mode ? 'bg-primary text-white shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            ))}
          </div>

          {/* Filter button */}
          <button
            onClick={() => setFilterPanelOpen(true)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-all ${
              activeFilterCount > 0
                ? 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20'
                : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Filtres</span>
            {activeFilterCount > 0 && (
              <span className="w-4 h-4 flex items-center justify-center rounded-full bg-primary text-white text-[9px] font-black">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* New ticket */}
          <button
            onClick={toggleForm}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-xs font-bold hover:opacity-90 transition-opacity shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Nouveau</span>
          </button>
        </div>
      </div>

      {/* ── SEARCH + FILTER CHIPS (same line) ────────────────────────────────── */}
      <div className="px-4 sm:px-6 py-2.5 border-b border-outline-variant/20 bg-surface-container-lowest shrink-0">
        <div className="flex items-center gap-2.5">
          {/* Search */}
          <div className="relative shrink-0">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/60" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher... ⌘K"
              className="w-48 pl-9 pr-8 py-1.5 text-xs bg-surface border border-outline-variant/30 rounded-lg text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(''); setDebouncedSearch(''); setPage(1); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Separator */}
          {hasActiveFilters && <div className="w-px h-4 bg-outline-variant/40 shrink-0" />}

          {/* Filter chips */}
          {hasActiveFilters && (
            <>
              <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest shrink-0">Filtres :</span>
              {debouncedSearch && <ActiveChip label={`"${debouncedSearch}"`} onRemove={() => { setSearchQuery(''); setDebouncedSearch(''); setPage(1); }} />}
              {filters.status && <ActiveChip label={filters.status === 'NOT_CLOSED' ? 'Non clôturés' : filters.status === 'OPEN_GROUP' ? 'Ouverts' : filters.status === 'CLOSED_GROUP' ? 'Clôturés' : filters.status} onRemove={() => updateFilter('status', '')} />}
              {filters.priority && <ActiveChip label={filters.priority} onRemove={() => updateFilter('priority', '')} />}
              {filters.source && <ActiveChip label={filters.source === 'glpi' ? 'GLPI' : 'ERP'} onRemove={() => updateFilter('source', '')} />}
              {filters.teamId && <ActiveChip label={teams.find(t => String(t.id) === filters.teamId)?.name || `Équipe #${filters.teamId}`} onRemove={() => updateFilter('teamId', '')} />}
              {filters.category && <ActiveChip label={filters.category} onRemove={() => updateFilter('category', '')} />}
              {filters.assignedToId && <ActiveChip label={filters.assignedToId === 'none' ? 'Non assigné' : users.find(u => String(u.id) === filters.assignedToId)?.fullName || `#${filters.assignedToId}`} onRemove={() => updateFilter('assignedToId', '')} />}
              {filters.mine && <ActiveChip label="Mes tickets" onRemove={() => updateFilter('mine', '')} />}
              {filters.aiProcessed && <ActiveChip label="Traité IA" onRemove={() => updateFilter('aiProcessed', '')} />}
              {filters.approvalStatus && <ActiveChip label={`Approbation: ${filters.approvalStatus}`} onRemove={() => updateFilter('approvalStatus', '')} />}
              {filters.closeSuggested && <ActiveChip label="Clôture suggérée" onRemove={() => updateFilter('closeSuggested', '')} />}
              <button onClick={clearFilters} className="shrink-0 text-[10px] font-bold text-on-surface-variant hover:text-red-500 transition-colors flex items-center gap-0.5 whitespace-nowrap">
                <X className="w-2.5 h-2.5" /> Tout effacer
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── MAIN CONTENT ────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 relative overflow-auto">
        {/* Overlay discret pendant rafraîchissement */}
        {refreshing && !loading && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold bg-surface-container-lowest border border-outline-variant/30 shadow-md text-on-surface-variant">
              <RefreshCw className="w-3 h-3 animate-spin" /> Mise à jour...
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-primary" />
            <p className="text-sm text-on-surface-variant">Chargement...</p>
          </div>
        ) : viewMode === 'carousel' ? (
          <TicketCoverflowCarousel tickets={tickets} isDark={isDark} />
        ) : viewMode === 'kanban' ? (
          <KanbanBoard
            tickets={tickets}
            canAssign={canAssign}
            onStatusChange={(ticket, newStatus) => handleQuickStatusChange(ticket.id, newStatus)}
          />
        ) : viewMode === 'grid' ? (
          /* ── GRID VIEW ── */
          <div className="p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <AnimatePresence mode="popLayout">
              {tickets.map((t) => (
                <motion.div
                  key={t.id}
                  initial={false}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => navigate(`/tickets/${t.id}`)}
                  className="rounded-xl border border-outline-variant/25 bg-surface-container-lowest hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer group relative overflow-hidden p-4 flex flex-col gap-3"
                >
                  {/* Priority stripe */}
                  <div className={`absolute top-0 left-0 right-0 h-0.5 ${
                    t.priority === 'P1' ? 'bg-red-500' : t.priority === 'P2' ? 'bg-orange-400' :
                    t.priority === 'P3' ? 'bg-amber-400' : 'bg-emerald-500'
                  }`} />

                  <div className="flex items-start justify-between gap-2 pt-1">
                    <div className="flex items-center gap-1.5">
                      <PriorityDot priority={t.priority} />
                      <span className="text-[11px] font-mono text-on-surface-variant">#{t.id}</span>
                      {t.aiProcessed && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400">IA</span>}
                      {t.glpiTicketId && <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-surface-container text-on-surface-variant">GLPI</span>}
                    </div>
                    <StatusPill status={t.status} />
                  </div>

                  <div>
                    <p className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors leading-snug line-clamp-2">
                      <HighlightText text={t.title} query={debouncedSearch} />
                    </p>
                    {t.category && (
                      <span className="mt-1 inline-block text-[10px] font-medium text-on-surface-variant bg-surface-container px-2 py-0.5 rounded-full">
                        {t.category}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-auto">
                    <div className="flex items-center gap-1.5 text-[11px] text-on-surface-variant">
                      {t.glpiLocationName && <><MapPin className="w-3 h-3 shrink-0" /><span className="truncate max-w-[100px]">{t.glpiLocationName}</span></>}
                    </div>
                    {t.assignedTo ? (
                      <div className="flex items-center gap-1.5">
                        <Avatar name={t.assignedTo.fullName} />
                        <span className="text-[11px] font-medium text-on-surface truncate max-w-[80px]">{t.assignedTo.fullName}</span>
                      </div>
                    ) : (
                      <span className="text-[10px] text-outline italic">Non assigné</span>
                    )}
                  </div>

                  <SlaBadge ticket={t} />
                </motion.div>
              ))}
            </AnimatePresence>

            {tickets.length === 0 && (
              <div className="col-span-full py-16">
                <EmptyState icon="tickets" title="Aucun ticket trouvé" description="Modifie les filtres ou crée un nouveau ticket." />
              </div>
            )}
          </div>
        ) : (
          /* ── TABLE VIEW ─────────────────────────────────────────────────── */
          <table className="w-full border-collapse">
            <thead>
              <tr className={`text-[10px] font-bold uppercase tracking-widest select-none border-b ${
                isDark ? 'border-outline-variant/20 text-slate-500 bg-surface-container-low/30' : 'border-slate-200/60 text-slate-400 bg-slate-50/70'
              }`}>
                {showSelectionColumn && (
                  <th className="w-10 px-4 py-2.5 text-left">
                    <input
                      type="checkbox"
                      checked={tickets.length > 0 && selectedIds.length === tickets.length}
                      onChange={toggleSelectAll}
                      className="cursor-pointer accent-primary w-3.5 h-3.5 rounded"
                    />
                  </th>
                )}
                <th className="w-6 px-2 py-2.5" /> {/* Priority dot col */}
                <SortTH field="title" current={sortBy} order={sortOrder} onSort={toggleSort} className="px-3 py-2.5 text-left min-w-0 flex-1">
                  Ticket
                </SortTH>
                <SortTH field="status" current={sortBy} order={sortOrder} onSort={toggleSort} className="px-3 py-2.5 text-left w-28 hidden md:table-cell">
                  Statut
                </SortTH>
                <SortTH field="assignedTo" current={sortBy} order={sortOrder} onSort={toggleSort} className="px-3 py-2.5 text-left w-36 hidden xl:table-cell">
                  Assigné
                </SortTH>
                <SortTH field="requester" current={sortBy} order={sortOrder} onSort={toggleSort} className="px-3 py-2.5 text-left w-36 hidden xl:table-cell">
                  Demandeur
                </SortTH>
                <SortTH field="location" current={sortBy} order={sortOrder} onSort={toggleSort} className="px-3 py-2.5 text-left w-36 hidden lg:table-cell">
                  Lieu
                </SortTH>
                <SortTH field="createdAt" current={sortBy} order={sortOrder} onSort={toggleSort} className="px-3 py-2.5 text-right w-20 hidden lg:table-cell">
                  Ouvert
                </SortTH>
                <SortTH field="updatedAt" current={sortBy} order={sortOrder} onSort={toggleSort} className="px-3 py-2.5 text-right w-20 hidden xl:table-cell">
                  Modifié
                </SortTH>
                <th className="w-12 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              <AnimatePresence mode="popLayout">
                {tickets.map((t) => {
                  const dateStr = formatDateShort(t.createdAt);
                  const reqName = t.requester?.fullName || t.sourceName || t.sourceEmail;
                  const overdue = isDueOverdue(t);

                  return (
                    <motion.tr
                      key={t.id}
                      initial={false}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      layout
                      onClick={() => navigate(`/tickets/${t.id}`)}
                      className={`cursor-pointer group transition-colors ${
                        isDark ? 'hover:bg-white/[0.025]' : 'hover:bg-slate-50'
                      }`}
                    >
                      {/* Checkbox */}
                      {showSelectionColumn && (
                        <td className="w-10 px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(t.id)}
                            onChange={() => toggleSelect(t.id)}
                            className="cursor-pointer accent-primary w-3.5 h-3.5 rounded"
                          />
                        </td>
                      )}

                      {/* Priority dot */}
                      <td className="w-6 px-2 py-3">
                        <PriorityDot priority={t.priority} />
                      </td>

                      {/* Main cell: ID + Title + meta */}
                      <td className="px-3 py-3 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={`font-mono text-[10px] font-bold tabular-nums ${PRIORITY_DOT[t.priority]?.text || 'text-on-surface-variant'}`}>
                            #{t.id}
                          </span>
                          {t.aiProcessed && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/10 text-purple-500 dark:text-purple-400">IA</span>
                          )}
                          {t.glpiTicketId && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-surface-container text-on-surface-variant">GLPI</span>
                          )}
                          {overdue && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/10 text-red-500 dark:text-red-400">Retard</span>
                          )}
                          <SlaBadge ticket={t} compact />
                        </div>
                        <p className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors truncate max-w-[340px] leading-tight">
                          <HighlightText text={t.title} query={debouncedSearch} />
                        </p>
                        {/* Sub-line */}
                        <div className="flex items-center gap-2 mt-0.5">
                          {t.category && (
                            <span className="text-[10px] text-on-surface-variant truncate max-w-[120px]">{t.category}</span>
                          )}
                          {t.glpiLocationName && (
                            <span className="lg:hidden text-[10px] text-on-surface-variant/70 flex items-center gap-0.5 truncate max-w-[120px]">
                              <MapPin className="w-2.5 h-2.5 shrink-0 text-primary/60" />
                              {t.glpiLocationName}
                            </span>
                          )}
                          {/* Demandeur visible sur petits écrans */}
                          {reqName && (
                            <span className="xl:hidden text-[10px] text-on-surface-variant/70 flex items-center gap-0.5 truncate max-w-[120px]">
                              <User className="w-2.5 h-2.5 shrink-0" />
                              {reqName}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-3 py-3 w-28 hidden md:table-cell" onClick={(e) => { if (canAssign) e.stopPropagation(); }}>
                        {canAssign ? (
                          <select
                            value={t.status}
                            onChange={(e) => handleQuickStatusChange(t.id, e.target.value, e)}
                            className="text-[10px] font-semibold px-2 py-1 rounded-md border border-outline-variant/40 bg-surface text-on-surface cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all w-full"
                          >
                            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
                          </select>
                        ) : (
                          <StatusPill status={t.status} />
                        )}
                      </td>

                      {/* Assignee */}
                      <td className="px-3 py-3 w-36 hidden xl:table-cell">
                        {t.assignedTo ? (
                          <div className="flex items-center gap-1.5 min-w-0" title={t.assignedTo.fullName}>
                            <Avatar name={t.assignedTo.fullName} />
                            <span className="text-xs font-medium text-on-surface truncate">{t.assignedTo.fullName}</span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-on-surface-variant/60 italic">Non assigné</span>
                        )}
                      </td>

                      {/* Requester */}
                      <td className="px-3 py-3 w-36 hidden xl:table-cell">
                        {reqName ? (
                          <div className="flex items-center gap-1.5 min-w-0" title={reqName}>
                            <Avatar name={reqName} colorClass="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20" />
                            <span className="text-xs font-medium text-on-surface truncate">{reqName}</span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-on-surface-variant/60 italic">—</span>
                        )}
                      </td>

                      {/* Lieu */}
                      <td className="px-3 py-3 w-36 hidden lg:table-cell">
                        {t.glpiLocationName ? (
                          <div className="flex items-center gap-1.5 min-w-0" title={t.glpiLocationName}>
                            <MapPin className="w-3 h-3 shrink-0 text-primary/60" />
                            <span className="text-xs font-medium text-on-surface truncate">{t.glpiLocationName}</span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-on-surface-variant/60 italic">—</span>
                        )}
                      </td>

                      {/* Ouvert le */}
                      <td
                        className="px-3 py-3 w-20 hidden lg:table-cell text-right"
                        title={`Ouvert le ${new Date(t.createdAt).toLocaleString('fr-FR')}`}
                      >
                        <span className="text-[11px] font-medium tabular-nums text-on-surface-variant">
                          {dateStr}
                        </span>
                      </td>

                      {/* Modifié le */}
                      <td
                        className="px-3 py-3 w-20 hidden xl:table-cell text-right"
                        title={`Modifié le ${t.updatedAt ? new Date(t.updatedAt).toLocaleString('fr-FR') : '—'}`}
                      >
                        <span className="text-[11px] font-medium tabular-nums text-on-surface-variant">
                          {formatDateTimeShort(t.updatedAt)}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-3 py-3 w-12">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {canDelete && (
                            <button
                              onClick={(e) => { e.stopPropagation(); askDeleteOne(t.id); }}
                              className="p-1.5 rounded-md text-on-surface-variant hover:text-red-500 hover:bg-red-500/10 transition-all"
                              title="Supprimer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <div className="p-1.5 rounded-md text-on-surface-variant group-hover:text-primary transition-colors">
                            <ChevronRight className="w-3.5 h-3.5" />
                          </div>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>

              {tickets.length === 0 && (
                <tr>
                  <td colSpan={99} className="py-16">
                    <EmptyState icon="tickets" title="Aucun ticket trouvé" description="Modifie les filtres ou crée un nouveau ticket." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ── BULK ACTIONS BAR (floating, bottom) ─────────────────────────────── */}
      <AnimatePresence>
        {selectedIds.length > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 40 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-2xl shadow-black/20"
          >
            <span className="text-xs font-bold text-on-surface-variant pr-2 border-r border-outline-variant/30 mr-1">
              {selectedIds.length} sélectionné{selectedIds.length > 1 ? 's' : ''}
            </span>
            {canAssign && (
              <>
                <select
                  value={bulkChanges.status}
                  onChange={(e) => setBulkChanges((b) => ({ ...b, status: e.target.value }))}
                  className="text-xs font-semibold px-2 py-1.5 rounded-lg border border-outline-variant/40 bg-surface text-on-surface cursor-pointer focus:outline-none"
                >
                  <option value="">Statut…</option>
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select
                  value={bulkChanges.priority}
                  onChange={(e) => setBulkChanges((b) => ({ ...b, priority: e.target.value }))}
                  className="text-xs font-semibold px-2 py-1.5 rounded-lg border border-outline-variant/40 bg-surface text-on-surface cursor-pointer focus:outline-none"
                >
                  <option value="">Priorité…</option>
                  {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <select
                  value={bulkChanges.assignedToId}
                  onChange={(e) => setBulkChanges((b) => ({ ...b, assignedToId: e.target.value }))}
                  className="text-xs font-semibold px-2 py-1.5 rounded-lg border border-outline-variant/40 bg-surface text-on-surface cursor-pointer focus:outline-none max-w-[120px]"
                >
                  <option value="">Assigner…</option>
                  <option value="none">Non assigné</option>
                  {users.filter((u) => u.isActive).map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                </select>
                <button
                  onClick={handleBulkUpdate}
                  disabled={bulkUpdating}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                  {bulkUpdating ? 'Application…' : 'Appliquer'}
                </button>
              </>
            )}
            {canBulkDelete && (
              <button
                onClick={askDeleteSelected}
                disabled={deleting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-red-500 text-xs font-semibold hover:bg-red-500/10 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Supprimer
              </button>
            )}
            <button
              onClick={() => { setSelectedIds([]); setBulkChanges({ status: '', priority: '', assignedToId: '' }); }}
              className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── PAGINATION ───────────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 sm:px-6 py-2.5 border-t border-outline-variant/20 bg-surface-container-lowest shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-on-surface-variant tabular-nums">
              {totalCount} ticket{totalCount > 1 ? 's' : ''} — p.{page}/{totalPages}
            </span>
            <select
              value={pageSize}
              onChange={(e) => { const v = Number(e.target.value); setPageSize(v); localStorage.setItem('tickets_page_size', String(v)); setPage(1); }}
              className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-outline-variant/40 bg-surface text-on-surface cursor-pointer focus:outline-none"
            >
              {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}/p</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-outline-variant/40 hover:bg-surface-container transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3.5 h-3.5 text-on-surface-variant" />
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let pageNum;
              if (totalPages <= 7) pageNum = i + 1;
              else if (page <= 4) pageNum = i + 1;
              else if (page >= totalPages - 3) pageNum = totalPages - 6 + i;
              else pageNum = page - 3 + i;
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`w-7 h-7 rounded-lg text-[11px] font-semibold transition-colors ${
                    pageNum === page ? 'bg-primary text-white' : 'text-on-surface-variant hover:bg-surface-container'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-outline-variant/40 hover:bg-surface-container transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-3.5 h-3.5 text-on-surface-variant" />
            </button>
          </div>
        </div>
      )}

      {/* ── DRAWER DE FILTRES ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {filterPanelOpen && (
          <TicketFilterDrawer
            key="tickets-filter-drawer"
            onClose={() => setFilterPanelOpen(false)}
            activeFilterCount={activeFilterCount}
            filters={filters}
            onUpdate={updateFilter}
            onClear={clearFilters}
            teams={teams}
            users={users}
            flatCategories={flatCategories}
            autonomousMode={autonomousMode}
            savedViews={savedViews}
            onSaveView={saveCurrentView}
            onRestoreView={restoreView}
            onDeleteSavedView={deleteSavedView}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            setDebouncedSearch={setDebouncedSearch}
            setPage={setPage}
          />
        )}
      </AnimatePresence>

      {/* ── CREATE TICKET MODAL ──────────────────────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {showForm && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={toggleForm}
                className="fixed inset-0 bg-black/60 backdrop-blur-sm cursor-pointer"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.97, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 12 }}
                transition={{ type: 'spring', duration: 0.3, bounce: 0.1 }}
                className={`relative max-w-3xl w-full rounded-2xl border p-6 sm:p-7 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col z-10 ${
                  isDark ? 'bg-surface-container-lowest border-outline-variant/40 text-on-surface' : 'bg-white border-slate-200 text-slate-900'
                }`}
              >
                {/* Modal header */}
                <div className="flex items-center justify-between pb-4 border-b border-outline-variant/20 mb-5 shrink-0">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 bg-primary/10 rounded-lg">
                      <Plus className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-on-surface">Nouveau ticket d'assistance</h3>
                      <p className="text-[11px] text-on-surface-variant">Remplissez les informations ci-dessous.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={toggleForm}
                    className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <form onSubmit={handleCreate} className="flex-1 overflow-y-auto space-y-4 pr-1">
                  {error && (
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-xs font-semibold flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span className="flex-1">{error}</span>
                      <button type="button" onClick={() => setError('')} className="p-0.5 hover:bg-red-500/20 rounded"><X className="w-3 h-3" /></button>
                    </div>
                  )}

                  {templates.length > 0 && (
                    <FormField label="Modèle (pré-remplissage)">
                      <select value={selectedTemplate} onChange={(e) => applyTemplate(e.target.value)} className={FIELD_CLS}>
                        <option value="">— Aucun modèle —</option>
                        {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.category ? ` (${t.category})` : ''}</option>)}
                      </select>
                    </FormField>
                  )}

                  <FormField label="Titre *">
                    <input
                      type="text" required value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      placeholder="ex: Problème d'impression ou accès réseau..."
                      className={FIELD_CLS}
                    />
                  </FormField>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField label="Catégorie">
                      <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={FIELD_CLS}>
                        <option value="">Sélectionner une catégorie</option>
                        {flatCategories.map((o) => <option key={o.id} value={o.name}>{o.label}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Priorité">
                      <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className={FIELD_CLS}>
                        {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p} — {p === 'P1' ? 'Critique' : p === 'P2' ? 'Haute' : p === 'P3' ? 'Moyenne' : 'Basse'}</option>)}
                      </select>
                    </FormField>
                  </div>

                  {/* Champs personnalisés */}
                  {customFieldDefs.length > 0 && (
                    <div className="rounded-xl border border-dashed border-primary/25 bg-primary/5 p-4 space-y-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-primary flex items-center gap-1.5">
                        <ListChecks className="w-3.5 h-3.5" /> Informations complémentaires
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {customFieldDefs.map((f) => {
                          const key = String(f.id);
                          const set = (v) => setCustomValues((prev) => ({ ...prev, [key]: v }));
                          return (
                            <div key={f.id} className={f.type === 'TEXTAREA' ? 'sm:col-span-2' : ''}>
                              <FormField label={<>{f.label} {f.required && <span className="text-red-500">*</span>}</>}>
                                {f.type === 'TEXT' && <input type="text" value={customValues[key] || ''} onChange={(e) => set(e.target.value)} className={FIELD_CLS} />}
                                {f.type === 'TEXTAREA' && <textarea rows={3} value={customValues[key] || ''} onChange={(e) => set(e.target.value)} className={`${FIELD_CLS} resize-none`} />}
                                {f.type === 'NUMBER' && <input type="number" value={customValues[key] || ''} onChange={(e) => set(e.target.value)} className={FIELD_CLS} />}
                                {f.type === 'DATE' && <input type="date" value={customValues[key] || ''} onChange={(e) => set(e.target.value)} className={FIELD_CLS} />}
                                {f.type === 'CHECKBOX' && (
                                  <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={!!customValues[key]} onChange={(e) => set(e.target.checked ? 'true' : '')} className="accent-primary w-4 h-4" />
                                    <span className="text-sm text-on-surface">{customValues[key] === 'true' ? 'Oui' : 'Non'}</span>
                                  </label>
                                )}
                                {f.type === 'SELECT' && (
                                  <select value={customValues[key] || ''} onChange={(e) => set(e.target.value)} className={`${FIELD_CLS} cursor-pointer`}>
                                    <option value="">— Sélectionner —</option>
                                    {(f.options || []).map((o) => {
                                      const v = typeof o === 'string' ? o : o.value;
                                      const l = typeof o === 'string' ? o : o.label;
                                      return <option key={v} value={v}>{l}</option>;
                                    })}
                                  </select>
                                )}
                              </FormField>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField label="Type de demande">
                      <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={FIELD_CLS}>
                        {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Source de la demande">
                      <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className={FIELD_CLS}>
                        {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </FormField>
                    {locations.length > 0 && (
                      <FormField label="Lieu / Emplacement">
                        <SearchableSelect
                          options={locations} value={form.locationId}
                          onChange={(val) => setForm({ ...form, locationId: val })}
                          placeholder="Rechercher un lieu GLPI..."
                          searchPlaceholder="Rechercher un lieu..."
                          labelKey="name" valueKey="id" subLabelKey="completename" icon={MapPin}
                        />
                      </FormField>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField label="Équipe assignée">
                      <select value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })} className={FIELD_CLS}>
                        <option value="">Sélectionner une équipe</option>
                        {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Technicien assigné">
                      <RemoteUserSelect
                        value={form.assignedToId || ''} valueLabel={users.find((u) => String(u.id) === String(form.assignedToId))?.fullName}
                        onChange={(val) => setForm({ ...form, assignedToId: val })}
                        placeholder="Auto-assignation ou technicien..."
                        searchPlaceholder="Rechercher un technicien..."
                      />
                    </FormField>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField label="Urgence">
                      <select value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })} className={FIELD_CLS}>
                        {URGENCY_IMPACT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Impact">
                      <select value={form.impact} onChange={(e) => setForm({ ...form, impact: e.target.value })} className={FIELD_CLS}>
                        {URGENCY_IMPACT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </FormField>
                  </div>

                  <FormField label="Échéance (optionnel)">
                    <input
                      type="datetime-local" value={form.dueDate}
                      onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                      className={FIELD_CLS}
                    />
                  </FormField>

                  {canAssign && (
                    <FormField label={`Demandeur (pour tiers)`}>
                      <RemoteUserSelect
                        value={form.requesterId || ''} valueLabel={users.find((u) => String(u.id) === String(form.requesterId))?.fullName}
                        onChange={(val) => setForm({ ...form, requesterId: val })}
                        placeholder={`Moi-même (${user?.fullName || ''})`}
                        searchPlaceholder="Rechercher un demandeur..."
                      />
                    </FormField>
                  )}

                  <FormField label={`Observateurs (${form.observerIds?.length || 0})`}>
                    <RemoteUserMultiSelect
                      selectedIds={form.observerIds || []}
                      onChange={(nextIds) => setForm({ ...form, observerIds: nextIds })}
                      placeholder="Rechercher des observateurs..."
                    />
                  </FormField>

                  {assetOptions.length > 0 && (
                    <FormField label={`Équipements concernés (${form.assetIds?.length || 0})`}>
                      <SearchableMultiSelect
                        options={assetOptions} selectedIds={form.assetIds || []}
                        onChange={(nextIds) => setForm({ ...form, assetIds: nextIds })}
                        placeholder="Rechercher un équipement..."
                        searchPlaceholder="Nom, n° série, inventaire..."
                        labelKey="label" valueKey="id" subLabelKey="subLabel"
                      />
                    </FormField>
                  )}

                  <FormField label="Description *">
                    <textarea
                      rows={4} required value={form.content}
                      onChange={(e) => setForm({ ...form, content: e.target.value })}
                      placeholder="Décrivez le problème ou le besoin en détails..."
                      className={`${FIELD_CLS} resize-none`}
                    />
                  </FormField>

                  <FormField label="Pièce jointe (optionnel)">
                    <input
                      type="file"
                      onChange={(e) => setAttachment(e.target.files[0])}
                      className="block w-full text-xs text-on-surface-variant file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-primary/20 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
                    />
                  </FormField>

                  <div className="pt-4 border-t border-outline-variant/20 flex justify-end gap-2.5 shrink-0">
                    <button type="button" onClick={toggleForm} className="px-4 py-2 rounded-xl border border-outline-variant/40 font-semibold text-sm transition-all bg-surface text-on-surface hover:bg-surface-container">
                      Annuler
                    </button>
                    <button
                      type="submit" disabled={creating}
                      className="px-5 py-2 rounded-xl bg-primary text-white font-bold text-sm transition-all disabled:opacity-50 hover:opacity-90 shadow-sm"
                    >
                      {creating ? 'Création...' : 'Créer le ticket'}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Supprimer le ticket"
        message={
          confirmDelete?.mode === 'bulk'
            ? `Supprimer définitivement ${selectedIds.length} ticket(s) ? Cette action est irréversible.`
            : `Supprimer définitivement le ticket #${confirmDelete?.id} ? Cette action est irréversible.`
        }
        confirmLabel="Supprimer"
        danger
        loading={deleting}
        onConfirm={confirmDeleteAction}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isDueOverdue(t) {
  if (!t?.dueDate) return false;
  if (t.status === 'SOLVED' || t.status === 'CLOSED') return false;
  return new Date(t.dueDate) < new Date();
}

const FIELD_CLS = 'w-full px-3 py-2 rounded-lg border border-outline-variant/40 bg-surface text-on-surface text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder-on-surface-variant/50';

function FormField({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-on-surface-variant mb-1.5 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

function StatPill({ color, count, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-all whitespace-nowrap"
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />
      <span className="tabular-nums font-bold text-on-surface">{count}</span>
      <span>{label}</span>
    </button>
  );
}

function ActiveChip({ label, onRemove }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container border border-outline-variant/40 text-[11px] font-medium text-on-surface whitespace-nowrap shrink-0">
      {label}
      <button onClick={onRemove} className="p-0.5 rounded-full hover:bg-outline-variant/30 transition-colors">
        <X className="w-2.5 h-2.5" />
      </button>
    </span>
  );
}

function SortTH({ field, current, order, onSort, className, children }) {
  const active = current === field;
  return (
    <th
      onClick={() => onSort(field)}
      className={`cursor-pointer select-none transition-colors hover:text-primary ${active ? 'text-primary' : ''} ${className || ''}`}
    >
      <div className="flex items-center gap-1">
        {children}
        {active ? (
          order === 'asc' ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />
        ) : (
          <ArrowUpDown className="w-2.5 h-2.5 opacity-30" />
        )}
      </div>
    </th>
  );
}
