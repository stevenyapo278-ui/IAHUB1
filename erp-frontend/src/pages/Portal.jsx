import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  Ticket, Plus, X, Send, Clock, MapPin, Paperclip, MessageSquare,
  RefreshCw, Loader2, Star, Search, SlidersHorizontal, ArrowUpDown,
  Calendar, User, ChevronRight, Circle, Eye, Users,
} from 'lucide-react';
import { PRIORITY_CONFIG, STATUS_CONFIG, PRIORITY_OPTIONS, TYPE_OPTIONS, ORIGIN_CONFIG } from '../constants/tickets';
import SlaBadge from '../components/SlaBadge';
import EmptyState from '../components/EmptyState';
import { sanitizeHtml } from '../utils/sanitize';
import useSystemSettings from '../hooks/useSystemSettings';

const PRIORITY_ICON_BG = {
  P1: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400 border border-red-200 dark:border-red-500/25 font-bold',
  P2: 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 border border-orange-200 dark:border-orange-500/25 font-bold',
  P3: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400 border border-amber-300 dark:border-amber-500/25 font-bold',
  P4: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400 border border-blue-200 dark:border-blue-500/25 font-bold',
};

const EMPTY_FORM = { title: '', content: '', category: '', priority: 'P3', type: 'INCIDENT' };

