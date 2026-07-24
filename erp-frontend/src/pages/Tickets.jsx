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

/* ── Container variants pour stagger ────────────────────────────────────────── */
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
  const [tickets, setTickets] = useState([]);
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [categories, setCategories] = useState([]);
  const [glpiUsers, setGlpiUsers] = useState([]);
  const [filters, setFilters] = useState({
    status: searchParams.get('status') || '',
    priority: searchParams.get('priority') || '',
    source: searchParams.get('source') || '',
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

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (debouncedSearch) { params.set('search', debouncedSearch); } else { params.delete('search'); }
    setSearchParams(params, { replace: true });
  }, [debouncedSearch]);

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
    : users.filter((u) =>
        u.fullName?.toLowerCase().includes(searchTerm) ||
        u.email?.toLowerCase().includes(searchTerm)
      );
  const filteredTeams = !searchTerm
    ? teams
    : teams.filter((t) =>
        t.name?.toLowerCase().includes(searchTerm)
      );
  const showSelectionColumn = canBulkDelete;

  function updateFilter(key, value) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    setPage(1);
    const params = new URLSearchParams(searchParams);
    if (value) { params.set(key, value); } else { params.delete(key); }
    setSearchParams(params, { replace: true });
  }

  function clearFilters() {
    setFilters({ status: '', priority: '', source: '' });
    setPage(1);
    const params = new URLSearchParams(searchParams);
    params.delete('status');
    params.delete('priority');
    params.delete('source');
    setSearchParams(params, { replace: true });
  }

  function loadTickets() {
    const params = { page, limit: 100 };
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;
    if (filters.source) params.source = filters.source;
    if (debouncedSearch) params.search = debouncedSearch;
    api.get('/tickets', { params })
      .then(({ data }) => { setTickets(data.items); setTotalPages(data.pages); setTotalCount(data.total); setSelectedIds([]); })
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
  }

  function refreshTicketsSilently() {
    const params = { page, limit: 100 };
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;
    if (filters.source) params.source = filters.source;
    if (debouncedSearch) params.search = debouncedSearch;
    api.get('/tickets', { params }).then(({ data }) => { setTickets(data.items); setTotalPages(data.pages); }).catch(() => {});
  }

  useEffect(loadTickets, [filters, page, debouncedSearch]);
  useEffect(() => {
    const intervalId = setInterval(refreshTicketsSilently, 15000);
    return () => clearInterval(intervalId);
  }, [filters, debouncedSearch]);

  function toggleSelect(id) {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  }
  function toggleSelectAll() {
    setSelectedIds((ids) => (ids.length === tickets.length ? [] : tickets.map((t) => t.id)));
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

  const handlePreviewEnter = useCallback(() => {
    clearTimeout(leaveTimer.current);
  }, []);

  const handlePreviewLeave = useCallback(() => {
    leaveTimer.current = setTimeout(() => setHoveredTicket(null), 150);
  }, []);

  const ticketStats = (() => {
    const total = totalCount;
    const open = tickets.filter(t => t.status === 'NEW' || t.status === 'OPEN').length;
    const pending = tickets.filter(t => t.status === 'PENDING').length;
    const resolved = tickets.filter(t => t.status === 'SOLVED' || t.status === 'CLOSED').length;
    const p1 = tickets.filter(t => t.priority === 'P1').length;
    const p2 = tickets.filter(t => t.priority === 'P2').length;
    const ai = tickets.filter(t => t.aiProcessed).length;
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

  return (
    <motion.div
      className="p-lg space-y-lg"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* ── En-tête ─────────────────────────────────────────────────────────── */}
      <motion.header variants={itemVariants} className="flex justify-between items-center">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-background tracking-tight">Tickets</h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant">Gestion et suivi des demandes.</p>
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
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={toggleForm}
                className="absolute inset-0 bg-black/60 backdrop-blur-[2px] cursor-pointer"
              />

              {/* Modal */}
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
                  <h3 className="font-headline-md text-headline-md text-on-background flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-[20px]" aria-hidden="true">add_circle</span>
                    Nouveau ticket
                  </h3>
                  <motion.button
                    type="button"
                    onClick={toggleForm}
                    whileHover={{ scale: 1.1, color: 'var(--color-on-surface)' }}
                    whileTap={{ scale: 0.9 }}
                    className="text-on-surface-variant hover:text-on-surface transition-colors"
                    aria-label="Fermer"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </motion.button>
                </div>
              </div>

              <div className="p-lg flex flex-col gap-lg">
                {/* ── Disposition 2 colonnes ── */}
                <div className="flex flex-col lg:flex-row gap-lg">
                  {/* ── Colonne gauche : Titre, Description, Pièce jointe ── */}
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
                        aria-label="Ajouter une pièce jointe"
                      />
                    </FieldRow>
                  </div>

                  {/* ── Colonne droite : Propriétés + Acteurs ── */}
                  <div className="w-full lg:w-80 xl:w-96 shrink-0 flex flex-col gap-md">
                    {/* Propriétés */}
                    <div className="bg-surface-bright/35 dark:bg-[rgba(129,140,248,0.03)] border border-outline-variant/65 p-md rounded-2xl flex flex-col gap-sm">
                      <h4 className="font-headline-sm text-headline-sm text-on-background font-semibold flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px] text-on-surface-variant" aria-hidden="true">settings</span>
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
                          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">fact_check</span>
                          Approbation
                        </label>
                      </div>
                    </div>

                    {/* Acteurs */}
                    {canAssign && (
                      <div className="bg-surface-bright/35 dark:bg-[rgba(129,140,248,0.03)] border border-outline-variant/65 p-md rounded-2xl flex flex-col gap-sm">
                        <h4 className="font-headline-sm text-headline-sm text-on-background font-semibold flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[16px] text-on-surface-variant" aria-hidden="true">people</span>
                          Acteurs
                        </h4>

                        {/* Filtre intelligent */}
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[14px] text-on-surface-variant pointer-events-none" aria-hidden="true">search</span>
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
                              aria-label="Effacer la recherche"
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
                          <div className="w-full min-h-[160px] px-sm py-1 rounded-xl border border-outline-variant bg-surface focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-all font-body-sm text-body-sm text-on-surface overflow-y-auto flex flex-col gap-0.5">
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

                {/* ── Boutons ── */}
                <div className="flex gap-sm pt-4 border-t border-outline-variant/50 justify-end">
                  <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} type="button" onClick={toggleForm}
                    className="px-5 py-2.5 rounded-xl border border-outline-variant text-on-surface font-semibold text-body-sm hover:bg-surface-container-low transition-colors"
                  >
                    Annuler
                  </motion.button>
                  <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} type="submit" disabled={creating}
                    className="px-5 py-2.5 rounded-xl btn-gradient font-semibold text-body-sm shadow-md shadow-primary/20 hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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

      {/* ── Statistiques ─────────────────────────────────────────────────────── */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: 'Total', value: ticketStats.total, icon: 'confirmation_number', color: '#3B82F6' },
          { label: 'Ouverts', value: ticketStats.open, icon: 'radio_button_checked', color: '#F97316' },
          { label: 'En attente', value: ticketStats.pending, icon: 'hourglass_empty', color: '#EAB308' },
          { label: 'Résolus', value: ticketStats.resolved, icon: 'check_circle', color: '#10B981' },
          { label: 'P1', value: ticketStats.p1, icon: 'emergency', color: '#EF4444' },
          { label: 'P2', value: ticketStats.p2, icon: 'report', color: '#F97316' },
          { label: 'IA', value: ticketStats.ai, icon: 'smart_toy', color: '#8B5CF6' },
        ].map(s => (
          <motion.div
            key={s.label}
            whileHover={{ y: -1 }}
            className="bento-card px-4 py-3 flex items-center gap-3 min-w-0"
          >
            <span className="material-symbols-outlined text-[20px] shrink-0" style={{ color: s.color }}>{s.icon}</span>
            <div className="min-w-0">
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
        ))}
      </motion.div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* BARRE DE FILTRES BENTO */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <motion.div variants={itemVariants} className="bento-card">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 p-lg">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Recherche</span>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[16px]"
                  style={{ color: 'var(--color-outline)' }}>search</span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Titre, contenu, n° ticket…"
                  className="w-56 pl-9 pr-8 py-2 rounded-xl border outline-none font-body-sm text-body-sm transition-all"
                  style={{
                    borderColor: 'var(--color-outline-variant)',
                    backgroundColor: 'var(--color-surface)',
                    color: 'var(--color-on-surface)',
                  }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--color-primary)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--color-outline-variant)'}
                />
                {searchQuery && (
                  <button
                    onClick={() => { setSearchQuery(''); setDebouncedSearch(''); setPage(1); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface transition-colors"
                  >
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                )}
              </div>
            </div>
            <FilterSelect value={filters.status} onChange={(v) => updateFilter('status', v)}
              label="Statut" options={[
                { v: '', l: 'Tous' },
                { v: 'OPEN_GROUP', l: 'Tickets ouverts' },
                { v: 'CLOSED_GROUP', l: 'Tickets fermés' },
                { v: 'NEW', l: 'Nouveau' },
                { v: 'OPEN', l: 'Ouvert' },
                { v: 'PENDING', l: 'En attente' },
                { v: 'SOLVED', l: 'Résolu' },
                { v: 'CLOSED', l: 'Fermé' },
              ]} />
            <FilterSelect value={filters.priority} onChange={(v) => updateFilter('priority', v)}
              label="Priorité" options={[{ v: '', l: 'Toutes' }, ...PRIORITY_OPTIONS.map((p) => ({ v: p, l: p }))]} />
            <FilterSelect value={filters.source} onChange={(v) => updateFilter('source', v)}
              label="Source" options={[
                { v: '', l: 'Toutes' },
                { v: 'glpi', l: 'Synchronisés GLPI' },
                { v: 'erp', l: 'Internes ERP' },
              ]} />
          </div>
          <div className="flex items-center gap-2.5">
            {(filters.status || filters.priority || filters.source) && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-body-sm font-semibold hover:bg-primary/20 transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">filter_alt_off</span>
                Effacer les filtres
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
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">delete</span>
                {selectedIds.length} sélectionné(s)
              </motion.button>
            )}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={toggleForm}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl btn-gradient font-body-sm text-body-sm font-semibold shadow-md shadow-primary/10 hover:shadow-lg transition-all whitespace-nowrap"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{showForm ? 'close' : 'add'}</span>
              {showForm ? 'Fermer' : 'Nouveau ticket'}
            </motion.button>
          </div>
        </div>
      </motion.div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* TABLEAU MODERNE */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <motion.div variants={itemVariants} className="bento-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-surface-bright/50 dark:bg-[rgba(129,140,248,0.03)] border-b border-outline-variant/60">
                {showSelectionColumn && (
                  <th className="px-md py-3.5 w-10">
                    <input type="checkbox"
                      checked={tickets.length > 0 && selectedIds.length === tickets.length}
                      onChange={toggleSelectAll}
                      className="cursor-pointer accent-primary w-4 h-4"
                    />
                  </th>
                )}
                <TH>ID</TH>
                <TH>Date</TH>
                <TH>Titre</TH>
                <TH className="w-16">IA</TH>
                <TH className="w-28">GLPI</TH>
                <TH className="w-32">Statut</TH>
                <TH className="w-32">Priorité</TH>
                <TH className="w-40">Équipe</TH>
                <TH className="w-48">Assigné à</TH>
                <TH className="w-48">Demandeur</TH>
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
                    transition={{ duration: 0.25, delay: idx * 0.02, ease: [0.16, 1, 0.3, 1] }}
                    className="hover:bg-surface-container-low/60 transition-colors group cursor-pointer"
                    layout
                    onMouseMove={handleMouseMove}
                    onMouseEnter={() => handleRowEnter(t)}
                    onMouseLeave={handleRowLeave}
                    onClick={() => navigate(`/tickets/${t.id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); navigate(`/tickets/${t.id}`); } }}
                  >
                    {showSelectionColumn && (
                      <td className="px-md py-3.5">
                        <input type="checkbox" checked={selectedIds.includes(t.id)}
                          onChange={() => toggleSelect(t.id)} className="cursor-pointer accent-primary w-4 h-4"
                        />
                      </td>
                    )}
                    <td className="px-md py-3.5">
                      <Link to={`/tickets/${t.id}`}
                        className="font-mono-sm text-mono-sm text-outline hover:text-on-surface hover:underline transition-colors focus-visible:outline-2 focus-visible:outline-primary rounded px-1"
                      >#{t.id}</Link>
                    </td>
                    <td className="px-md py-3.5 text-on-surface-variant text-body-sm whitespace-nowrap">
                      {new Date(t.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </td>
                    <td className="px-md py-3.5">
                      <Link to={`/tickets/${t.id}`}
                        className="font-medium text-on-surface hover:text-primary transition-colors truncate max-w-xs block focus-visible:outline-2 focus-visible:outline-primary rounded"
                      >{t.title}</Link>
                    </td>
                    <td className="px-md py-3.5">
                      {t.aiProcessed && (
                        <span title="Traité par l'agent IA"
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-primary/20 bg-primary/5 text-primary font-medium text-[10px]"
                        >
                          <span className="material-symbols-outlined text-[12px]" aria-hidden="true">smart_toy</span>
                          IA
                        </span>
                      )}
                    </td>
                    <td className="px-md py-3.5">
                      {t.glpiTicketId ? (
                        <span title="Synchronisé avec GLPI"
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-outline-variant bg-surface-container-low text-on-surface-variant font-medium text-[10px]"
                        >
                          <span className="material-symbols-outlined text-[12px]" aria-hidden="true">sync</span>
                          #{t.glpiTicketId}
                        </span>
                      ) : (
                        <span className="text-outline/60 italic text-[11px]">Interne</span>
                      )}
                    </td>
                    <td className="px-md py-3.5">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-md py-3.5">
                      <PriorityBadge priority={t.priority} />
                    </td>
                    <td className="px-md py-3.5 text-on-surface-variant text-body-sm">{t.team?.name || '-'}</td>
                    <td className="px-md py-3.5 text-on-surface text-body-sm">
                      {t.assignedTo?.fullName || <span className="text-outline/65 italic">Non assigné</span>}
                    </td>
                    <td className="px-md py-3.5 text-on-surface-variant text-body-sm">{t.requester?.fullName || '-'}</td>
                    {canDelete && (
                      <td className="px-md py-3.5">
                        <motion.button
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => askDeleteOne(t.id)}
                          title="Supprimer ce ticket"
                          aria-label={`Supprimer le ticket #${t.id}`}
                          className="text-outline/50 hover:text-error transition-all opacity-60 lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">delete</span>
                        </motion.button>
                      </td>
                    )}
                  </motion.tr>
                ))}
              </AnimatePresence>
              {tickets.length === 0 && (
                <motion.tr
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  <td colSpan={10 + (showSelectionColumn ? 1 : 0) + (canDelete ? 1 : 0)}
                    className="px-md py-12 text-center"
                  >
                    <EmptyState
                      icon="tickets"
                      title="Aucun ticket trouvé"
                      description="Modifie les filtres ou crée un nouveau ticket."
                    />
                  </td>
                </motion.tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* ── Pagination ──────────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <motion.div variants={itemVariants}
          className="flex items-center justify-between px-4 py-3 rounded-xl border"
          style={{ borderColor: 'var(--color-outline-variant)' }}
        >
          <span className="text-[12px]" style={{ color: 'var(--color-on-surface-variant)' }}>
            {totalCount} ticket{totalCount > 1 ? 's' : ''} — Page {page}/{totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="w-8 h-8 flex items-center justify-center rounded-lg border transition-colors hover:bg-surface-container-low disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ borderColor: 'var(--color-outline-variant)' }}
            >
              <span className="material-symbols-outlined text-sm" style={{ color: 'var(--color-on-surface-variant)' }}>chevron_left</span>
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let pageNum;
              if (totalPages <= 7) {
                pageNum = i + 1;
              } else if (page <= 4) {
                pageNum = i + 1;
              } else if (page >= totalPages - 3) {
                pageNum = totalPages - 6 + i;
              } else {
                pageNum = page - 3 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`w-8 h-8 rounded-lg text-[12px] font-semibold transition-colors ${
                    pageNum === page
                      ? 'bg-primary text-white'
                      : 'text-on-surface-variant hover:bg-surface-container-low'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="w-8 h-8 flex items-center justify-center rounded-lg border transition-colors hover:bg-surface-container-low disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ borderColor: 'var(--color-outline-variant)' }}
            >
              <span className="material-symbols-outlined text-sm" style={{ color: 'var(--color-on-surface-variant)' }}>chevron_right</span>
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
                {hoveredTicket.type && (
                  <div className="ticket-preview-meta-row">
                    <span className="material-symbols-outlined text-[13px]">label</span>
                    <span>{hoveredTicket.type === 'INCIDENT' ? 'Incident' : 'Demande'}</span>
                  </div>
                )}
                {hoveredTicket.source && (
                  <div className="ticket-preview-meta-row">
                    <span className="material-symbols-outlined text-[13px]">input</span>
                    <span>{hoveredTicket.source}</span>
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
                {hoveredTicket.team?.name && (
                  <div className="ticket-preview-meta-row">
                    <span className="material-symbols-outlined text-[13px]">groups</span>
                    <span>{hoveredTicket.team.name}</span>
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
      <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">{label}</span>
      <select
        className="px-3.5 py-2 rounded-xl border border-outline-variant bg-surface text-on-surface font-body-sm text-body-sm hover:bg-surface-container-low transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
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

const BADGE_COLORS = {
  NEW: 'badge-status-new',
  OPEN: 'badge-status-open',
  PENDING: 'badge-status-pending',
  SOLVED: 'badge-status-solved',
  CLOSED: 'badge-status-closed',
  P1: 'badge-priority-p1',
  P2: 'badge-priority-p2',
  P3: 'badge-priority-p3',
  P4: 'badge-priority-p4',
};

const DOT_COLORS = {
  NEW: 'bg-primary',
  OPEN: 'bg-secondary',
  PENDING: 'bg-tertiary',
  SOLVED: 'bg-emerald-500',
  CLOSED: 'bg-slate-500',
  P1: 'bg-error',
  P2: 'bg-tertiary',
  P3: 'bg-secondary',
  P4: 'bg-emerald-500',
};

function StatusBadge({ status }) {
  const STATUS_LABEL = {
    NEW: 'Nouveau',
    OPEN: 'Ouvert',
    PENDING: 'En attente',
    RESOLVED: 'Résolu',
    CLOSED: 'Fermé',
  };
  return (
    <span className={`badge ${BADGE_COLORS[status] || ''}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${DOT_COLORS[status] || ''} animate-pulse-soft shrink-0`} />
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function PriorityBadge({ priority }) {
  return (
    <span className={`badge ${BADGE_COLORS[priority] || 'badge-priority-p3'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${DOT_COLORS[priority] || 'bg-secondary'} animate-pulse-soft shrink-0`} />
      {PRIORITY_LABEL[priority] || 'Moyenne'}
    </span>
  );
}
