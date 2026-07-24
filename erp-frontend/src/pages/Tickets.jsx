import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';

const STATUS_OPTIONS = ['NEW', 'OPEN', 'PENDING', 'SOLVED', 'CLOSED'];
const PRIORITY_OPTIONS = ['P1', 'P2', 'P3', 'P4'];
const TYPE_OPTIONS = [
  { value: 'INCIDENT', label: 'Incident' },
  { value: 'REQUEST', label: 'Demande' },
];
const SOURCE_OPTIONS = ['Helpdesk', 'Email', 'Téléphone'];
const URGENCY_IMPACT_OPTIONS = [
  { value: 'VERY_LOW', label: 'Très basse' },
  { value: 'LOW', label: 'Basse' },
  { value: 'MEDIUM', label: 'Moyenne' },
  { value: 'HIGH', label: 'Haute' },
  { value: 'VERY_HIGH', label: 'Très haute' },
  { value: 'MAJOR', label: 'Majeure' },
];

const PRIORITY_LABEL = {
  P1: 'Critique',
  P2: 'Haute',
  P3: 'Moyenne',
  P4: 'Basse',
};

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
  const canAssign = hasPermission(user, 'tickets.assign');
  const canDelete = hasPermission(user, 'tickets.delete');
  const canBulkDelete = hasPermission(user, 'tickets.bulkDelete');
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

  // Vue (Tableau vs Grille)
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('tickets_view_mode') || 'table');

  // Tri
  const [sortBy, setSortBy] = useState(() => searchParams.get('sortBy') || 'createdAt');
  const [sortOrder, setSortOrder] = useState(() => searchParams.get('sortOrder') || 'desc');

  // Filtres
  const [filters, setFilters] = useState({
    status: searchParams.get('status') || '',
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
  const [page, setPage] = useState(1);
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
    Object.entries(filters).forEach(([k, v]) => {
      if (v) params.set(k, v); else params.delete(k);
    });
    setSearchParams(params, { replace: true });
  }, [debouncedSearch, sortBy, sortOrder, filters]);

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
    if (isManualRefresh) setRefreshing(true); else setLoading(true);
    const params = { page, limit: 100, sortBy, sortOrder };
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
      .finally(() => { setLoading(false); setRefreshing(false); });
  }

  function refreshTicketsSilently() {
    const params = { page, limit: 100, sortBy, sortOrder };
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

  // Changement rapide de statut depuis la liste/grille
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

  // Exportation CSV
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

  // Exportation JSON
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
    setSearchParams({});
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
      className="p-lg space-y-lg"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* ── En-tête ─────────────────────────────────────────────────────────── */}
      <motion.header variants={itemVariants} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-background tracking-tight flex items-center gap-3">
            Tickets
            <span className="text-body-md font-semibold px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
              {totalCount}
            </span>
          </h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant">Gestion, filtres et suivi temps réel des demandes IT.</p>
        </div>

        {/* Action bar (Refresh, View switcher, Export, New Ticket) */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Bouton Rafraîchir */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => loadTickets(true)}
            disabled={refreshing}
            title="Rafraîchir les tickets"
            className="p-2.5 rounded-xl border border-outline-variant/60 bg-surface-container-low hover:bg-surface-container-high text-on-surface transition-all disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-[18px] block ${refreshing ? 'animate-spin' : ''}`}>
              refresh
            </span>
          </motion.button>

          {/* Mode d'affichage (Tableau vs Grille) */}
          <div className="flex items-center p-1 rounded-xl bg-surface-container-high/60 border border-outline-variant/40">
            <button
              onClick={() => changeViewMode('table')}
              title="Vue Tableau"
              className={`p-1.5 rounded-lg transition-all ${viewMode === 'table' ? 'bg-primary text-white shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}
            >
              <span className="material-symbols-outlined text-[18px] block">table_rows</span>
            </button>
            <button
              onClick={() => changeViewMode('grid')}
              title="Vue Grille (Cartes)"
              className={`p-1.5 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-primary text-white shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}
            >
              <span className="material-symbols-outlined text-[18px] block">grid_view</span>
            </button>
          </div>

          {/* Exporter */}
          <div className="relative group">
            <button
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-outline-variant/60 bg-surface-container-low hover:bg-surface-container-high text-on-surface font-semibold text-body-sm transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              <span>Exporter</span>
            </button>
            <div className="absolute right-0 top-full mt-1 hidden group-hover:flex flex-col bg-surface-container-lowest border border-outline-variant/60 rounded-xl shadow-xl py-1 z-20 min-w-[140px]">
              <button
                onClick={exportCSV}
                className="px-4 py-2 text-left font-body-sm text-body-sm text-on-surface hover:bg-primary/10 hover:text-primary flex items-center gap-2 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">csv</span>
                Export CSV
              </button>
              <button
                onClick={exportJSON}
                className="px-4 py-2 text-left font-body-sm text-body-sm text-on-surface hover:bg-primary/10 hover:text-primary flex items-center gap-2 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">javascript</span>
                Export JSON
              </button>
            </div>
          </div>

          {/* Nouveau Ticket */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={toggleForm}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl btn-gradient font-body-sm text-body-sm font-semibold shadow-md shadow-primary/10 hover:shadow-lg transition-all whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-[18px]">{showForm ? 'close' : 'add'}</span>
            {showForm ? 'Fermer' : 'Nouveau ticket'}
          </motion.button>
        </div>
      </motion.header>

      {/* ── Message d'erreur ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            role="alert"
            className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL DE CRÉATION DE TICKET */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {createPortal(
        <AnimatePresence>
          {showForm && (
            <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8 sm:pt-12 overflow-y-auto">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={toggleForm}
                className="absolute inset-0 bg-black/60 backdrop-blur-[2px] cursor-pointer"
              />

              <motion.form
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ type: 'spring', duration: 0.35, bounce: 0.12 }}
                onSubmit={handleCreate}
                className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto card-shadow flex flex-col"
              >
                <div className="sticky top-0 z-10 bg-surface-container-lowest rounded-t-2xl border-b border-outline-variant/40">
                  <div className="bento-card-header">
                    <h3 className="font-headline-md text-headline-md text-on-background flex items-center gap-2 font-bold">
                      <span className="material-symbols-outlined text-primary text-[20px]">add_circle</span>
                      Nouveau ticket
                    </h3>
                    <motion.button
                      type="button"
                      onClick={toggleForm}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      className="text-on-surface-variant hover:text-on-surface transition-colors"
                    >
                      <span className="material-symbols-outlined">close</span>
                    </motion.button>
                  </div>
                </div>

                <div className="p-lg flex flex-col gap-lg">
                  <div className="flex flex-col lg:flex-row gap-lg">
                    <div className="flex-1 min-w-0 flex flex-col gap-md">
                      <FieldRow label="Titre" required>
                        <input
                          className="w-full h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all font-body-md text-body-md text-on-surface"
                          value={form.title}
                          onChange={(e) => setForm({ ...form, title: e.target.value })}
                          required
                        />
                      </FieldRow>
                      <FieldRow label="Description" required>
                        <textarea
                          className="w-full px-sm py-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all font-body-md text-body-md text-on-surface min-h-[200px]"
                          value={form.content}
                          onChange={(e) => setForm({ ...form, content: e.target.value })}
                          required
                        />
                      </FieldRow>
                      <FieldRow label="Pièce jointe (2 Mio max)">
                        <input
                          type="file"
                          className="font-body-sm text-body-sm text-on-surface-variant file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 file:transition-all file:duration-300 file:cursor-pointer cursor-pointer"
                          onChange={(e) => setAttachment(e.target.files?.[0] || null)}
                        />
                      </FieldRow>
                    </div>

                    <div className="w-full lg:w-80 xl:w-96 shrink-0 flex flex-col gap-md">
                      <div className="bg-surface-bright/35 border border-outline-variant/65 p-md rounded-2xl flex flex-col gap-sm">
                        <h4 className="font-headline-sm text-headline-sm text-on-background font-semibold flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[16px] text-on-surface-variant">settings</span>
                          Propriétés
                        </h4>
                        <div className="grid grid-cols-1 gap-x-md gap-y-sm">
                          <SelectRow label="Type">
                            <select className="h-9 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all font-body-sm text-body-sm text-on-surface w-full"
                              value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                            >{TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
                          </SelectRow>
                          <SelectRow label="Catégorie">
                            <select className="h-9 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all font-body-sm text-body-sm text-on-surface w-full"
                              value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                            ><option value="">-----</option>{categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select>
                          </SelectRow>
                          <SelectRow label="Lieu">
                            <select className="h-9 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all font-body-sm text-body-sm text-on-surface w-full"
                              value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}
                            ><option value="">Sélectionner un lieu</option>{locations.map((l) => <option key={l.glpiLocationId} value={l.glpiLocationId}>{l.completename || l.name}</option>)}</select>
                          </SelectRow>
                          {canAssign && (
                            <SelectRow label="Statut">
                              <select className="h-9 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all font-body-sm text-body-sm text-on-surface w-full"
                                value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                              >{STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                            </SelectRow>
                          )}
                          <SelectRow label="Source">
                            <select className="h-9 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all font-body-sm text-body-sm text-on-surface w-full"
                              value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}
                            >{SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                          </SelectRow>
                          <SelectRow label="Priorité">
                            <select className="h-9 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all font-body-sm text-body-sm text-on-surface w-full"
                              value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}
                            >{PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}</select>
                          </SelectRow>
                          <div className="grid grid-cols-2 gap-x-md gap-y-sm">
                            <SelectRow label="Urgence">
                              <select className="h-9 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all font-body-sm text-body-sm text-on-surface w-full"
                                value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })}
                              >{URGENCY_IMPACT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                            </SelectRow>
                            <SelectRow label="Impact">
                              <select className="h-9 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all font-body-sm text-body-sm text-on-surface w-full"
                                value={form.impact} onChange={(e) => setForm({ ...form, impact: e.target.value })}
                              >{URGENCY_IMPACT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                            </SelectRow>
                          </div>
                          <SelectRow label="Date d'ouverture">
                            <input type="datetime-local" className="h-9 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all font-body-sm text-body-sm text-on-surface w-full"
                              value={form.openedAt} onChange={(e) => setForm({ ...form, openedAt: e.target.value })}
                            />
                          </SelectRow>
                          <SelectRow label="ID externe">
                            <input className="h-9 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all font-body-sm text-body-sm text-on-surface w-full"
                              value={form.externalId} onChange={(e) => setForm({ ...form, externalId: e.target.value })}
                            />
                          </SelectRow>
                          <label className="flex items-center gap-2 font-body-sm text-body-sm text-on-surface-variant cursor-pointer select-none pt-1">
                            <input type="checkbox" className="w-4 h-4 rounded accent-primary cursor-pointer"
                              checked={form.requiresApproval} onChange={(e) => setForm({ ...form, requiresApproval: e.target.checked })}
                            />
                            <span className="material-symbols-outlined text-[16px]">fact_check</span>
                            Approbation
                          </label>
                        </div>
                      </div>

                      {canAssign && (
                        <div className="bg-surface-bright/35 border border-outline-variant/65 p-md rounded-2xl flex flex-col gap-sm">
                          <h4 className="font-headline-sm text-headline-sm text-on-background font-semibold flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[16px] text-on-surface-variant">people</span>
                            Acteurs
                          </h4>

                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[14px] text-on-surface-variant pointer-events-none">search</span>
                            <input
                              className="w-full h-9 pl-8 pr-8 rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all font-body-sm text-body-sm text-on-surface"
                              placeholder="Rechercher…"
                              value={actorSearch}
                              onChange={(e) => setActorSearch(e.target.value)}
                            />
                            {actorSearch && (
                              <button
                                type="button"
                                onClick={() => setActorSearch('')}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
                              >
                                <span className="material-symbols-outlined text-[14px]">close</span>
                              </button>
                            )}
                          </div>

                          <div className="flex flex-col gap-sm">
                            <SelectRow label="Demandeur">
                              <select className="h-9 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all font-body-sm text-body-sm text-on-surface w-full"
                                value={form.requesterId} onChange={(e) => setForm({ ...form, requesterId: e.target.value })}
                              ><option value="">Moi-même</option>{filteredUsers.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select>
                            </SelectRow>
                            <SelectRow label="Observateur(s)">
                              <div className="w-full min-h-[140px] px-sm py-1 rounded-xl border border-outline-variant bg-surface focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-all font-body-sm text-body-sm text-on-surface overflow-y-auto flex flex-col gap-0.5">
                                {filteredUsers.length === 0 ? (
                                  <span className="text-outline/60 italic font-body-sm text-body-sm py-1 px-1">Aucun utilisateur trouvé</span>
                                ) : (
                                  filteredUsers.map((u) => {
                                    const isSelected = form.observerIds.includes(u.id);
                                    return (
                                      <label
                                        key={u.id}
                                        className={`flex items-center gap-2 px-2 py-1 rounded-lg cursor-pointer transition-colors ${
                                          isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-surface-container-low text-on-surface'
                                        }`}
                                      >
                                        <input
                                          type="checkbox"
                                          className="accent-primary w-3.5 h-3.5 rounded cursor-pointer"
                                          checked={isSelected}
                                          onChange={() => {
                                            setForm((prev) => ({
                                              ...prev,
                                              observerIds: isSelected
                                                ? prev.observerIds.filter((id) => id !== u.id)
                                                : [...prev.observerIds, u.id],
                                            }));
                                          }}
                                        />
                                        <span className="font-body-sm text-body-sm">{u.fullName}</span>
                                      </label>
                                    );
                                  })
                                )}
                              </div>
                            </SelectRow>
                            <SelectRow label="Assigné à">
                              <select className="h-9 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all font-body-sm text-body-sm text-on-surface w-full"
                                value={form.assignedToId} onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}
                              ><option value="">Non assigné</option>{filteredUsers.map((u) => {
                                const isGlpi = glpiUsers.some((gu) => gu.id === u.id);
                                return <option key={u.id} value={u.id}>{u.fullName}{isGlpi ? ' 🔗' : ''}</option>;
                              })}</select>
                            </SelectRow>
                            <SelectRow label="Équipe">
                              <select className="h-9 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all font-body-sm text-body-sm text-on-surface w-full"
                                value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })}
                              ><option value="">Aucune</option>{filteredTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                            </SelectRow>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-sm pt-4 border-t border-outline-variant/50 justify-end">
                    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} type="button" onClick={toggleForm}
                      className="px-5 py-2.5 rounded-xl border border-outline-variant text-on-surface font-semibold text-body-sm hover:bg-surface-container-low transition-colors"
                    >
                      Annuler
                    </motion.button>
                    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} type="submit" disabled={creating}
                      className="px-5 py-2.5 rounded-xl btn-gradient font-semibold text-body-sm shadow-md shadow-primary/20 hover:shadow-lg transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                      {creating && <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>}
                      {creating ? 'Création...' : 'Créer le ticket'}
                    </motion.button>
                  </div>
                </div>
              </motion.form>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ── STATISTIQUES INTERACTIVES (BENTO CARDS CLIQUABLES) ───────────────── */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: 'Total', value: ticketStats.total, icon: 'confirmation_number', color: '#3B82F6', filterKey: 'status', filterVal: '' },
          { label: 'Ouverts', value: ticketStats.open, icon: 'radio_button_checked', color: '#F97316', filterKey: 'status', filterVal: 'OPEN_GROUP' },
          { label: 'En attente', value: ticketStats.pending, icon: 'hourglass_empty', color: '#EAB308', filterKey: 'status', filterVal: 'PENDING' },
          { label: 'Résolus', value: ticketStats.resolved, icon: 'check_circle', color: '#10B981', filterKey: 'status', filterVal: 'CLOSED_GROUP' },
          { label: 'P1 - Critique', value: ticketStats.p1, icon: 'emergency', color: '#EF4444', filterKey: 'priority', filterVal: 'P1' },
          { label: 'P2 - Haute', value: ticketStats.p2, icon: 'report', color: '#F97316', filterKey: 'priority', filterVal: 'P2' },
          { label: 'IA Process', value: ticketStats.ai, icon: 'smart_toy', color: '#8B5CF6', filterKey: 'aiProcessed', filterVal: 'true' },
        ].map((s) => {
          const isActive = filters[s.filterKey] === s.filterVal && (s.filterVal !== '' || (!filters.status && !filters.priority && !filters.aiProcessed));
          return (
            <motion.div
              key={s.label}
              whileHover={{ y: -2, scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => updateFilter(s.filterKey, isActive && s.filterVal !== '' ? '' : s.filterVal)}
              className={`bento-card px-4 py-3 flex items-center gap-3 min-w-0 cursor-pointer transition-all border ${
                isActive ? 'border-primary shadow-sm shadow-primary/10 bg-primary/5' : 'hover:border-outline-variant'
              }`}
            >
              <span className="material-symbols-outlined text-[22px] shrink-0" style={{ color: s.color }}>{s.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant truncate">{s.label}</p>
                <motion.p
                  key={s.value}
                  initial={{ scale: 1.15, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="text-lg font-bold tabular-nums text-on-surface leading-tight"
                >
                  {s.value}
                </motion.p>
              </div>
            </motion.div>
          );
        })}
      </motion.div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* BARRE DE FILTRES BENTO & RECHERCHE AVANCÉE */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <motion.div variants={itemVariants} className="bento-card p-lg space-y-md">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-md">
          {/* Grille de filtres */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 w-full lg:w-auto">
            {/* Recherche */}
            <div className="col-span-2 flex flex-col gap-1">
              <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Recherche</span>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-outline">search</span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Titre, n° ticket, contenu, lieu..."
                  className="w-full pl-9 pr-8 py-2 rounded-xl border border-outline-variant bg-surface text-on-surface font-body-sm text-body-sm transition-all focus:border-primary focus:outline-none"
                />
                {searchQuery && (
                  <button
                    onClick={() => { setSearchQuery(''); setDebouncedSearch(''); setPage(1); }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface transition-colors"
                  >
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                )}
              </div>
            </div>

            <FilterSelect value={filters.status} onChange={(v) => updateFilter('status', v)}
              label="Statut" options={[
                { v: '', l: 'Tous les statuts' },
                { v: 'OPEN_GROUP', l: '⚡ Tickets ouverts' },
                { v: 'CLOSED_GROUP', l: '✅ Tickets fermés' },
                { v: 'NEW', l: 'Nouveau' },
                { v: 'OPEN', l: 'Ouvert' },
                { v: 'PENDING', l: 'En attente' },
                { v: 'SOLVED', l: 'Résolu' },
                { v: 'CLOSED', l: 'Fermé' },
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

          {/* Actions filtres */}
          <div className="flex items-center gap-2 shrink-0">
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary/10 text-primary text-body-sm font-semibold hover:bg-primary/20 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">filter_alt_off</span>
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
                <span className="material-symbols-outlined text-[18px]">delete</span>
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
            icon="person"
            label="Mes tickets"
          />
          <ChipFilter
            active={filters.aiProcessed === 'true'}
            onClick={() => updateFilter('aiProcessed', filters.aiProcessed === 'true' ? '' : 'true')}
            icon="smart_toy"
            label="Traité par IA"
          />
          <ChipFilter
            active={filters.priority === 'P1'}
            onClick={() => updateFilter('priority', filters.priority === 'P1' ? '' : 'P1')}
            icon="emergency"
            label="Critiques P1"
          />
        </div>
      </motion.div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* CONTENU PRINCIPAL : TABLEAU OU GRILLE */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {loading ? (
        <div className="bento-card p-xl flex flex-col items-center justify-center gap-3">
          <span className="material-symbols-outlined animate-spin text-primary text-3xl">progress_activity</span>
          <p className="font-body-md text-body-md text-on-surface-variant">Chargement des tickets...</p>
        </div>
      ) : viewMode === 'grid' ? (
        /* ── VUE GRILLE (BENTO CARDS) ────────────────────────────────────────── */
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
                {/* Status indicator bar top */}
                <div className={`absolute top-0 left-0 right-0 h-1 ${
                  t.status === 'NEW' ? 'bg-amber-500' :
                  t.status === 'OPEN' ? 'bg-blue-500' :
                  t.status === 'PENDING' ? 'bg-yellow-500' :
                  t.status === 'SOLVED' ? 'bg-emerald-500' : 'bg-slate-400'
                }`} />

                <div className="space-y-sm pt-1">
                  {/* Top row badges */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs text-primary font-bold">#{t.id}</span>
                      {t.glpiTicketId && (
                        <span className="px-2 py-0.5 rounded-full border border-outline-variant/60 bg-surface-container-low text-[10px] text-on-surface-variant font-medium flex items-center gap-1">
                          <span className="material-symbols-outlined text-[11px]">sync</span>
                          #{t.glpiTicketId}
                        </span>
                      )}
                      {t.aiProcessed && (
                        <span className="px-2 py-0.5 rounded-full border border-primary/20 bg-primary/5 text-primary text-[10px] font-medium flex items-center gap-1">
                          <span className="material-symbols-outlined text-[11px]">smart_toy</span>
                          IA
                        </span>
                      )}
                    </div>
                    <PriorityBadge priority={t.priority} />
                  </div>

                  {/* Title & Category */}
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

                  {/* Location if any */}
                  {t.glpiLocationName && (
                    <div className="flex items-center gap-1 text-[12px] text-on-surface-variant truncate">
                      <span className="material-symbols-outlined text-[14px] text-primary">location_on</span>
                      <span className="truncate">{t.glpiLocationName}</span>
                    </div>
                  )}
                </div>

                {/* Footer card */}
                <div className="pt-md mt-md border-t border-outline-variant/40 flex items-center justify-between gap-2 text-body-sm">
                  {/* Quick status change or badge */}
                  {canAssign ? (
                    <div onClick={(e) => e.stopPropagation()}>
                      <select
                        value={t.status}
                        onChange={(e) => handleQuickStatusChange(t.id, e.target.value, e)}
                        className="text-xs font-semibold px-2 py-1 rounded-lg border border-outline-variant/60 bg-surface text-on-surface hover:border-primary transition-all"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <StatusBadge status={t.status} />
                  )}

                  {/* Assignee & Date */}
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
        /* ── VUE TABLEAU MODERNE ────────────────────────────────────────────── */
        <motion.div variants={itemVariants} className="bento-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[900px]">
              <thead>
                <tr className="bg-surface-bright/50 dark:bg-[rgba(129,140,248,0.03)] border-b border-outline-variant/60 select-none">
                  {showSelectionColumn && (
                    <th className="px-md py-3.5 w-10">
                      <input type="checkbox"
                        checked={tickets.length > 0 && selectedIds.length === tickets.length}
                        onChange={toggleSelectAll}
                        className="cursor-pointer accent-primary w-4 h-4"
                      />
                    </th>
                  )}
                  <SortableTH field="id" current={sortBy} order={sortOrder} onSort={toggleSort}>ID</SortableTH>
                  <SortableTH field="createdAt" current={sortBy} order={sortOrder} onSort={toggleSort}>Date</SortableTH>
                  <SortableTH field="title" current={sortBy} order={sortOrder} onSort={toggleSort}>Titre</SortableTH>
                  <TH className="w-16">IA</TH>
                  <TH className="w-28">GLPI</TH>
                  <SortableTH field="status" current={sortBy} order={sortOrder} onSort={toggleSort} className="w-36">Statut</SortableTH>
                  <SortableTH field="priority" current={sortBy} order={sortOrder} onSort={toggleSort} className="w-32">Priorité</SortableTH>
                  <TH className="w-36">Équipe</TH>
                  <SortableTH field="assignedTo" current={sortBy} order={sortOrder} onSort={toggleSort} className="w-44">Assigné à</SortableTH>
                  <SortableTH field="requester" current={sortBy} order={sortOrder} onSort={toggleSort} className="w-44">Demandeur</SortableTH>
                  {canDelete && <TH className="w-12"></TH>}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/30">
                <AnimatePresence mode="popLayout">
                  {tickets.map((t, idx) => (
                    <motion.tr
                      key={t.id}
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.2, delay: idx * 0.015, ease: [0.16, 1, 0.3, 1] }}
                      className="hover:bg-surface-container-low/60 transition-colors group cursor-pointer"
                      layout
                      onMouseMove={handleMouseMove}
                      onMouseEnter={() => handleRowEnter(t)}
                      onMouseLeave={handleRowLeave}
                      onClick={() => navigate(`/tickets/${t.id}`)}
                    >
                      {showSelectionColumn && (
                        <td className="px-md py-3.5" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selectedIds.includes(t.id)}
                            onChange={() => toggleSelect(t.id)} className="cursor-pointer accent-primary w-4 h-4"
                          />
                        </td>
                      )}
                      <td className="px-md py-3.5 font-mono-sm text-mono-sm text-outline font-bold">
                        #{t.id}
                      </td>
                      <td className="px-md py-3.5 text-on-surface-variant text-body-sm whitespace-nowrap">
                        {new Date(t.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </td>
                      <td className="px-md py-3.5">
                        <div className="flex flex-col">
                          <span className="font-medium text-on-surface group-hover:text-primary transition-colors line-clamp-1">
                            {t.title}
                          </span>
                          <div className="flex items-center gap-2 mt-0.5">
                            {t.category && (
                              <span className="text-[10px] font-medium text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded-full">
                                {t.category}
                              </span>
                            )}
                            {t.glpiLocationName && (
                              <span className="text-[11px] text-on-surface-variant flex items-center gap-0.5 truncate max-w-[150px]">
                                <span className="material-symbols-outlined text-[12px] text-primary">location_on</span>
                                <span className="truncate">{t.glpiLocationName}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-md py-3.5">
                        {t.aiProcessed && (
                          <span title="Traité par l'agent IA"
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-primary/20 bg-primary/5 text-primary font-medium text-[10px]"
                          >
                            <span className="material-symbols-outlined text-[12px]">smart_toy</span>
                            IA
                          </span>
                        )}
                      </td>
                      <td className="px-md py-3.5">
                        {t.glpiTicketId ? (
                          <span title="Synchronisé avec GLPI"
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-outline-variant bg-surface-container-low text-on-surface-variant font-medium text-[10px]"
                          >
                            <span className="material-symbols-outlined text-[12px]">sync</span>
                            #{t.glpiTicketId}
                          </span>
                        ) : (
                          <span className="text-outline/60 italic text-[11px]">Interne</span>
                        )}
                      </td>
                      <td className="px-md py-3.5" onClick={(e) => e.stopPropagation()}>
                        {canAssign ? (
                          <select
                            value={t.status}
                            onChange={(e) => handleQuickStatusChange(t.id, e.target.value, e)}
                            className="text-xs font-semibold px-2 py-1 rounded-lg border border-outline-variant/60 bg-surface text-on-surface hover:border-primary transition-all cursor-pointer"
                          >
                            {STATUS_OPTIONS.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        ) : (
                          <StatusBadge status={t.status} />
                        )}
                      </td>
                      <td className="px-md py-3.5">
                        <PriorityBadge priority={t.priority} />
                      </td>
                      <td className="px-md py-3.5 text-on-surface-variant text-body-sm font-medium">{t.team?.name || '-'}</td>
                      <td className="px-md py-3.5 text-on-surface text-body-sm">
                        {t.assignedTo ? (
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0 border border-primary/20">
                              {t.assignedTo.fullName?.charAt(0)?.toUpperCase()}
                            </div>
                            <span className="font-medium truncate max-w-[120px]">{t.assignedTo.fullName}</span>
                          </div>
                        ) : (
                          <span className="text-outline/65 italic text-xs font-medium">Non assigné</span>
                        )}
                      </td>
                      <td className="px-md py-3.5 text-on-surface-variant text-body-sm">
                        {t.requester ? (
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-surface-container-high text-on-surface flex items-center justify-center text-[10px] font-bold shrink-0 border border-outline-variant/60">
                              {t.requester.fullName?.charAt(0)?.toUpperCase()}
                            </div>
                            <span className="font-medium truncate max-w-[120px]">{t.requester.fullName}</span>
                          </div>
                        ) : (
                          <span className="text-outline/65 italic text-xs font-medium">-</span>
                        )}
                      </td>
                      {canDelete && (
                        <td className="px-md py-3.5" onClick={(e) => e.stopPropagation()}>
                          <motion.button
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            onClick={() => askDeleteOne(t.id)}
                            title="Supprimer ce ticket"
                            className="text-outline/50 hover:text-error transition-all opacity-60 lg:opacity-0 lg:group-hover:opacity-100"
                          >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </motion.button>
                        </td>
                      )}
                    </motion.tr>
                  ))}
                </AnimatePresence>
                {tickets.length === 0 && (
                  <tr>
                    <td colSpan={10 + (showSelectionColumn ? 1 : 0) + (canDelete ? 1 : 0)} className="px-md py-12 text-center">
                      <EmptyState
                        icon="tickets"
                        title="Aucun ticket trouvé"
                        description="Modifie les filtres ou crée un nouveau ticket."
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* ── Pagination ──────────────────────────────────────────────────────── */}
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
              <span className="material-symbols-outlined text-sm text-on-surface-variant">chevron_left</span>
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
              <span className="material-symbols-outlined text-sm text-on-surface-variant">chevron_right</span>
            </button>
          </div>
        </motion.div>
      )}

      {/* ── Ticket Hover Preview ─────────────────────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {hoveredTicket && (
            <motion.div
              initial={{ opacity: 0, x: -8, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -8, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="ticket-preview-panel"
              style={{ top: hoverPos.y, left: hoverPos.x }}
              onMouseEnter={handlePreviewEnter}
              onMouseLeave={handlePreviewLeave}
            >
              <div className="ticket-preview-header">
                <span className="font-mono text-[11px] text-primary font-bold">#{hoveredTicket.id}</span>
                <StatusBadge status={hoveredTicket.status} />
                <PriorityBadge priority={hoveredTicket.priority} />
              </div>
              <h4 className="ticket-preview-title">{hoveredTicket.title}</h4>
              {hoveredTicket.content && (
                <p className="ticket-preview-content">{hoveredTicket.content}</p>
              )}
              <div className="ticket-preview-meta">
                {hoveredTicket.category && (
                  <div className="ticket-preview-meta-row">
                    <span className="material-symbols-outlined text-[13px]">category</span>
                    <span>{hoveredTicket.category}</span>
                  </div>
                )}
                {hoveredTicket.glpiLocationName && (
                  <div className="ticket-preview-meta-row">
                    <span className="material-symbols-outlined text-[13px]">location_on</span>
                    <span>{hoveredTicket.glpiLocationName}</span>
                  </div>
                )}
                {hoveredTicket.requester?.fullName && (
                  <div className="ticket-preview-meta-row">
                    <span className="material-symbols-outlined text-[13px]">person</span>
                    <span>{hoveredTicket.requester.fullName}</span>
                  </div>
                )}
                {hoveredTicket.assignedTo?.fullName && (
                  <div className="ticket-preview-meta-row">
                    <span className="material-symbols-outlined text-[13px]">person_pin</span>
                    <span>{hoveredTicket.assignedTo.fullName}</span>
                  </div>
                )}
                <div className="ticket-preview-meta-row">
                  <span className="material-symbols-outlined text-[13px]">schedule</span>
                  <span>{new Date(hoveredTicket.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
              <div className="ticket-preview-footer">
                <span className="material-symbols-outlined text-[12px] text-primary">arrow_forward</span>
                <span className="text-[11px] text-primary font-semibold">Voir les détails</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ── ConfirmDialog ──────────────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!confirmDelete}
        title="Supprimer le ticket"
        message={
          confirmDelete?.mode === 'bulk'
            ? `Supprimer définitivement ${selectedIds.length} ticket(s) ? Cette action est irréversible et supprime aussi le(s) ticket(s) GLPI lié(s).`
            : `Supprimer définitivement le ticket #${confirmDelete?.id} ? Cette action est irréversible et supprime aussi le ticket GLPI lié.`
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

/* ── Sous-composants ────────────────────────────────────────────────────────── */

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
        <span className="material-symbols-outlined text-[14px]">
          {isActive ? (order === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
        </span>
      </div>
    </th>
  );
}

function FieldRow({ label, required, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-label-md text-label-md text-on-surface-variant uppercase flex items-center gap-1">
        {label}
        {required && <span className="text-error text-[10px]">*</span>}
      </span>
      {children}
    </label>
  );
}

function SelectRow({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-label-md text-label-md text-on-surface-variant uppercase text-[11px]">{label}</span>
      {children}
    </label>
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
          <option key={o.v} value={o.v}>{o.l}</option>
        ))}
      </select>
    </label>
  );
}

function ChipFilter({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap border ${
        active
          ? 'bg-primary text-white border-primary shadow-sm'
          : 'bg-surface border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high'
      }`}
    >
      <span className="material-symbols-outlined text-[13px]">{icon}</span>
      {label}
    </button>
  );
}

const STATUS_CONFIG = {
  NEW: { label: 'Nouveau', bg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20', icon: 'star' },
  OPEN: { label: 'Ouvert', bg: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20', icon: 'radio_button_checked' },
  PENDING: { label: 'En attente', bg: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20', icon: 'hourglass_empty' },
  SOLVED: { label: 'Résolu', bg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20', icon: 'check_circle' },
  CLOSED: { label: 'Fermé', bg: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20', icon: 'lock' },
};

const PRIORITY_CONFIG = {
  P1: { label: 'P1 - Critique', bg: 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30', icon: 'emergency' },
  P2: { label: 'P2 - Haute', bg: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20', icon: 'report' },
  P3: { label: 'P3 - Moyenne', bg: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20', icon: 'info' },
  P4: { label: 'P4 - Basse', bg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20', icon: 'arrow_downward' },
};

function StatusBadge({ status }) {
  const conf = STATUS_CONFIG[status] || STATUS_CONFIG.NEW;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${conf.bg}`}>
      <span className="material-symbols-outlined text-[13px]">{conf.icon}</span>
      {conf.label}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const conf = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.P3;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${conf.bg}`}>
      <span className="material-symbols-outlined text-[13px]">{conf.icon}</span>
      {conf.label}
    </span>
  );
}