const STATUS_GROUPS = {
  ALL: { label: 'Toutes', keys: null },
  OPEN: { label: 'Ouvertes', keys: ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER'] },
  SOLVED: { label: 'Résolues', keys: ['SOLVED'] },
  CLOSED: { label: 'Fermées', keys: ['CLOSED'] },
};

const SORT_OPTIONS = [
  { value: 'newest', label: 'Plus récents' },
  { value: 'oldest', label: 'Plus anciens' },
  { value: 'priority', label: 'Priorité (P1→P4)' },
];

export default function Portal() {
  const { user } = useAuth();
  const { settings } = useSystemSettings();
  const canCreate = settings?.portalAllowNewRequest !== false;
  const isRequester = user?.role === 'REQUESTER';

  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('newest');
  const [showFilters, setShowFilters] = useState(false);

  const [modalTicketId, setModalTicketId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [comment, setComment] = useState('');
  const [sendingComment, setSendingComment] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [attachment, setAttachment] = useState(null);
  const [creating, setCreating] = useState(false);
  const fileInputRef = useRef(null);

  const [csatComment, setCsatComment] = useState('');
  const [csatHover, setCsatHover] = useState(0);
  const [csatSaving, setCsatSaving] = useState(false);

  function getTicketRole(ticket) {
    if (ticket.requesterId === user?.id) return 'REQUESTER';
    if (ticket.secondaryRequesterId === user?.id) return 'REQUESTER';
    if (ticket.requesterIds?.includes(user?.id)) return 'REQUESTER';
    if (ticket.observers?.some((o) => o.id === user?.id)) return 'OBSERVER';
    return null;
  }

  const loadTickets = useCallback(() => {
    setLoading(true);
    api
      .get('/tickets', { params: { mine: 'true', limit: 200, sortBy: 'createdAt', sortOrder: 'desc' } })
      .then(({ data }) => setTickets(data.items || []))
      .catch(() => toast.error('Impossible de charger vos tickets'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(loadTickets, [loadTickets]);

  const filtered = useMemo(() => {
    let list = tickets;
    if (statusFilter !== 'ALL') {
      const keys = STATUS_GROUPS[statusFilter].keys;
      list = list.filter((t) => keys.includes(t.status));
    }
    if (priorityFilter !== 'ALL') {
      list = list.filter((t) => t.priority === priorityFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) =>
        t.title?.toLowerCase().includes(q) ||
        String(t.id).includes(q) ||
        t.category?.toLowerCase().includes(q) ||
        t.locationName?.toLowerCase().includes(q)
      );
    }
    const sorted = [...list];
    if (sortBy === 'oldest') sorted.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    else if (sortBy === 'priority') {
      const order = { P1: 0, P2: 1, P3: 2, P4: 3 };
      sorted.sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9) || new Date(b.createdAt) - new Date(a.createdAt));
    } else {
      sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    return sorted;
  }, [tickets, statusFilter, priorityFilter, search, sortBy]);

  const activeFilterCount = (statusFilter !== 'ALL' ? 1 : 0) + (priorityFilter !== 'ALL' ? 1 : 0);

  async function openModal(ticketId) {
    setModalTicketId(ticketId);
    setDetail(null);
    setDetailLoading(true);
    setComment('');
    setCsatComment('');
    setCsatHover(0);
    try {
      const { data } = await api.get(`/tickets/${ticketId}`);
      setDetail(data);
    } catch {
      toast.error('Erreur de chargement du ticket');
    } finally {
      setDetailLoading(false);
    }
  }

  function closeModal() {
    setModalTicketId(null);
    setDetail(null);
  }

  async function submitComment(ticketId) {
    if (!comment.trim()) return;
    setSendingComment(true);
    try {
      const fd = new FormData();
      fd.append('content', comment.trim());
      await api.post(`/tickets/${ticketId}/followups`, fd);
      toast.success('Commentaire ajouté');
      setComment('');
      const { data } = await api.get(`/tickets/${ticketId}`);
      setDetail(data);
    } catch (err) {
      toast.error(err.response?.data?.error || "Échec de l'ajout du commentaire");
    } finally {
      setSendingComment(false);
    }
  }

  async function submitCsat(score) {
    if (!detail || detail.csatScore || csatSaving) return;
    setCsatSaving(true);
    try {
      await api.post(`/tickets/${detail.id}/csat`, { score, comment: csatComment.trim() || null });
      toast.success('Merci pour votre retour !');
      setCsatComment('');
      const { data } = await api.get(`/tickets/${detail.id}`);
      setDetail(data);
    } catch (err) {
      toast.error(err.response?.data?.error || "Échec de l'envoi de la note");
    } finally {
      setCsatSaving(false);
    }
  }

  async function submitCreate(e) {
    e.preventDefault();
    if (!canCreate) { toast.error('La soumission de nouvelles demandes est désactivée.'); setShowCreate(false); return; }
    if (!form.title.trim() || !form.content.trim()) { toast.error('Titre et description sont obligatoires'); return; }
    setCreating(true);
    try {
      const fd = new FormData();
      fd.append('title', form.title.trim());
      fd.append('content', form.content.trim());
      fd.append('priority', form.priority);
      fd.append('type', form.type);
      if (form.category.trim()) fd.append('category', form.category.trim());
      if (attachment) fd.append('attachment', attachment);
      await api.post('/tickets', fd);
      toast.success('Votre demande a été envoyée');
      setShowCreate(false);
      setForm(EMPTY_FORM);
      setAttachment(null);
      loadTickets();
    } catch (err) {
      toast.error(err.response?.data?.error || "Échec de l'envoi de la demande");
    } finally {
      setCreating(false);
    }
  }

  const timeline = useMemo(() => {
    if (!detail) return [];
    return [
      ...(detail.followups || []).map((f) => ({ kind: 'followup', ...f })),
      ...(detail.messages || []).map((m) => ({ kind: 'message', ...m })),
    ].sort((a, b) => new Date(a.createdAt || a.timestamp) - new Date(b.createdAt || b.timestamp));
  }, [detail]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto flex flex-col gap-5">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-on-surface">
            {isRequester ? 'Mes demandes' : 'Mes tickets'}
          </h1>
          <p className="text-sm text-on-surface-variant mt-0.5">
            {filtered.length} demande{filtered.length > 1 ? 's' : ''} au total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadTickets}
            className="p-2 rounded-xl border border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-high transition-colors cursor-pointer"
            title="Rafraîchir"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {canCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-sm shadow-sm hover:opacity-90 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Nouvelle demande
            </button>
          )}
        </div>
      </div>

      {/* Barre de recherche + filtres */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par titre, #ID, catégorie, lieu..."
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/40 text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-on-surface-variant hover:text-on-surface cursor-pointer">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`relative p-2.5 rounded-xl border transition-all cursor-pointer ${
              showFilters || activeFilterCount > 0
                ? 'border-primary/50 bg-primary/5 text-primary'
                : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-primary text-on-primary text-[9px] font-bold flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Filtres avancés */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap items-center gap-2 pb-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Priorité :</span>
                {['ALL', ...PRIORITY_OPTIONS].map((p) => (
                  <button
                    key={p}
                    onClick={() => setPriorityFilter(p)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all cursor-pointer ${
                      priorityFilter === p
                        ? 'bg-primary text-on-primary border-primary'
                        : 'bg-surface-container-low text-on-surface-variant border-outline-variant/40 hover:border-primary/50'
                    }`}
                  >
                    {p === 'ALL' ? 'Toutes' : p}
                  </button>
                ))}
                <div className="w-px h-5 bg-outline-variant/40 mx-1" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Tri :</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-surface-container-low text-on-surface-variant border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                >
                  {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {activeFilterCount > 0 && (
                  <button
                    onClick={() => { setStatusFilter('ALL'); setPriorityFilter('ALL'); }}
                    className="text-[11px] text-primary font-bold hover:underline cursor-pointer"
                  >
                    Tout effacer
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Status pills */}
        <div className="flex items-center gap-2 flex-wrap">
          {Object.entries(STATUS_GROUPS).map(([key, cfg]) => {
            const count = key === 'ALL' ? tickets.length : tickets.filter((t) => cfg.keys.includes(t.status)).length;
            return (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                  statusFilter === key
                    ? 'bg-primary text-on-primary border-primary'
                    : 'bg-surface-container-low text-on-surface-variant border-outline-variant/40 hover:border-primary/50'
                }`}
              >
                {cfg.label}
                <span className="ml-1.5 opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Liste des tickets */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-on-surface-variant">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon="tickets" title="Aucune demande" description="Aucun ticket ne correspond à vos critères." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((t) => {
            const st = STATUS_CONFIG[t.status];
            const pr = PRIORITY_CONFIG[t.priority];
            const orig = ORIGIN_CONFIG[t.origin];
            const ticketRole = getTicketRole(t);
            return (
              <motion.button
                key={t.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => openModal(t.id)}
                className="group text-left rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm hover:shadow-md hover:border-primary/30 transition-all cursor-pointer overflow-hidden"
              >
                <div className="p-4 flex flex-col gap-2.5">
                  {/* Ligne 1 : ID + Priorité + Statut */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-[10px] font-bold ${PRIORITY_ICON_BG[t.priority] || ''}`}>
                        {t.priority}
                      </span>
                      <span className="font-mono text-xs font-bold text-on-surface-variant">#{t.id}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {ticketRole === 'OBSERVER' && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold border border-violet-300 dark:border-violet-500/30 bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400">
                          <Eye className="w-2.5 h-2.5" />
                          Observateur
                        </span>
                      )}
                      {st && (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border ${st.bg}`}>
                          {st.label}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Titre */}
                  <p className="text-sm font-bold text-on-surface line-clamp-2 group-hover:text-primary transition-colors">
                    {t.title}
                  </p>

                  {/* Meta */}
                  <div className="flex items-center gap-2 text-[11px] text-on-surface-variant flex-wrap">
                    {orig && (
                      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${orig.bg}`}>
                        <orig.Icon className="w-2.5 h-2.5" />
                        {orig.label}
                      </span>
                    )}
                    {t.category && <span className="truncate">{t.category}</span>}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-outline-variant/20">
                    <div className="flex items-center gap-1.5 text-[10px] text-on-surface-variant">
                      <Calendar className="w-3 h-3" />
                      {new Date(t.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {t.assignedTo?.fullName && (
                        <span className="text-[10px] text-on-surface-variant flex items-center gap-0.5">
                          <User className="w-3 h-3" />
                          {t.assignedTo.fullName.split(' ')[0]}
                        </span>
                      )}
                      <SlaBadge ticket={t} />
                    </div>
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      )}

      {/* ── MODAL DÉTAIL TICKET ──────────────────────────────────────────── */}
      <AnimatePresence>
        {modalTicketId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-start justify-center pt-[5vh] sm:pt-[8vh] p-4 overflow-y-auto"
            onClick={closeModal}
          >
            <motion.div
              initial={{ scale: 0.96, y: 12, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.96, y: 12, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl rounded-3xl bg-surface border border-outline-variant/30 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
            >
              {detailLoading ? (
                <div className="p-10 text-center text-on-surface-variant">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                </div>
              ) : detail ? (
                <>
                  {/* Header modal */}
                  <div className="px-6 pt-5 pb-4 border-b border-outline-variant/20 shrink-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className="font-mono text-xs font-bold text-on-surface-variant">#{detail.id}</span>
                          {STATUS_CONFIG[detail.status] && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border ${STATUS_CONFIG[detail.status].bg}`}>
                              {STATUS_CONFIG[detail.status].label}
                            </span>
                          )}
                          {PRIORITY_CONFIG[detail.priority] && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border ${PRIORITY_CONFIG[detail.priority].bg}`}>
                              {detail.priority}
                            </span>
                          )}
                          {detail.origin && ORIGIN_CONFIG[detail.origin] && (
                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${ORIGIN_CONFIG[detail.origin].bg}`}>
                              {(() => { const Ic = ORIGIN_CONFIG[detail.origin].Icon; return <Ic className="w-2.5 h-2.5" />; })()}
                              {ORIGIN_CONFIG[detail.origin].label}
                            </span>
                          )}
                        </div>
                        <h2 className="text-lg font-bold text-on-surface leading-snug">{detail.title}</h2>
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-on-surface-variant flex-wrap">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(detail.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {detail.locationName && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" />{detail.locationName}
                            </span>
                          )}
                          {detail.requester?.fullName && (
                            <span className="flex items-center gap-1">
                              <User className="w-3 h-3" />{detail.requester.fullName}
                            </span>
                          )}
                          {detail.assignedTo?.fullName && (
                            <span className="flex items-center gap-1">
                              <User className="w-3 h-3" />{detail.assignedTo.fullName}
                            </span>
                          )}
                          <SlaBadge ticket={detail} />
                        </div>
                      </div>
                      <button onClick={closeModal} className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-low shrink-0 cursor-pointer">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Corps modal : scrollable */}
                  <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-5">
                    {/* Description */}
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-widest text-on-surface-variant mb-1.5">Description</div>
                      <p className="text-sm text-on-surface whitespace-pre-wrap leading-relaxed">{detail.content}</p>
                    </div>

                    {/* Observateurs */}
                    {detail.observers?.length > 0 && (
                      <div>
                        <div className="text-[11px] font-black uppercase tracking-widest text-on-surface-variant mb-1.5">
                          Observateurs ({detail.observers.length})
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {detail.observers.map((obs) => (
                            <span key={obs.id} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-outline-variant/40 text-xs text-on-surface-variant">
                              <Eye className="w-3 h-3 text-violet-500" />
                              {obs.fullName || obs.email || `#${obs.id}`}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Pièces jointes */}
                    {detail.attachments?.length > 0 && (
                      <div>
                        <div className="text-[11px] font-black uppercase tracking-widest text-on-surface-variant mb-1.5">
                          Pièces jointes ({detail.attachments.length})
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {detail.attachments.map((att) => (
                            <a
                              key={att.id}
                              href={`${api.defaults.baseURL}/tickets/${detail.id}/attachments/${att.id}/file`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-outline-variant/40 text-xs text-on-surface-variant hover:border-primary/50 hover:text-primary transition-all"
                            >
                              <Paperclip className="w-3 h-3" />{att.filename || 'Fichier'}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Timeline */}
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-widest text-on-surface-variant mb-2">
                        Échanges ({timeline.length})
                      </div>
                      {timeline.length === 0 ? (
                        <p className="text-sm text-on-surface-variant italic">Aucun échange pour le moment.</p>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {timeline.map((item, idx) => {
                            const isOutbound = item.kind === 'message' && item.direction === 'OUTBOUND';
                            return (
                              <div key={idx} className={`rounded-xl border p-3 ${isOutbound ? 'border-primary/20 bg-primary/5' : 'border-outline-variant/20 bg-surface-container-lowest'}`}>
                                <div className="flex items-center gap-2 mb-1">
                                  <Circle className={`w-2 h-2 fill-current ${item.kind === 'message' ? 'text-sky-500' : 'text-primary'}`} />
                                  <span className="text-[11px] font-bold text-on-surface-variant">
                                    {item.kind === 'message' ? (item.sender || 'Support') : (item.author?.fullName || 'Support')}
                                  </span>
                                  {isOutbound && (
                                    <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400">NOTRE ÉQUIPE</span>
                                  )}
                                  <span className="text-[10px] text-outline ml-auto">
                                    {new Date(item.createdAt || item.timestamp).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                                  </span>
                                </div>
                                <div
                                  className="text-sm text-on-surface leading-relaxed break-words"
                                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.bodyHtml || item.content || '') }}
                                />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* CSAT */}
                    {isRequester && ['SOLVED', 'CLOSED'].includes(detail.status) && (
                      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
                        <div className="text-[11px] font-black uppercase tracking-widest text-on-surface mb-2">Votre avis compte</div>
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              onClick={() => submitCsat(star)}
                              onMouseEnter={() => setCsatHover(star)}
                              onMouseLeave={() => setCsatHover(0)}
                              disabled={csatSaving || !!detail.csatScore}
                              className="p-1 transition-transform hover:scale-125 cursor-pointer disabled:cursor-default disabled:hover:scale-100"
                            >
                              <Star className={`w-6 h-6 ${(detail.csatScore || csatHover) >= star ? 'fill-amber-400 text-amber-400' : 'text-outline'}`} />
                            </button>
                          ))}
                        </div>
                        {detail.csatScore ? (
                          <p className="text-sm text-on-surface-variant mt-2">
                            Merci ! Vous avez noté {detail.csatScore}/5.
                            {detail.csatComment && <span className="block italic mt-0.5">« {detail.csatComment} »</span>}
                          </p>
                        ) : (
                          <input
                            type="text"
                            value={csatComment}
                            onChange={(e) => setCsatComment(e.target.value)}
                            placeholder="Un commentaire (optionnel) ?"
                            className="mt-2 w-full bg-surface border border-outline-variant/60 rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                          />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Footer modal : commentaire */}
                  <div className="px-6 py-4 border-t border-outline-variant/20 shrink-0">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment(detail.id); } }}
                        placeholder="Ajouter un commentaire..."
                        className="flex-1 bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                      />
                      <button
                        onClick={() => submitComment(detail.id)}
                        disabled={sendingComment || !comment.trim()}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 cursor-pointer shrink-0"
                      >
                        {sendingComment ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── MODALE CRÉATION ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowCreate(false)}
          >
            <motion.form
              initial={{ scale: 0.96, y: 12, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.96, y: 12, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={submitCreate}
              className="w-full max-w-lg rounded-3xl bg-surface border border-outline-variant/30 shadow-2xl p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-on-surface">Nouvelle demande</h2>
                <button type="button" onClick={() => setShowCreate(false)} className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-low cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Titre *</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Résumez votre problème en une phrase" className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Priorité</label>
                  <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all">
                    {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{PRIORITY_CONFIG[p]?.label || p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Type</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all">
                    {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Catégorie</label>
                <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Ex : Matériel, Réseau, Logiciel..." className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Description *</label>
                <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={5} placeholder="Décrivez le problème : quand est-il apparu, sur quel équipement, qu'avez-vous essayé..." className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none" />
              </div>
              <div>
                <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => setAttachment(e.target.files?.[0] || null)} />
                <button type="button" onClick={() => fileInputRef.current?.click()} className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl border border-dashed border-outline-variant/60 text-sm text-on-surface-variant hover:border-primary/50 hover:text-primary transition-all cursor-pointer">
                  <Paperclip className="w-3.5 h-3.5" />
                  {attachment ? attachment.name : 'Joindre un fichier (optionnel)'}
                </button>
              </div>
              <motion.button whileTap={{ scale: 0.98 }} type="submit" disabled={creating} className="w-full py-3 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {creating ? 'Envoi en cours...' : 'Envoyer la demande'}
              </motion.button>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
