import { useEffect, useState, useRef, useCallback } from 'react';
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
  Flame,
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
  FilterX,
  User,
  Users,
  MapPin,
  Tag,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  Settings,
  Paperclip,
  CheckSquare,
  Building2,
  Bot,
  FileText,
  MessageSquare
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { hasPermission } from '../utils/permissions';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import TicketCoverflowCarousel from '../components/TicketCoverflowCarousel';
import SearchableSelect from '../components/SearchableSelect';
import SearchableMultiSelect from '../components/SearchableMultiSelect';
import {
  STATUS_OPTIONS, PRIORITY_OPTIONS, TYPE_OPTIONS, SOURCE_OPTIONS, URGENCY_IMPACT_OPTIONS,
} from '../constants/tickets';

const EMPTY_FORM = {
  title: '',
  content: '',
  openedAt: '',
  type: 'INCIDENT',
  category: '',
  status: 'NEW',
  source: 'Helpdesk',
  urgency: 'MEDIUM',
  impact: 'MEDIUM',
  priority: 'P3',
  externalId: '',
  locationId: '',
  teamId: '',
  assignedToId: '',
  requesterId: '',
  observerIds: [],
  requiresApproval: false,
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } },
};

export default function Tickets() {
  const { user } = useAuth();
  const canAssign = hasPermission(user, 'tickets.assign') || user?.role === 'HOTLINE' || user?.role === 'SUPERADMIN';
  const canApprove = hasPermission(user, 'tickets.approve') || user?.role === 'HOTLINE' || user?.role === 'SUPERADMIN';
  const canDelete = hasPermission(user, 'tickets.delete') || user?.role === 'SUPERADMIN';
  const canBulkDelete = hasPermission(user, 'tickets.bulkDelete') || user?.role === 'SUPERADMIN';
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // State principal
  const [tickets, setTickets] = useState([]);
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [categories, setCategories] = useState([]);
  const [glpiUsers, setGlpiUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const isFirstLoad = useRef(true);

  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // Vue (Tableau vs Grille)
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('tickets_view_mode') || 'table');

  // Tri
  const [sortBy, setSortBy] = useState(() => searchParams.get('sortBy') || 'createdAt');
  const [sortOrder, setSortOrder] = useState(() => searchParams.get('sortOrder') || 'desc');

  // Filtres
  const [filters, setFilters] = useState({
    status: searchParams.get('status') || '',
    approvalStatus: searchParams.get('approvalStatus') || '',
    priority: searchParams.get('priority') || '',
    source: searchParams.get('source') || '',
    category: searchParams.get('category') || '',
    teamId: searchParams.get('teamId') || '',
    assignedToId: searchParams.get('assignedToId') || '',
    mine: searchParams.get('mine') || '',
    aiProcessed: searchParams.get('aiProcessed') || '',
  });

  const [showForm, setShowForm] = useState(searchParams.get('new') === '1');
  const [form, setForm] = useState(EMPTY_FORM);
  const [attachment, setAttachment] = useState(null);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(() => {
    const p = searchParams.get('page');
    return p ? parseInt(p, 10) : 1;
  });
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get('search') || '');
  const debounceRef = useRef(null);

  // Mémorisation de la vue
  function changeViewMode(mode) {
    setViewMode(mode);
    localStorage.setItem('tickets_view_mode', mode);
  }

  // Synchronisation URL des filtres et du tri
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (debouncedSearch) params.set('search', debouncedSearch); else params.delete('search');
    if (sortBy && sortBy !== 'createdAt') params.set('sortBy', sortBy); else params.delete('sortBy');
    if (sortOrder && sortOrder !== 'desc') params.set('sortOrder', sortOrder); else params.delete('sortOrder');
    if (page && page !== 1) params.set('page', String(page)); else params.delete('page');
    Object.entries(filters).forEach(([k, v]) => {
      if (v) params.set(k, v); else params.delete(k);
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

  const [actorSearch, setActorSearch] = useState('');
  const searchTerm = actorSearch.toLowerCase().trim();
  const filteredUsers = !searchTerm
    ? users
    : users.filter((u) => u.fullName?.toLowerCase().includes(searchTerm) || u.email?.toLowerCase().includes(searchTerm));
  const filteredTeams = !searchTerm
    ? teams
    : teams.filter((t) => t.name?.toLowerCase().includes(searchTerm));
  const showSelectionColumn = canBulkDelete;

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
    setFilters({
      status: '',
      priority: '',
      source: '',
      category: '',
      teamId: '',
      assignedToId: '',
      mine: '',
      aiProcessed: '',
    });
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
      // Premier chargement : spinner complet
      setLoading(true);
    } else {
      // Changement de filtre/recherche : indicateur discret uniquement
      setRefreshing(true);
    }
    const params = { page, limit: 50, sortBy, sortOrder };
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;
    if (filters.source) params.source = filters.source;
    if (filters.category) params.category = filters.category;
    if (filters.teamId) params.teamId = filters.teamId;
    if (filters.assignedToId) params.assignedToId = filters.assignedToId;
    if (filters.mine) params.mine = filters.mine;
    if (filters.aiProcessed) params.aiProcessed = filters.aiProcessed;
    if (debouncedSearch) params.search = debouncedSearch;

    api.get('/tickets', { params })
      .then(({ data }) => {
        setTickets(data.items);
        setTotalPages(data.pages);
        setTotalCount(data.total);
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
    const params = { page, limit: 50, sortBy, sortOrder };
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;
    if (filters.source) params.source = filters.source;
    if (filters.category) params.category = filters.category;
    if (filters.teamId) params.teamId = filters.teamId;
    if (filters.assignedToId) params.assignedToId = filters.assignedToId;
    if (filters.mine) params.mine = filters.mine;
    if (filters.aiProcessed) params.aiProcessed = filters.aiProcessed;
    if (debouncedSearch) params.search = debouncedSearch;
    api.get('/tickets', { params }).then(({ data }) => { setTickets(data.items); setTotalPages(data.pages); setTotalCount(data.total); }).catch(() => {});
  }

  useEffect(() => { loadTickets(); }, [filters, page, debouncedSearch, sortBy, sortOrder]);
  useEffect(() => {
    const intervalId = setInterval(refreshTicketsSilently, 15000);
    return () => clearInterval(intervalId);
  }, [filters, debouncedSearch, sortBy, sortOrder]);

  function toggleSelect(id) {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  }
  function toggleSelectAll() {
    setSelectedIds((ids) => (ids.length === tickets.length ? [] : tickets.map((t) => t.id)));
  }

  async function handleQuickStatusChange(ticketId, newStatus, e) {
    if (e) e.stopPropagation();
    try {
      await api.patch(`/tickets/${ticketId}`, { status: newStatus });
      toast.success(`Statut mis à jour : ${newStatus}`);
      refreshTicketsSilently();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Échec mise à jour statut');
    }
  }

  function exportCSV() {
    if (tickets.length === 0) return toast.error('Aucun ticket à exporter');
    const headers = ['ID', 'Titre', 'Statut', 'Priorité', 'Catégorie', 'Équipe', 'Assigné à', 'Demandeur', 'Lieu', 'GLPI ID', 'Date de création'];
    const rows = tickets.map((t) => [
      t.id,
      `"${(t.title || '').replace(/"/g, '""')}"`,
      t.status,
      t.priority,
      `"${(t.category || '').replace(/"/g, '""')}"`,
      `"${(t.team?.name || '').replace(/"/g, '""')}"`,
      `"${(t.assignedTo?.fullName || 'Non assigné').replace(/"/g, '""')}"`,
      `"${(t.requester?.fullName || '').replace(/"/g, '""')}"`,
      `"${(t.glpiLocationName || '').replace(/"/g, '""')}"`,
      t.glpiTicketId || '',
      new Date(t.createdAt).toLocaleString('fr-FR'),
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,﻿' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `export_tickets_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`${tickets.length} ticket(s) exporté(s) en CSV`);
  }

  function exportJSON() {
    if (tickets.length === 0) return toast.error('Aucun ticket à exporter');
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(tickets, null, 2));
    const link = document.createElement('a');
    link.setAttribute('href', dataStr);
    link.setAttribute('download', `export_tickets_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`${tickets.length} ticket(s) exporté(s) en JSON`);
  }

  const [confirmDelete, setConfirmDelete] = useState(null);
  const [hoveredTicket, setHoveredTicket] = useState(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const hoverTimer = useRef(null);
  const leaveTimer = useRef(null);
  const mousePos = useRef({ x: 0, y: 0 });

  const handleMouseMove = useCallback((e) => {
    mousePos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleRowEnter = useCallback((ticket) => {
    clearTimeout(leaveTimer.current);
    const panelW = 340;
    const panelH = 420;
    const gap = 14;
    hoverTimer.current = setTimeout(() => {
      const { x: mx, y: my } = mousePos.current;
      setHoveredTicket(ticket);
      let px = mx + gap;
      let py = my - 20;
      if (px + panelW > window.innerWidth - 16) px = mx - panelW - gap;
      if (px < 16) px = 16;
      if (py + panelH > window.innerHeight - 16) py = window.innerHeight - panelH - 16;
      if (py < 16) py = 16;
      setHoverPos({ x: px, y: py });
    }, 250);
  }, []);

  const handleRowLeave = useCallback(() => {
    clearTimeout(hoverTimer.current);
    leaveTimer.current = setTimeout(() => setHoveredTicket(null), 150);
  }, []);

  const handlePreviewEnter = useCallback(() => { clearTimeout(leaveTimer.current); }, []);
  const handlePreviewLeave = useCallback(() => { leaveTimer.current = setTimeout(() => setHoveredTicket(null), 150); }, []);

  const ticketStats = (() => {
    const total = totalCount;
    const open = tickets.filter((t) => t.status === 'NEW' || t.status === 'OPEN').length;
    const pending = tickets.filter((t) => t.status === 'PENDING').length;
    const resolved = tickets.filter((t) => t.status === 'SOLVED' || t.status === 'CLOSED').length;
    const p1 = tickets.filter((t) => t.priority === 'P1').length;
    const p2 = tickets.filter((t) => t.priority === 'P2').length;
    const ai = tickets.filter((t) => t.aiProcessed).length;
    return { total, open, pending, resolved, p1, p2, ai };
  })();

  function askDeleteOne(id) { setConfirmDelete({ mode: 'one', id }); }
  function askDeleteSelected() { if (selectedIds.length > 0) setConfirmDelete({ mode: 'bulk' }); }

  async function confirmDeleteAction() {
    if (!confirmDelete) return;
    setDeleting(true);
    setError('');
    try {
      if (confirmDelete.mode === 'one') {
        await api.delete(`/tickets/${confirmDelete.id}`);
        toast.success('Ticket supprimé');
      } else {
        await api.post('/tickets/bulk-delete', { ids: selectedIds });
        toast.success(`${selectedIds.length} ticket(s) supprimé(s)`);
      }
      loadTickets();
      setConfirmDelete(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    api.get('/glpi/locations').then(({ data }) => setLocations(data)).catch(() => {});
    api.get('/glpi/categories').then(({ data }) => setCategories(data)).catch(() => {});
    api.get('/glpi/users').then(({ data }) => setGlpiUsers(data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!canAssign) return;
    api.get('/teams').then(({ data }) => setTeams(data)).catch(() => {});
    api.get('/users').then(({ data }) => setUsers(Array.isArray(data) ? data : (data.users || []))).catch(() => {});
  }, [canAssign]);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      const payload = new FormData();
      Object.entries(form).forEach(([key, value]) => {
        if (key === 'observerIds') {
          if (value.length > 0) payload.append('observerIds', JSON.stringify(value));
          return;
        }
        if (value !== '' && value !== undefined && value !== null) payload.append(key, value);
      });
      if (attachment) payload.append('attachment', attachment);
      await api.post('/tickets', payload, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Ticket créé');
      setForm(EMPTY_FORM);
      setAttachment(null);
      setShowForm(false);
      setSearchParams({});
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
      if (next.get('new') === '1') next.delete('new');
      else next.set('new', '1');
      return next;
    });
  }

  useEffect(() => {
    if (!showForm) return;
    const onKey = (e) => { if (e.key === 'Escape') toggleForm(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm]);

  const hasActiveFilters = Boolean(
    filters.status || filters.priority || filters.source || filters.category ||
    filters.teamId || filters.assignedToId || filters.mine || filters.aiProcessed || searchQuery
  );

  return (
    <motion.div
      className="max-w-full mx-auto w-full space-y-6 px-4 sm:px-6 lg:px-8 min-w-0 pt-4 sm:pt-6 pb-8"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Hero Header SEVEN-T */}
      <div className="p-6 sm:p-8 rounded-2xl sm:rounded-3xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-blue-500/10 rounded-xl">
                <Ticket className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-display font-bold truncate text-on-surface">Tickets</h1>
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold uppercase tracking-wider animate-pulse border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Live
              </span>
            </div>
            <p className="text-sm sm:text-base text-on-surface-variant font-medium">Gérez, filtrez et suivez en temps réel l'ensemble des tickets d'assistance IT.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={toggleForm}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-xs flex items-center gap-2 transition-all shadow-md shadow-blue-500/20 hover:brightness-110 cursor-pointer"
            >
              {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {showForm ? 'Fermer' : 'Nouveau Ticket'}
            </motion.button>
            <button
              onClick={() => loadTickets(true)}
              disabled={refreshing}
              className="p-2 rounded-xl border border-outline-variant/40 bg-surface-container hover:bg-surface-container-high text-on-surface-variant transition-all disabled:opacity-50"
              title="Rafraîchir les tickets"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            {/* 3-way View Mode Toggle: Tableau, Grille, Coverflow 3D */}
            <div className="p-1 rounded-xl border border-outline-variant/30 bg-surface-container flex items-center gap-1">
              <button
                onClick={() => changeViewMode('table')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-blue-600 text-white shadow-sm font-bold'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
                title="Vue Tableau"
              >
                <Table className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Tableau</span>
              </button>
              <button
                onClick={() => changeViewMode('grid')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  viewMode === 'grid'
                    ? 'bg-blue-600 text-white shadow-sm font-bold'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
                title="Vue Grille"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Grille</span>
              </button>
              <button
                onClick={() => changeViewMode('carousel')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  viewMode === 'carousel'
                    ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-sm font-bold'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
                title="Vue Coverflow 3D Carousel"
              >
                <Sparkles className="w-3.5 h-3.5 text-purple-300" />
                <span className="hidden sm:inline">Coverflow 3D</span>
              </button>
            </div>
          </div>
        </div>

        {/* Bento Stat Items — affichage uniquement */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 mt-6">
          {[
            { label: 'Total',      value: ticketStats.total,    Icon: Ticket,       color: 'text-blue-600 dark:text-blue-400 bg-blue-500/10'    },
            { label: 'Ouverts',    value: ticketStats.open,     Icon: Radio,        color: 'text-amber-600 dark:text-amber-400 bg-amber-500/10'  },
            { label: 'En attente', value: ticketStats.pending,  Icon: Clock,        color: 'text-yellow-600 dark:text-yellow-400 bg-yellow-500/10'},
            { label: 'Résolus',    value: ticketStats.resolved, Icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'},
            { label: 'P1 Critique',value: ticketStats.p1,       Icon: Flame,        color: 'text-red-600 dark:text-red-400 bg-red-500/10'      },
            { label: 'P2 Haute',   value: ticketStats.p2,       Icon: AlertTriangle,color: 'text-orange-600 dark:text-orange-400 bg-orange-500/10'},
            { label: 'IA Process', value: ticketStats.ai,       Icon: Sparkles,     color: 'text-purple-600 dark:text-purple-400 bg-purple-500/10'},
          ].map((s) => {
            const IconComponent = s.Icon;
            return (
              <div
                key={s.label}
                className="p-3 rounded-2xl border border-outline-variant/30 bg-surface-container-low/40 flex flex-col items-start"
              >
                <div className={`p-2 rounded-xl mb-2 ${s.color}`}>
                  <IconComponent className="w-4 h-4" />
                </div>
                <p className="text-xl font-bold leading-none mb-1 text-on-surface">{s.value}</p>
                <p className="text-[10px] uppercase font-black tracking-wider truncate w-full text-on-surface-variant">{s.label}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* MODALE DE CRÉATION DE TICKET SEVEN-T */}
      {createPortal(
        <AnimatePresence>
          {showForm && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={toggleForm}
                className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer"
              />

              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 16 }}
                transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }}
                className={`relative max-w-2xl w-full rounded-3xl border p-6 sm:p-8 card-shadow overflow-hidden max-h-[90vh] flex flex-col z-10 ${
                  isDark ? 'bg-surface-container-lowest border-outline-variant/60 text-on-surface' : 'bg-white border-slate-200 text-slate-900'
                }`}
              >
                <div className="flex items-center justify-between pb-4 border-b border-outline-variant/30 mb-6 shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-xl border border-blue-500/20">
                      <Plus className="size-6 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold font-display text-on-surface">Nouveau Ticket d'Assistance</h3>
                      <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">Remplissez les informations ci-dessous pour ouvrir une demande.</p>
                    </div>
                  </div>
                  <motion.button
                    type="button"
                    onClick={toggleForm}
                    whileHover={{ scale: 1.1, rotate: 90 }}
                    whileTap={{ scale: 0.9 }}
                    className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </motion.button>
                </div>

                <form onSubmit={handleCreate} className="flex-1 overflow-y-auto space-y-5 pr-1">
                  {error && (
                    <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-xs font-bold flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span className="flex-1">{error}</span>
                      <button type="button" onClick={() => setError('')} className="p-1 hover:bg-red-500/20 rounded-lg">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <div>
                    <label className="block text-[11px] font-extrabold uppercase tracking-wider mb-2 text-slate-700 dark:text-slate-300">Titre de la demande *</label>
                    <input
                      type="text"
                      required
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      placeholder="ex: Problème d'impression ou d'accès réseau..."
                      className="w-full px-4 py-2.5 rounded-xl border font-medium text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-surface border-outline-variant/60 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-extrabold uppercase tracking-wider mb-2 text-slate-700 dark:text-slate-300">Catégorie</label>
                      <select
                        value={form.category}
                        onChange={(e) => setForm({ ...form, category: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border font-medium text-sm transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-surface border-outline-variant/60 text-slate-900 dark:text-white"
                      >
                        <option value="">Sélectionner une catégorie</option>
                        {categories.map((c) => (
                          <option key={c.id || c.name} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-extrabold uppercase tracking-wider mb-2 text-slate-700 dark:text-slate-300">Priorité</label>
                      <select
                        value={form.priority}
                        onChange={(e) => setForm({ ...form, priority: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border font-medium text-sm transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-surface border-outline-variant/60 text-slate-900 dark:text-white"
                      >
                        {PRIORITY_OPTIONS.map((p) => (
                          <option key={p} value={p}>{p} - {p === 'P1' ? 'Critique' : p === 'P2' ? 'Haute' : p === 'P3' ? 'Moyenne' : 'Basse'}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-extrabold uppercase tracking-wider mb-2 text-slate-700 dark:text-slate-300">Type de demande</label>
                      <select
                        value={form.type}
                        onChange={(e) => setForm({ ...form, type: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border font-medium text-sm transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-surface border-outline-variant/60 text-slate-900 dark:text-white"
                      >
                        {TYPE_OPTIONS.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>

                    {locations.length > 0 && (
                      <div>
                        <label className="block text-[11px] font-extrabold uppercase tracking-wider mb-2 text-slate-700 dark:text-slate-300">Lieu / Emplacement</label>
                        <SearchableSelect
                          options={locations}
                          value={form.locationId}
                          onChange={(val) => setForm({ ...form, locationId: val })}
                          placeholder="Rechercher un lieu GLPI..."
                          searchPlaceholder="Rechercher un lieu par nom..."
                          labelKey="name"
                          valueKey="id"
                          subLabelKey="completename"
                          icon={MapPin}
                        />
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-extrabold uppercase tracking-wider mb-2 text-slate-700 dark:text-slate-300">Équipe assignée</label>
                      <select
                        value={form.teamId}
                        onChange={(e) => setForm({ ...form, teamId: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border font-medium text-sm transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-surface border-outline-variant/60 text-slate-900 dark:text-white"
                      >
                        <option value="">Sélectionner une équipe</option>
                        {teams.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-extrabold uppercase tracking-wider mb-2 text-slate-700 dark:text-slate-300">Technicien assigné</label>
                      <SearchableSelect
                        options={users}
                        value={form.assignedToId}
                        onChange={(val) => setForm({ ...form, assignedToId: val })}
                        placeholder="Auto-assignation ou rechercher un technicien..."
                        searchPlaceholder="Rechercher un technicien par nom ou email..."
                        labelKey="fullName"
                        valueKey="id"
                        subLabelKey="email"
                        icon={User}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-extrabold uppercase tracking-wider mb-2 text-slate-700 dark:text-slate-300">Urgence</label>
                      <select
                        value={form.urgency}
                        onChange={(e) => setForm({ ...form, urgency: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border font-medium text-sm transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-surface border-outline-variant/60 text-slate-900 dark:text-white"
                      >
                        {URGENCY_IMPACT_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-extrabold uppercase tracking-wider mb-2 text-slate-700 dark:text-slate-300">Impact</label>
                      <select
                        value={form.impact}
                        onChange={(e) => setForm({ ...form, impact: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border font-medium text-sm transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-surface border-outline-variant/60 text-slate-900 dark:text-white"
                      >
                        {URGENCY_IMPACT_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {canAssign && (
                    <div>
                      <label className="block text-[11px] font-extrabold uppercase tracking-wider mb-2 text-slate-700 dark:text-slate-300">Demandeur (Création pour un tier)</label>
                      <SearchableSelect
                        options={users}
                        value={form.requesterId}
                        onChange={(val) => setForm({ ...form, requesterId: val })}
                        placeholder={`Moi-même (${user?.fullName || ''})`}
                        searchPlaceholder="Rechercher un demandeur par nom ou email..."
                        labelKey="fullName"
                        valueKey="id"
                        subLabelKey="email"
                        icon={User}
                      />
                    </div>
                  )}

                  {/* Observateurs avec barre de recherche intégrée */}
                  <div>
                    <label className="block text-[11px] font-extrabold uppercase tracking-wider mb-2 text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-purple-500" />
                      Observateurs du ticket ({form.observerIds?.length || 0})
                    </label>
                    <SearchableMultiSelect
                      options={users}
                      selectedIds={form.observerIds || []}
                      onChange={(nextIds) => setForm({ ...form, observerIds: nextIds })}
                      placeholder="Rechercher des observateurs par nom ou email..."
                      labelKey="fullName"
                      valueKey="id"
                      subLabelKey="email"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-extrabold uppercase tracking-wider mb-2 text-slate-700 dark:text-slate-300">Description détaillée *</label>
                    <textarea
                      rows={4}
                      required
                      value={form.content}
                      onChange={(e) => setForm({ ...form, content: e.target.value })}
                      placeholder="Décrivez votre problème ou besoin en détails..."
                      className="w-full px-4 py-2.5 rounded-xl border font-medium text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none bg-surface border-outline-variant/60 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-extrabold uppercase tracking-wider mb-2 text-slate-700 dark:text-slate-300">Pièce jointe (optionnel)</label>
                    <input
                      type="file"
                      onChange={(e) => setAttachment(e.target.files[0])}
                      className="block w-full text-xs text-slate-600 dark:text-slate-400 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border file:border-blue-500/20 file:text-xs file:font-bold file:bg-blue-500/10 file:text-blue-600 dark:file:text-blue-400 hover:file:bg-blue-500/20 cursor-pointer"
                    />
                  </div>

                  <div className="pt-4 border-t border-outline-variant/30 flex justify-end gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={toggleForm}
                      className="px-4 py-2.5 rounded-xl border border-outline-variant/40 font-semibold text-sm transition-all cursor-pointer bg-surface text-on-surface hover:bg-surface-container"
                    >
                      Annuler
                    </button>
                    <button
                      type="submit"
                      disabled={creating}
                      className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-sm transition-all shadow-md shadow-blue-500/20 disabled:opacity-50 hover:brightness-110 cursor-pointer"
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

      {/* BARRE DE FILTRES BENTO */}
      <motion.div variants={itemVariants} className="bento-card p-lg space-y-md">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-md">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 w-full lg:w-auto">
            {/* Recherche */}
            <div className="col-span-2 flex flex-col gap-1">
              <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Recherche</span>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Titre, n° ticket, contenu, lieu..."
                  className="w-full pl-9 pr-8 py-2 rounded-xl border border-outline-variant bg-surface text-on-surface font-body-sm text-body-sm transition-all focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none"
                />
                {searchQuery && (
                  <button
                    onClick={() => { setSearchQuery(''); setDebouncedSearch(''); setPage(1); }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <FilterSelect value={filters.status} onChange={(v) => updateFilter('status', v)}
              label="Statut" options={[
                { v: '', l: 'Tous les statuts' },
                { v: 'NEW', l: 'Nouveau' },
                { v: 'OPEN', l: 'Ouvert' },
                { v: 'PENDING', l: 'En attente' },
                { v: 'SOLVED', l: 'Résolu' },
                { v: 'CLOSED', l: 'Fermé' },
              ]} />

            <FilterSelect value={filters.approvalStatus} onChange={(v) => updateFilter('approvalStatus', v)}
              label="Approbation" options={[
                { v: '', l: 'Toutes' },
                { v: 'PENDING', l: '🛡️ En attente Hotline' },
                { v: 'APPROVED', l: '✅ Approuvés' },
                { v: 'REJECTED', l: '❌ Rejetés' },
              ]} />

            <FilterSelect value={filters.priority} onChange={(v) => updateFilter('priority', v)}
              label="Priorité" options={[
                { v: '', l: 'Toutes' },
                { v: 'P1', l: '🚨 P1 - Critique' },
                { v: 'P2', l: '⚠️ P2 - Haute' },
                { v: 'P3', l: '🔹 P3 - Moyenne' },
                { v: 'P4', l: '🌱 P4 - Basse' },
              ]} />

            <FilterSelect value={filters.source} onChange={(v) => updateFilter('source', v)}
              label="Source" options={[
                { v: '', l: 'Toutes les sources' },
                { v: 'glpi', l: '🔗 Synchronisés GLPI' },
                { v: 'erp', l: '💻 Internes ERP' },
              ]} />

            <FilterSelect value={filters.teamId} onChange={(v) => updateFilter('teamId', v)}
              label="Équipe" options={[
                { v: '', l: 'Toutes les équipes' },
                ...teams.map((t) => ({ v: String(t.id), l: t.name })),
              ]} />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary/10 text-primary text-body-sm font-semibold hover:bg-primary/20 transition-colors"
              >
                <FilterX className="w-4 h-4" />
                Réinitialiser
              </button>
            )}
            {canBulkDelete && selectedIds.length > 0 && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                onClick={askDeleteSelected}
                disabled={deleting}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-error/30 text-error font-body-sm text-body-sm font-semibold hover:bg-error/5 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                Supprimer ({selectedIds.length})
              </motion.button>
            )}
          </div>
        </div>

        {/* Jetons de filtres rapides */}
        <div className="flex items-center gap-2 pt-xs overflow-x-auto pb-1">
          <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mr-1">Raccourcis:</span>
          <ChipFilter
            active={filters.mine === 'true'}
            onClick={() => updateFilter('mine', filters.mine === 'true' ? '' : 'true')}
            Icon={User}
            label="Mes tickets"
          />
          <ChipFilter
            active={filters.aiProcessed === 'true'}
            onClick={() => updateFilter('aiProcessed', filters.aiProcessed === 'true' ? '' : 'true')}
            Icon={Sparkles}
            label="Traité par IA"
          />
          <ChipFilter
            active={filters.priority === 'P1'}
            onClick={() => updateFilter('priority', filters.priority === 'P1' ? '' : 'P1')}
            Icon={Flame}
            label="Critiques P1"
          />
        </div>
      </motion.div>

      {/* CONTENU PRINCIPAL */}
      <div className="relative">
        {/* Overlay de chargement discret (filtre/recherche) */}
        {refreshing && !loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none rounded-2xl">
            <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold shadow-lg ${
              isDark ? 'bg-space-800/90 text-zinc-300 border border-space-700' : 'bg-white/90 text-gray-600 border border-gray-200'
            }`}>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Mise à jour...
            </div>
          </div>
        )}

        {loading ? (
          <div className="bento-card p-xl flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-8 h-8 animate-spin text-primary" />
            <p className="font-body-md text-body-md text-on-surface-variant">Chargement des tickets...</p>
          </div>
        ) : viewMode === 'carousel' ? (
          <motion.div variants={itemVariants} className="w-full">
            <TicketCoverflowCarousel tickets={tickets} isDark={isDark} />
          </motion.div>
      ) : viewMode === 'grid' ? (
        <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-md">
          <AnimatePresence mode="popLayout">
            {tickets.map((t, idx) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.2, delay: idx * 0.03 }}
                onClick={() => navigate(`/tickets/${t.id}`)}
                className="bento-card p-md flex flex-col justify-between hover:border-primary/50 transition-all cursor-pointer group relative overflow-hidden"
              >
                <div className={`absolute top-0 left-0 right-0 h-1 ${
                  t.status === 'NEW' ? 'bg-amber-500' :
                  t.status === 'OPEN' ? 'bg-blue-500' :
                  t.status === 'PENDING' ? 'bg-yellow-500' :
                  t.status === 'SOLVED' ? 'bg-emerald-500' : 'bg-slate-400'
                }`} />

                <div className="space-y-sm pt-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs text-primary font-bold">#{t.id}</span>
                      {t.glpiTicketId && (
                        <span className="px-2 py-0.5 rounded-full border border-outline-variant/60 bg-surface-container-low text-[10px] text-on-surface-variant font-medium flex items-center gap-1">
                          <RefreshCw className="w-3 h-3" />
                          #{t.glpiTicketId}
                        </span>
                      )}
                      {t.aiProcessed && (
                        <span className="px-2 py-0.5 rounded-full border border-primary/20 bg-primary/5 text-primary text-[10px] font-medium flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          IA
                        </span>
                      )}
                    </div>
                    <PriorityBadge priority={t.priority} />
                  </div>

                  <div>
                    <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold group-hover:text-primary transition-colors line-clamp-2">
                      {t.title}
                    </h3>
                    {t.category && (
                      <span className="inline-block mt-1 text-[11px] font-medium text-on-surface-variant bg-surface-container-high px-2.5 py-0.5 rounded-full">
                        {t.category}
                      </span>
                    )}
                  </div>

                  {t.glpiLocationName && (
                    <div className="flex items-center gap-1 text-[12px] text-on-surface-variant truncate">
                      <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="truncate">{t.glpiLocationName}</span>
                    </div>
                  )}
                </div>

                <div className="pt-md mt-md border-t border-outline-variant/40 flex items-center justify-between gap-2 text-body-sm">
                  {canAssign ? (
                    <div onClick={(e) => e.stopPropagation()}>
                      <select
                        value={t.status}
                        onChange={(e) => handleQuickStatusChange(t.id, e.target.value, e)}
                        className="text-xs font-semibold px-2 py-1 rounded-lg border border-outline-variant/60 bg-surface text-on-surface hover:border-primary transition-all cursor-pointer"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <StatusBadge status={t.status} />
                  )}

                  <div className="flex items-center gap-2">
                    {t.assignedTo ? (
                      <div className="flex items-center gap-1.5" title={`Assigné à : ${t.assignedTo.fullName}`}>
                        <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold border border-primary/20">
                          {t.assignedTo.fullName?.charAt(0)?.toUpperCase()}
                        </div>
                        <span className="text-xs font-medium text-on-surface truncate max-w-[90px]">{t.assignedTo.fullName}</span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-outline italic">Non assigné</span>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {tickets.length === 0 && (
            <div className="col-span-full py-12">
              <EmptyState
                icon="tickets"
                title="Aucun ticket trouvé"
                description="Modifie les filtres ou crée un nouveau ticket."
              />
            </div>
          )}
        </motion.div>
      ) : (
        <motion.div variants={itemVariants} className="rounded-2xl border border-outline-variant/30 overflow-hidden bg-surface-container-lowest shadow-sm">
          {/* Table Header */}
          <div className={`flex items-center gap-4 px-5 py-3 border-b text-[11px] font-black uppercase tracking-widest select-none ${
            isDark ? 'border-outline-variant/30 text-slate-400 bg-surface-container-low/40' : 'border-slate-200/80 text-slate-600 bg-slate-100/70'
          }`}>
            {showSelectionColumn && (
              <div className="w-5 shrink-0">
                <input type="checkbox"
                  checked={tickets.length > 0 && selectedIds.length === tickets.length}
                  onChange={toggleSelectAll}
                  className="cursor-pointer accent-primary w-4 h-4 rounded"
                />
              </div>
            )}
            <div className="w-9 shrink-0" />
            <div className="flex-1 min-w-0">Ticket</div>
            <div className="w-28 shrink-0 hidden md:block">Statut</div>
            <div className="w-28 shrink-0 hidden lg:block">Priorité</div>
            <div className="w-36 shrink-0 hidden xl:block">Assigné à</div>
            <div className="w-24 shrink-0 hidden lg:block text-right">Date</div>
            <div className="w-16 shrink-0" />
          </div>

          {/* Rows */}
          <div className="divide-y divide-outline-variant/20">
            <AnimatePresence mode="popLayout">
              {tickets.map((t, idx) => {
                const PCOLOR = {
                  P1: { bg: 'bg-red-500',    ring: 'ring-red-500/30',    text: 'text-red-600 dark:text-red-400 font-bold',    badge: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400 border border-red-200 dark:border-red-500/25 font-bold'    },
                  P2: { bg: 'bg-orange-500', ring: 'ring-orange-500/30', text: 'text-orange-600 dark:text-orange-400 font-bold', badge: 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 border border-orange-200 dark:border-orange-500/25 font-bold' },
                  P3: { bg: 'bg-amber-500',  ring: 'ring-amber-500/30',  text: 'text-amber-700 dark:text-amber-400 font-bold',  badge: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400 border border-amber-300 dark:border-amber-500/25 font-bold'  },
                  P4: { bg: 'bg-blue-500',   ring: 'ring-blue-500/30',   text: 'text-blue-600 dark:text-blue-400 font-bold',   badge: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400 border border-blue-200 dark:border-blue-500/25 font-bold'   },
                }[t.priority] || { bg: 'bg-slate-500', ring: 'ring-slate-500/30', text: 'text-slate-600 dark:text-slate-400', badge: 'bg-slate-50 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300 border border-slate-200 dark:border-slate-500/25 font-bold' };

                const SCOLOR = {
                  NEW:     'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400 border border-blue-200 dark:border-blue-500/25 font-bold',
                  OPEN:    'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/25 font-bold',
                  PENDING: 'bg-amber-50 text-amber-800 dark:bg-yellow-500/15 dark:text-yellow-400 border border-amber-300 dark:border-yellow-500/25 font-bold',
                  SOLVED:  'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/25 font-bold',
                  CLOSED:  'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-400 border border-slate-300 dark:border-slate-500/25 font-bold',
                }[t.status] || 'bg-slate-50 text-slate-700 border border-slate-200 font-bold';

                const SLABEL = { NEW: 'Nouveau', OPEN: 'En cours', PENDING: 'En attente', SOLVED: 'Résolu', CLOSED: 'Fermé' }[t.status] || t.status;
                const PLABEL = { P1: 'P1 Critique', P2: 'P2 Haute', P3: 'P3 Moyenne', P4: 'P4 Basse' }[t.priority] || t.priority;

                const PIcon = { P1: Flame, P2: AlertTriangle, P3: Info, P4: ArrowDown }[t.priority] || Ticket;

                const dateStr = new Date(t.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });

                return (
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.18, delay: idx * 0.012, ease: [0.16, 1, 0.3, 1] }}
                    layout
                    onClick={() => navigate(`/tickets/${t.id}`)}
                    onMouseMove={handleMouseMove}
                    onMouseEnter={() => handleRowEnter(t)}
                    onMouseLeave={handleRowLeave}
                    className="flex items-center gap-4 px-5 py-3.5 cursor-pointer group transition-colors hover:bg-slate-50/80 dark:hover:bg-white/[0.03]"
                  >
                    {/* Checkbox */}
                    {showSelectionColumn && (
                      <div className="w-5 shrink-0" onClick={e => e.stopPropagation()}>
                        <input type="checkbox"
                          checked={selectedIds.includes(t.id)}
                          onChange={() => toggleSelect(t.id)}
                          className="cursor-pointer accent-primary w-4 h-4 rounded"
                        />
                      </div>
                    )}

                    {/* Priority Icon */}
                    <div className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ring-1 ${PCOLOR.ring}`}>
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${PCOLOR.badge}`}>
                        <PIcon className="w-4 h-4" />
                      </div>
                    </div>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`font-mono text-[10px] font-bold ${PCOLOR.text}`}>#{t.id}</span>
                        {t.aiProcessed && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400 text-[9px] font-bold border border-purple-200 dark:border-purple-500/20">
                            <Sparkles className="w-2.5 h-2.5" />IA
                          </span>
                        )}
                        {t.glpiTicketId && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 dark:bg-surface-container-high dark:text-on-surface-variant text-[9px] font-semibold border border-slate-200 dark:border-outline-variant/50">
                            <RefreshCw className="w-2.5 h-2.5" />GLPI
                          </span>
                        )}
                      </div>
                      <p className="font-bold text-sm text-slate-900 dark:text-white truncate leading-tight group-hover:text-primary transition-colors">
                        {t.title}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {t.category && (
                          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 truncate">
                            {t.category}
                          </span>
                        )}
                        {t.glpiLocationName && (
                          <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400 flex items-center gap-0.5 truncate max-w-[140px]">
                            <MapPin className="w-2.5 h-2.5 shrink-0 text-primary" />
                            {t.glpiLocationName}
                          </span>
                        )}
                        {!t.category && !t.glpiLocationName && (
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-500">
                            {t.team?.name || 'Aucune équipe'}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Status badge / Select */}
                    <div className="w-28 shrink-0 hidden md:block" onClick={e => { if (canAssign) e.stopPropagation(); }}>
                      {canAssign ? (
                        <select
                          value={t.status}
                          onChange={(e) => handleQuickStatusChange(t.id, e.target.value, e)}
                          className={`text-[10px] font-bold px-2.5 py-1 rounded-full border cursor-pointer transition-all w-full focus:outline-none focus:ring-2 focus:ring-primary/20 ${SCOLOR}`}
                        >
                          {STATUS_OPTIONS.map(s => <option key={s} value={s} className="bg-surface text-on-surface">{s}</option>)}
                        </select>
                      ) : (
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold border ${SCOLOR}`}>
                          {SLABEL}
                        </span>
                      )}
                    </div>

                    {/* Priority badge */}
                    <div className="w-28 shrink-0 hidden lg:block">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border ${PCOLOR.badge}`}>
                        <PIcon className="w-3 h-3" />
                        {PLABEL}
                      </span>
                    </div>

                    {/* Assigned to */}
                    <div className="w-36 shrink-0 hidden xl:flex items-center gap-2">
                      {t.assignedTo ? (
                        <div className="flex items-center gap-2 min-w-0" title={`Assigné à : ${t.assignedTo.fullName}`}>
                          <div className="w-6 h-6 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center text-[10px] font-bold border border-blue-500/20 shrink-0">
                            {t.assignedTo.fullName?.charAt(0)?.toUpperCase()}
                          </div>
                          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{t.assignedTo.fullName}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500 dark:text-slate-400 italic font-medium">Non assigné</span>
                      )}
                    </div>

                    {/* Date */}
                    <div className="w-24 shrink-0 hidden lg:block text-right">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{dateStr}</span>
                    </div>

                    {/* Actions */}
                    <div className="w-16 shrink-0 flex items-center justify-end gap-1">
                      {canDelete && (
                        <button
                          onClick={(e) => { e.stopPropagation(); askDeleteOne(t.id); }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
                          title="Supprimer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <div className="p-1.5 rounded-lg text-slate-400 group-hover:text-primary group-hover:bg-primary/10 transition-all">
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {tickets.length === 0 && (
              <div className="py-16 flex flex-col items-center justify-center">
                <EmptyState
                  icon="tickets"
                  title="Aucun ticket trouvé"
                  description="Modifie les filtres ou crée un nouveau ticket."
                />
              </div>
            )}
          </div>
        </motion.div>
      )}

      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <motion.div variants={itemVariants}
          className="flex items-center justify-between px-4 py-3 rounded-xl border border-outline-variant/60 bg-surface-container-lowest"
        >
          <span className="text-[12px] text-on-surface-variant">
            {totalCount} ticket{totalCount > 1 ? 's' : ''} — Page {page}/{totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-outline-variant/60 hover:bg-surface-container-low transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4 text-on-surface-variant" />
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
                  className={`w-8 h-8 rounded-lg text-[12px] font-semibold transition-colors ${
                    pageNum === page
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-on-surface-variant hover:bg-surface-container-low'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-outline-variant/60 hover:bg-surface-container-low transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4 text-on-surface-variant" />
            </button>
          </div>
        </motion.div>
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
    </motion.div>
  );
}

function TH({ children, className }) {
  return (
    <th className={`px-md py-3.5 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider whitespace-nowrap ${className || ''}`}>
      {children}
    </th>
  );
}

function SortableTH({ children, field, current, order, onSort, className }) {
  const isActive = current === field;
  return (
    <th
      onClick={() => onSort(field)}
      className={`px-md py-3.5 font-label-md text-label-md uppercase tracking-wider whitespace-nowrap cursor-pointer transition-colors hover:text-primary ${
        isActive ? 'text-primary font-bold' : 'text-on-surface-variant'
      } ${className || ''}`}
    >
      <div className="flex items-center gap-1">
        <span>{children}</span>
        {isActive ? (
          order === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />
        ) : (
          <ArrowUpDown className="w-3.5 h-3.5 text-outline/50" />
        )}
      </div>
    </th>
  );
}

function FilterSelect({ value, onChange, label, options }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">{label}</span>
      <select
        className="px-3 py-2 rounded-xl border border-outline-variant bg-surface text-on-surface font-body-sm text-body-sm hover:bg-surface-container-low transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.v} value={o.v} disabled={o.disabled}>{o.l}</option>
        ))}
      </select>
    </label>
  );
}

function ChipFilter({ active, onClick, Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap border ${
        active
          ? 'bg-primary text-white border-primary shadow-sm'
          : 'bg-surface border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

const STATUS_CONFIG = {
  NEW: { label: 'Nouveau', bg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20', Icon: Sparkles },
  OPEN: { label: 'Ouvert', bg: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20', Icon: Radio },
  PENDING: { label: 'En attente', bg: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20', Icon: Clock },
  SOLVED: { label: 'Résolu', bg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20', Icon: CheckCircle2 },
  CLOSED: { label: 'Fermé', bg: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20', Icon: Lock },
};

const PRIORITY_CONFIG = {
  P1: { label: 'P1 - Critique', bg: 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30', Icon: Flame },
  P2: { label: 'P2 - Haute', bg: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20', Icon: AlertTriangle },
  P3: { label: 'P3 - Moyenne', bg: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20', Icon: Info },
  P4: { label: 'P4 - Basse', bg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20', Icon: ArrowDown },
};

function StatusBadge({ status }) {
  const conf = STATUS_CONFIG[status] || STATUS_CONFIG.NEW;
  const Icon = conf.Icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${conf.bg}`}>
      <Icon className="w-3.5 h-3.5" />
      {conf.label}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const conf = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.P3;
  const Icon = conf.Icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${conf.bg}`}>
      <Icon className="w-3.5 h-3.5" />
      {conf.label}
    </span>
  );
}
