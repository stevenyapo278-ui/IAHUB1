import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import api from '../api/client';
import Skeleton from '../components/Skeleton';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import { useSocket } from '../context/SocketContext';
import { useFilterParam } from '../hooks/useFilterParam';
import { sanitizeHtml } from '../utils/sanitize';
import {
  Inbox as InboxIcon, MailOpen, RefreshCw, Clock, CheckCircle2, XCircle, Ban,
  Paperclip, Search, X, FlaskConical, Bot, ArrowUpRight, Reply, ChevronDown,
  ChevronRight, ChevronUp, Flame, AlertTriangle, ArrowDownWideNarrow, Rows3, Rows4,
  CircleDot, Mail, CheckCheck, Send, FileText, Tag, Users, Filter, Sparkles, Plus,
  CalendarRange, Info, FolderPlus, ArrowRight, Loader2, Folder, Settings, Trash2, Play
} from 'lucide-react';

const STATUS_LABELS = {
  PENDING: 'En attente',
  PROCESSING: 'Traitement...',
  DONE: 'Traité',
  ERROR: 'Erreur',
  SPAM: 'Spam',
};

const STATUS_CONFIG = {
  PENDING: { label: 'En attente', icon: Clock,        color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  PROCESSING:{label: 'Traitement',icon: RefreshCw,    color: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20'   },
  DONE:    { label: 'Traité',     icon: CheckCircle2, color: 'text-emerald-400',bg: 'bg-emerald-500/10',border: 'border-emerald-500/20' },
  ERROR:   { label: 'Erreur',     icon: XCircle,      color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20'    },
  RETRY:   { label: 'Relance',    icon: RefreshCw,    color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/20'  },
  DEAD_LETTER: { label: 'Échec',  icon: AlertTriangle,color: 'text-red-500',    bg: 'bg-red-500/15',    border: 'border-red-500/25'    },
  SPAM:    { label: 'Spam',       icon: Ban,          color: 'text-zinc-400',   bg: 'bg-zinc-500/10',   border: 'border-zinc-500/20'   },
  INFORMATIONAL: { label: 'Info', icon: Mail,          color: 'text-slate-400',  bg: 'bg-slate-500/10',  border: 'border-slate-500/20'  },
  NEEDS_REVIEW: { label: 'Révision', icon: AlertTriangle, color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
};

const PRIORITY_CONFIG = {
  P1: { label: 'P1 Critique', icon: Flame,         color: 'text-red-400',    bg: 'bg-red-500',    stripe: '#ef4444' },
  P2: { label: 'P2 Haute',   icon: AlertTriangle,  color: 'text-orange-400', bg: 'bg-orange-500', stripe: '#f97316' },
  P3: { label: 'P3 Moyenne', icon: ChevronRight,   color: 'text-amber-400',  bg: 'bg-amber-500',  stripe: '#f59e0b' },
  P4: { label: 'P4 Basse',   icon: ChevronRight,   color: 'text-blue-400',   bg: 'bg-blue-500',   stripe: '#3b82f6' },
};

// Dossiers façon Outlook
const FOLDERS = [
  { id: 'all',          label: 'Boîte de réception', icon: InboxIcon },
  { id: 'unread',       label: 'Non lus',            icon: MailOpen,      read: 'unread' },
  { id: 'pending',      label: 'En attente',         icon: Clock,         status: 'PENDING' },
  { id: 'done',         label: 'Traités',            icon: CheckCircle2,  status: 'DONE' },
  { id: 'error',        label: 'Erreurs',            icon: XCircle,       status: 'ERROR,RETRY,DEAD_LETTER' },
  { id: 'retry',        label: 'En relance',          icon: RefreshCw,     status: 'RETRY' },
  { id: 'dead_letter',  label: 'Échecs définitifs',   icon: AlertTriangle, status: 'DEAD_LETTER' },
  { id: 'spam',         label: 'Spam',               icon: Ban,           status: 'SPAM' },
  { id: 'attachments',  label: 'Pièces jointes',     icon: Paperclip,     attachments: 'with' },
];

const SORT_OPTIONS = [
  { value: 'date',     label: 'Date : plus récentes' },
  { value: 'date_asc', label: 'Date : plus anciennes' },
  { value: 'priority', label: 'Priorité (P1 → P4)' },
  { value: 'sender',   label: 'Expéditeur (A → Z)' },
  { value: 'unread',   label: 'Non lues d\'abord' },
];

const PERIOD_OPTIONS = [
  { value: '',   label: 'Toute période' },
  { value: '7',  label: '7 derniers jours' },
  { value: '30', label: '30 derniers jours' },
];

const PRIORITY_OPTIONS = [
  { value: '', label: 'Toutes priorités' },
  { value: 'P1', label: 'P1 Critique' },
  { value: 'P2', label: 'P2 Haute' },
  { value: 'P3', label: 'P3 Moyenne' },
  { value: 'P4', label: 'P4 Basse' },
];

const AVATAR_COLORS = ['bg-sky-600', 'bg-indigo-600', 'bg-emerald-600', 'bg-violet-600', 'bg-rose-600'];

function initialOf(name, email) {
  return ((name || email) || '?').charAt(0).toUpperCase();
}

function displayAddr(addr) {
  const s = String(addr || '');
  return s.length > 28 ? `${s.slice(0, 26)}…` : s;
}

function participantsLabel(participants) {
  if (!participants || participants.length === 0) return 'Inconnu';
  const names = participants.slice(0, 2).map((p) => p.name || p.email);
  if (participants.length > 2) return `${names.join(', ')} +${participants.length - 2}`;
  return names.join(', ');
}

// Date façon Outlook : toujours avec l'heure (ex. 14:32, Hier 14:32, 12 août 07:21)
function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  const now = new Date();
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (diffDays === 0) return time;
  if (diffDays === 1) return `Hier ${time}`;
  if (diffDays < 7) return `${date.toLocaleDateString('fr-FR', { weekday: 'short' })} ${time}`;
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} ${time}`;
  }
  return `${date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })} ${time}`;
}

function formatDateTime(d) {
  return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Petit sélecteur déroulant pour la barre d'outils (façon ruban Outlook)
function FilterSelect({ label, icon: Icon, value, options, onChange, active }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
          active || (value && value !== '' && value !== 'all' && value !== 'date' && value !== 'comfortable')
            ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
            : 'border-outline-variant/30 text-on-surface-variant hover:bg-surface-container'
        }`}
      >
        {Icon && <Icon className="w-3.5 h-3.5" />}
        <span className="max-w-[130px] truncate">{label}</span>
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="absolute z-40 top-full left-0 mt-1 w-48 rounded-xl border border-outline-variant/40 bg-surface-container-lowest shadow-xl p-1"
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  value === opt.value ? 'bg-sky-500/10 text-sky-400' : 'text-on-surface hover:bg-surface-container'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </motion.div>
        </>
      )}
    </div>
  );
}

export default function Inbox() {
  const { user } = useAuth();
  const canSync = hasPermission(user, 'inbox.sync');
  const navigate = useNavigate();
  const socket = useSocket();

  // ── Filtres persistés dans l'URL ────────────────────────────────────────
  const [folder, setFolder] = useFilterParam('folder', 'all');
  const [sortBy, setSortBy] = useFilterParam('sort', 'date');
  const [priorityFilter, setPriorityFilter] = useFilterParam('priority', '');
  const [categoryFilter, setCategoryFilter] = useFilterParam('category', '');
  const [period, setPeriod] = useFilterParam('days', '');
  const [density, setDensity] = useFilterParam('density', 'comfortable');

  const folderCfg = FOLDERS.find((f) => f.id === folder) || FOLDERS[0];

  const [threads, setThreads] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState(null);
  const [selectedThread, setSelectedThread] = useState(null);
  const [threadDetail, setThreadDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkAction, setBulkAction] = useState(null);
  const [expandedErrors, setExpandedErrors] = useState(new Set());

  // ── Dossiers custom ────────────────────────────────────────────────
  const [customFolders, setCustomFolders] = useState([]);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState('#3b82f6');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);

  // ── Menu contextuel clic droit ─────────────────────────────────────
  const [contextMenu, setContextMenu] = useState(null); // { x, y, thread }
  const [showCreateRuleFromEmail, setShowCreateRuleFromEmail] = useState(false);
  const [ruleFromEmail, setRuleFromEmail] = useState(null); // email data for pre-filling

  // ── Modal création ticket depuis email ──────────────────────────────
  const [showCreateTicket, setShowCreateTicket] = useState(false);
  const [ticketForm, setTicketForm] = useState({ title: '', content: '', priority: 'P3', category: '', teamId: '', assignedToId: '' });
  const [ticketSaving, setTicketSaving] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);

  // Recherche locale avec debounce
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const searchDebounceRef = useRef(null);
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setSearchQuery(searchInput), 350);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchInput]);

  // Test IA
  const [testing, setTesting] = useState(false);
  const [testForm, setTestForm] = useState({ subject: '', body: '', from: '', fromName: '' });
  const [testResult, setTestResult] = useState(null);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testError, setTestError] = useState('');

  // ── Relance groupée avec plage de dates ─────────────────────────────────
  const [showRetryModal, setShowRetryModal] = useState(false);
  const [retryFrom, setRetryFrom] = useState('');
  const [retryTo, setRetryTo] = useState('');
  const [retryingAll, setRetryingAll] = useState(false);

  // Ouvre la modale de relance avec une plage par défaut : 7 derniers jours
  function openRetryModal() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const today = new Date();
    const toLocal = (d) => {
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };
    setRetryFrom(toLocal(sevenDaysAgo));
    setRetryTo(toLocal(today));
    setShowRetryModal(true);
  }

  // ── Menu contextuel clic droit ─────────────────────────────────────
  function handleContextMenu(e, thread) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, thread });
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

  async function ctxMarkRead(unread) {
    if (!contextMenu) return;
    const t = contextMenu.thread;
    try {
      await api.post('/inbox/read', { key: t.id, read: !unread });
      setThreads((prev) => prev.map((th) => th.id === t.id ? { ...th, isUnread: unread, unreadCount: unread ? 1 : 0 } : th));
      refreshCounts();
    } catch (err) { toast.error('Erreur'); }
    closeContextMenu();
  }

  async function ctxMarkSpam() {
    if (!contextMenu) return;
    const t = contextMenu.thread;
    if (!confirm('Marquer ce fil comme spam ?')) return;
    try {
      // Marquer tous les emails du fil comme spam
      for (const emailId of (t.emailIds || [])) {
        await api.patch(`/inbox/${emailId}`, { status: 'SPAM', aiIsSpam: true });
      }
      setThreads((prev) => prev.filter((th) => th.id !== t.id));
      refreshCounts();
      toast.success('Marqué comme spam');
    } catch (err) { toast.error('Erreur'); }
    closeContextMenu();
  }

  async function ctxDelete() {
    if (!contextMenu) return;
    const t = contextMenu.thread;
    if (!confirm('Supprimer ce fil ?')) return;
    try {
      for (const emailId of (t.emailIds || [])) {
        await api.delete(`/inbox/${emailId}`);
      }
      setThreads((prev) => prev.filter((th) => th.id !== t.id));
      refreshCounts();
      toast.success('Fil supprimé');
    } catch (err) { toast.error('Erreur'); }
    closeContextMenu();
  }

  function ctxCreateRule() {
    if (!contextMenu) return;
    const t = contextMenu.thread;
    const latest = t.latest || {};
    setRuleFromEmail({ fromEmail: latest.fromEmail || '', subject: latest.subject || '' });
    setShowCreateRuleFromEmail(true);
    closeContextMenu();
  }

  function ctxCreateTicket() {
    if (!contextMenu) return;
    setSelectedThread(contextMenu.thread);
    setShowCreateTicket(true);
    closeContextMenu();
  }

  function ctxMoveToFolder() {
    if (!contextMenu) return;
    setSelectedIds([contextMenu.thread.id]);
    setShowMoveModal(true);
    closeContextMenu();
  }

  // Relance les emails en erreur reçus dans la plage sélectionnée (inclusive)
  async function handleRetryRange(e) {
    e.preventDefault();
    if (!retryFrom && !retryTo) {
      toast.error('Définissez une plage de dates (début et/ou fin)');
      return;
    }
    if (retryFrom && retryTo && retryFrom > retryTo) {
      toast.error('La date de début doit être antérieure à la date de fin');
      return;
    }
    setRetryingAll(true);
    try {
      // Convertit en bornes UTC couvrant toute la journée (fuseau local du navigateur)
      const fromISO = retryFrom ? new Date(`${retryFrom}T00:00:00`).toISOString() : null;
      const toISO = retryTo ? new Date(`${retryTo}T23:59:59.999`).toISOString() : null;
      const { data } = await api.post('/inbox/retry-all', { from: fromISO, to: toISO });
      toast.success(data.message || 'Relancement terminé');
      setShowRetryModal(false);
      setRetryFrom('');
      setRetryTo('');
      load();
      refreshCounts();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors du relancement groupé');
    } finally {
      setRetryingAll(false);
    }
  }

  const pageRef = useRef(1);
  useEffect(() => { pageRef.current = page; }, [page]);

  // ── Chargement ──────────────────────────────────────────────────────────
  const buildParams = useCallback((p) => {
    const params = new URLSearchParams({ page: p, limit: 25 });
    // Supporte les dossiers custom (folder-123) et les dossiers built-in
    if (folder.startsWith('folder-')) {
      params.set('folderId', folder.slice('folder-'.length));
    } else if (folderCfg.status) {
      params.set('status', folderCfg.status);
    }
    if (folderCfg.read) params.set('read', folderCfg.read);
    if (folderCfg.attachments) params.set('attachments', folderCfg.attachments);
    if (priorityFilter) params.set('priority', priorityFilter);
    if (categoryFilter) params.set('category', categoryFilter);
    if (period) params.set('days', period);
    if (sortBy && sortBy !== 'date') params.set('sort', sortBy);
    if (searchQuery.trim()) params.set('q', searchQuery.trim());
    return params;
  }, [folder, folderCfg, priorityFilter, categoryFilter, period, sortBy, searchQuery]);

  const load = useCallback((p) => {
    api.get(`/inbox?${buildParams(p).toString()}`)
      .then(({ data }) => { setThreads(data.items); setTotal(data.total); setSelectedIds([]); })
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'))
      .finally(() => setLoading(false));
  }, [buildParams]);

  const refreshCounts = useCallback(() => {
    api.get('/inbox/counts')
      .then(({ data }) => setCounts(data))
      .catch(() => {});
  }, []);

  // ── Dossiers custom ────────────────────────────────────────────────
  const loadCustomFolders = useCallback(() => {
    api.get('/inbox/folders')
      .then(({ data }) => setCustomFolders(data))
      .catch(() => {});
  }, []);

  async function handleCreateFolder(e) {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    try {
      await api.post('/inbox/folders', { name: newFolderName.trim(), color: newFolderColor });
      setNewFolderName('');
      setShowCreateFolder(false);
      loadCustomFolders();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la création');
    } finally {
      setCreatingFolder(false);
    }
  }

  async function handleDeleteFolder(id) {
    if (!confirm('Les emails de ce dossier reviendront dans la boîte de réception. Supprimer ?')) return;
    try {
      await api.delete(`/inbox/folders/${id}`);
      loadCustomFolders();
      if (folder === `folder-${id}`) setFolder('all');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la suppression');
    }
  }

  async function handleMoveToFolder(folderId) {
    if (selectedIds.length === 0) return;
    try {
      // Extraire les email IDs à partir des keys sélectionnées
      const emailIds = selectedIds.map((key) => {
        if (key.startsWith('single-')) return Number(key.slice('single-'.length));
        // Pour les conversations, on prend le premier email
        const thread = threads.find((t) => t.id === key);
        return thread?.latest?.emailId || null;
      }).filter(Boolean);
      if (emailIds.length === 0) return;
      await api.post('/inbox/folders/move', { ids: emailIds, folderId });
      toast.success(`${emailIds.length} email(s) déplacé(s)`);
      setSelectedIds([]);
      setShowMoveModal(false);
      load(pageRef.current);
      refreshCounts();
      loadCustomFolders();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors du déplacement');
    }
  }

  useEffect(() => { load(1); setPage(1); }, [load]);
  useEffect(() => { refreshCounts(); }, [refreshCounts]);
  useEffect(() => { loadCustomFolders(); }, [loadCustomFolders]);

  // Auto-refresh toutes les 15s (comportement existant)
  useEffect(() => {
    const id = setInterval(() => {
      if (pageRef.current === 1) load(1);
      refreshCounts();
    }, 15000);
    return () => clearInterval(id);
  }, [load, refreshCounts]);

  // Recharge le fil sélectionné (après un event socket) si besoin
  const refreshSelection = useCallback(() => {
    if (!selectedThread) return;
    api.get(`/inbox/thread?key=${encodeURIComponent(selectedThread.id)}`)
      .then(({ data }) => setThreadDetail(data))
      .catch(() => {});
  }, [selectedThread]);

  // ── Socket ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    const onReceived = (email) => {
      if (pageRef.current === 1) load(1);
      refreshCounts();
      toast.info('Nouveau mail reçu', { description: `Sujet : ${email.subject}` });
      if (selectedThread && email.conversationId === selectedThread.conversationId) refreshSelection();
    };
    const onUpdated = (email) => {
      if (pageRef.current === 1) load(1);
      if (selectedThread && (keyOfEmail(email) === selectedThread.id)) refreshSelection();
    };
    socket.on('email_received', onReceived);
    socket.on('email_updated', onUpdated);
    return () => { socket.off('email_received', onReceived); socket.off('email_updated', onUpdated); };
  }, [socket, load, refreshCounts, selectedThread, refreshSelection]);

  // ── Actions ─────────────────────────────────────────────────────────────
  async function handleSync() {
    setSyncing(true); setError(''); 
    try {
      const { data } = await api.post('/inbox/sync');
      load(pageRef.current);
      refreshCounts();
      toast.success('Synchronisation terminée', { description: `${data.processed} email(s) traité(s) par l'agent IA.` });
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du sync');
    } finally { setSyncing(false); }
  }

  function openThread(thread) {
    setSelectedThread(thread);
    setDetailLoading(true);
    api.get(`/inbox/thread?key=${encodeURIComponent(thread.id)}`)
      .then(({ data }) => {
        setThreadDetail(data);
        // Marque comme lu si le fil contient des non-lus
        if (data.isUnread) {
          api.post('/inbox/read', { key: data.id })
            .then(() => {
              setThreads((prev) => prev.map((t) =>
                t.id === data.id ? { ...t, isUnread: false, unreadCount: 0, latest: { ...t.latest, isRead: true } } : t
              ));
              refreshCounts();
            })
            .catch(() => {});
        }
      })
      .catch((err) => {
        setThreadDetail(null);
        toast.error(err.response?.data?.error || 'Erreur de chargement de la conversation');
      })
      .finally(() => setDetailLoading(false));
  }

  function closeThread() {
    setSelectedThread(null);
    setThreadDetail(null);
  }

  async function bulkMarkRead(read = true) {
    if (selectedIds.length === 0) return;
    setBulkAction('mark');
    try {
      await api.post('/inbox/read', { keys: selectedIds, read });
      toast.success(read ? `${selectedIds.length} conversation(s) marquée(s) comme lue(s)` : 'Conversations marquées comme non lues');
      setSelectedIds([]);
      load(pageRef.current);
      refreshCounts();
    } catch (err) {
      toast.error(err.response?.data?.error || "Erreur lors de l'action");
    } finally { setBulkAction(null); }
  }

  async function handleTestAnalyze(e) {
    e.preventDefault(); setTesting(true); setTestResult(null); setTestError('');
    try {
      const { data } = await api.post('/inbox/test-analyze', testForm);
      setTestResult(data);
    } catch (err) { setTestError(err.response?.data?.error || 'Erreur lors du test'); }
    finally { setTesting(false); }
  }

  function openTestModal() {
    setTestForm({ subject: '', body: '', from: '', fromName: '' });
    setTestResult(null); setTestError(''); setShowTestModal(true);
  }

  function keyOfEmail(email) {
    return email.conversationId || `single-${email.id}`;
  }

  function toggleSelect(id) { setSelectedIds((ids) => ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]); }
  function toggleSelectAll() { setSelectedIds((ids) => ids.length === threads.length ? [] : threads.map((t) => t.id)); }

  // ── Dérivés ─────────────────────────────────────────────────────────────
  // Le tri est appliqué côté serveur (avant pagination) via le paramètre ?sort=
  const availableCategories = useMemo(() =>
    [...new Set(threads.map((t) => t.latest?.aiCategory).filter(Boolean))], [threads]);

  const countFor = (fid) => {
    if (!counts) return null;
    switch (fid) {
      case 'all': return counts.total;
      case 'unread': return counts.unread;
      case 'pending': return counts.pending;
      case 'done': return counts.done;
      case 'error': return counts.error;
      case 'spam': return counts.spam;
      case 'attachments': return counts.withAttachments;
      default: return null;
    }
  };

  const periodLabel = PERIOD_OPTIONS.find((o) => o.value === period)?.label || 'Toute période';
  const sortLabel = SORT_OPTIONS.find((o) => o.value === sortBy)?.label || 'Date';

  const pendingCount = threads.filter((t) => t.latest?.status === 'PENDING').length;

  const detailAttachments = useMemo(() =>
    (threadDetail?.messages || []).flatMap((m) => m.attachments || []), [threadDetail]);

  const isCompact = density === 'compact';

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] max-h-[calc(100vh-64px)] overflow-hidden">
      {/* ── Barre supérieure ──────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-outline-variant/30 bg-surface-container-lowest px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-1.5 bg-sky-500/10 rounded-lg">
            <InboxIcon className="w-5 h-5 text-sky-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-on-surface truncate flex items-center gap-2">
              {folderCfg.label}
              {folderCfg.status === 'PENDING' && pendingCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-amber-500 text-white text-[10px] font-black">
                  {pendingCount}
                </span>
              )}
            </h1>
            <p className="text-[11px] text-on-surface-variant">
              {total} conversation{total !== 1 ? 's' : ''}
              {counts?.unread > 0 && ` · ${counts.unread} non lue${counts.unread !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        {/* Recherche */}
        <div className="relative flex-1 max-w-sm hidden sm:block">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/60" />
          <input
            type="text"
            placeholder="Rechercher par expéditeur, sujet, contenu…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full bg-surface border border-outline-variant/40 rounded-xl pl-9 pr-8 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />
          {searchInput && (
            <button onClick={() => { setSearchInput(''); setSearchQuery(''); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50 hover:text-on-surface cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 ml-auto shrink-0">
          {['error', 'dead_letter', 'retry'].includes(folder) && (
            <button
              onClick={openRetryModal}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 text-xs font-semibold transition-all cursor-pointer"
              title="Relancer les emails en erreur reçus sur une période donnée"
            >
              <CalendarRange className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Relancer (dates)</span>
            </button>
          )}
          {canSync && (
            <button
              onClick={openTestModal}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant/50 bg-surface-container text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high text-xs font-semibold transition-all cursor-pointer"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Test IA</span>
            </button>
          )}
          <button
            onClick={() => setShowRulesModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-violet-500/40 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 text-xs font-semibold transition-all cursor-pointer"
            title="Règles de tri automatique"
          >
            <Filter className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Règles</span>
          </button>
          {canSync && (
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-blue-500 text-white text-xs font-bold shadow-md shadow-sky-500/20 transition-all hover:brightness-110 disabled:opacity-60 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{syncing ? 'Syncing...' : 'Sync'}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Bannière d'erreur ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="shrink-0 overflow-hidden">
            <div className="px-4 py-2 bg-red-500/5 border-b border-red-500/20 text-red-400 text-xs flex items-center gap-2">
              <XCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
              <button onClick={() => setError('')} className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Corps : 3 volets (dossiers | liste | lecture) ─────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ═══ Volets de dossiers (façon Outlook) ═══ */}
        <aside className="hidden md:flex w-52 shrink-0 flex-col border-r border-outline-variant/30 bg-surface-container-lowest overflow-y-auto">
          <div className="p-2 space-y-0.5">
            {FOLDERS.map((f) => {
              const Icon = f.icon;
              const isActive = folder === f.id;
              const c = countFor(f.id);
              return (
                <button
                  key={f.id}
                  onClick={() => { setFolder(f.id); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                      : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface border border-transparent'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1 text-left truncate">{f.label}</span>
                  {c != null && c > 0 && (
                    <span className={`shrink-0 min-w-4 px-1 py-0.5 rounded-full text-center text-[9px] font-bold ${
                      isActive ? 'bg-sky-500/20 text-sky-300' : 'bg-surface-container-high text-on-surface-variant'
                    }`}>
                      {c > 999 ? '999+' : c}
                    </span>
                  )}
                </button>
              );
            })}

            {/* Dossiers custom */}
            {customFolders.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-3 pt-3 pb-1">
                  <span className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-wider flex-1">Mes dossiers</span>
                  <button
                    onClick={() => setShowCreateFolder(true)}
                    className="p-0.5 rounded text-on-surface-variant/60 hover:text-sky-400 transition-colors cursor-pointer"
                    title="Créer un dossier"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                {customFolders.map((f) => {
                  const isActive = folder === `folder-${f.id}`;
                  return (
                    <button
                      key={`folder-${f.id}`}
                      onClick={() => { setFolder(`folder-${f.id}`); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer group ${
                        isActive
                          ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                          : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface border border-transparent'
                      }`}
                    >
                      <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: f.color || '#6b7280' }} />
                      <span className="flex-1 text-left truncate">{f.name}</span>
                      {f.emailCount > 0 && (
                        <span className={`shrink-0 min-w-4 px-1 py-0.5 rounded-full text-center text-[9px] font-bold ${
                          isActive ? 'bg-sky-500/20 text-sky-300' : 'bg-surface-container-high text-on-surface-variant'
                        }`}>
                          {f.emailCount > 999 ? '999+' : f.emailCount}
                        </span>
                      )}
                      {!f.isSystem && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteFolder(f.id); }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-red-400/60 hover:text-red-400 transition-all cursor-pointer"
                          title="Supprimer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </button>
                  );
                })}
              </>
            )}
            {customFolders.length === 0 && (
              <button
                onClick={() => setShowCreateFolder(true)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-on-surface-variant/50 hover:text-on-surface-variant hover:bg-surface-container transition-all cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Créer un dossier</span>
              </button>
            )}
          </div>
          <div className="mt-auto px-3 py-3 border-t border-outline-variant/20 text-[10px] text-on-surface-variant/70 leading-relaxed">
            Fils de conversation triés par l'IA Gemini · rafraîchissement auto 15s
          </div>
        </aside>

        {/* ═══ Volet liste ═══ */}
        <div className={`flex flex-col border-r border-outline-variant/30 bg-surface-container-lowest overflow-hidden transition-all duration-300 ${
          selectedThread ? 'w-96 xl:w-[420px] shrink-0' : 'flex-1'
        }`}>

          {/* Barre d'outils de la liste */}
          <div className="shrink-0 border-b border-outline-variant/20 bg-surface-container-low/40 px-2.5 py-1.5 flex items-center gap-1.5 flex-wrap">
            <div className="px-1 shrink-0">
              <input
                type="checkbox"
                checked={threads.length > 0 && selectedIds.length === threads.length}
                onChange={toggleSelectAll}
                title="Tout sélectionner"
                className="cursor-pointer accent-sky-500 w-3.5 h-3.5 rounded"
              />
            </div>
            <FilterSelect icon={ArrowDownWideNarrow} label={sortLabel} value={sortBy} options={SORT_OPTIONS} onChange={(v) => { setSortBy(v); }} />
            <FilterSelect icon={Flame} label={priorityFilter ? PRIORITY_CONFIG[priorityFilter]?.label : 'Priorité'} value={priorityFilter} options={PRIORITY_OPTIONS} onChange={setPriorityFilter} active={!!priorityFilter} />
            {availableCategories.length > 0 && (
              <FilterSelect icon={Tag} label={categoryFilter || 'Catégorie IA'} value={categoryFilter} options={[{ value: '', label: 'Toutes catégories' }, ...availableCategories.map((c) => ({ value: c, label: c }))]} onChange={setCategoryFilter} active={!!categoryFilter} />
            )}
            <FilterSelect icon={Filter} label={periodLabel} value={period} options={PERIOD_OPTIONS} onChange={setPeriod} active={!!period} />

            {/* Densité */}
            <div className="ml-auto flex items-center gap-0.5 shrink-0">
              <button
                title="Affichage confortable"
                onClick={() => setDensity('comfortable')}
                className={`p-1.5 rounded-lg transition-all cursor-pointer ${!isCompact ? 'bg-sky-500/10 text-sky-400' : 'text-on-surface-variant hover:bg-surface-container'}`}
              >
                <Rows3 className="w-3.5 h-3.5" />
              </button>
              <button
                title="Affichage compact"
                onClick={() => setDensity('compact')}
                className={`p-1.5 rounded-lg transition-all cursor-pointer ${isCompact ? 'bg-sky-500/10 text-sky-400' : 'text-on-surface-variant hover:bg-surface-container'}`}
              >
                <Rows4 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Barre d'actions groupées */}
          <AnimatePresence>
            {selectedIds.length > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                className="shrink-0 overflow-hidden border-b border-sky-500/20 bg-sky-500/10"
              >
                <div className="px-3 py-2 flex items-center gap-2">
                  <span className="text-[11px] font-bold text-sky-400">
                    {selectedIds.length} sélectionnée{selectedIds.length !== 1 ? 's' : ''}
                  </span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      onClick={() => setShowMoveModal(true)}
                      disabled={bulkAction}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-600 text-white text-[10px] font-bold disabled:opacity-50 hover:bg-violet-700 transition-all cursor-pointer"
                    >
                      <ArrowRight className="w-3 h-3" /> Déplacer
                    </button>
                    <button
                      onClick={() => bulkMarkRead(true)}
                      disabled={bulkAction}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-600 text-white text-[10px] font-bold disabled:opacity-50 hover:bg-sky-700 transition-all cursor-pointer"
                    >
                      <CheckCheck className="w-3 h-3" /> Lues
                    </button>
                    <button
                      onClick={() => bulkMarkRead(false)}
                      disabled={bulkAction}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface-container-high text-on-surface text-[10px] font-bold disabled:opacity-50 hover:bg-surface-container transition-all cursor-pointer"
                    >
                      <MailOpen className="w-3 h-3" /> Non lues
                    </button>
                    <button
                      onClick={() => setSelectedIds([])}
                      disabled={bulkAction}
                      className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Liste des fils */}
          <div className="flex-1 overflow-y-auto">
            {loading && threads.length === 0 ? (
              <div className="p-3 space-y-2">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3.5 border-b border-outline-variant/10">
                    <Skeleton variant="avatar-sm" className="w-8 h-8 rounded-full shrink-0" />
                    <div className="flex-1 min-w-0 space-y-2">
                      <Skeleton variant="text-sm" className="w-1/3" />
                      <Skeleton variant="text-sm" className="w-2/3" />
                      <Skeleton variant="text-sm" className="w-1/2" />
                    </div>
                    <Skeleton variant="badge" className="w-10 h-4" />
                  </div>
                ))}
              </div>
            ) : threads.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-on-surface-variant p-6">
                <div className="p-4 rounded-full bg-surface-container">
                  <Mail className="w-8 h-8 text-outline/30" />
                </div>
                <p className="text-sm italic text-center">Aucune conversation trouvée.</p>
                {canSync && (
                  <button onClick={handleSync} className="text-xs text-sky-400 underline underline-offset-2 cursor-pointer">
                    Synchroniser maintenant
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-outline-variant/10">
                {threads.map((t) => {
                  const latest = t.latest || {};
                  const pCfg = PRIORITY_CONFIG[latest.aiPriority];
                  const sCfg = STATUS_CONFIG[latest.status];
                  const SIcon = sCfg?.icon;
                  const isSelected = selectedThread?.id === t.id;
                  const isChecked = selectedIds.includes(t.id);
                  const sender = latest.fromName || latest.fromEmail || participantsLabel(t.participants);
                  const snippet = latest.aiSummary || latest.bodyPreview || '';

                  return (
                    <motion.button
                      key={t.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.1 }}
                      onClick={() => openThread(t)}
                      onContextMenu={(e) => handleContextMenu(e, t)}
                      className={`w-full text-left flex items-stretch gap-0 border-b border-outline-variant/15 transition-all group ${
                        isSelected
                          ? 'bg-sky-500/10 ring-1 ring-inset ring-sky-500/20'
                          : t.isUnread
                            ? 'bg-surface-container-low/40 hover:bg-surface-container'
                            : 'hover:bg-surface-container-low/60'
                      }`}
                    >
                      {/* Bande de priorité */}
                      <div className="w-0.5 shrink-0 rounded-r" style={{ background: pCfg ? pCfg.stripe : 'transparent' }} />

                      <div className={`flex items-start gap-2.5 flex-1 min-w-0 px-3 ${isCompact ? 'py-2' : 'py-3'}`}>
                        {/* Case à cocher */}
                        <div className="shrink-0 flex items-center pt-1.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelect(t.id)}
                            className="cursor-pointer accent-sky-500 w-3.5 h-3.5 rounded"
                          />
                        </div>

                        {/* Avatar */}
                        <div className={`shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold text-white ring-2 ring-surface-container-lowest ${pCfg ? pCfg.bg : t.isUnread ? 'bg-sky-600' : 'bg-zinc-500'}`}
                          style={{ width: isCompact ? 30 : 34, height: isCompact ? 30 : 34 }}
                        >
                          {initialOf(latest.fromName, latest.fromEmail)}
                        </div>

                        {/* Contenu */}
                        <div className="flex-1 min-w-0">
                          {/* Ligne 1 : expéditeur + heure */}
                          <div className="flex items-center gap-1.5">
                            <span className={`truncate ${t.isUnread ? 'text-on-surface font-bold' : 'text-on-surface font-semibold'}`}
                              style={{ fontSize: isCompact ? 11 : 12 }}
                            >
                              {sender}
                            </span>
                            {t.isUnread && <CircleDot className="w-2.5 h-2.5 text-sky-400 shrink-0" />}
                            <span className="ml-auto shrink-0 text-[10px] text-on-surface-variant/70">{formatDate(latest.date)}</span>
                          </div>

                          {/* Ligne 2 : sujet + badges */}
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`truncate ${t.isUnread ? 'text-on-surface font-bold' : 'text-on-surface'}`} style={{ fontSize: isCompact ? 11 : 12 }}>
                              {latest.subject || '(sans objet)'}
                            </span>
                            {t.count > 1 && (
                              <span className="shrink-0 inline-flex items-center justify-center min-w-4 px-1 py-0.5 rounded-full bg-sky-500/10 text-sky-400 text-[9px] font-bold border border-sky-500/20">
                                {t.count}
                              </span>
                            )}
                            {t.hasAttachments && <Paperclip className="w-3 h-3 text-on-surface-variant/70 shrink-0" />}
                            {pCfg && <pCfg.icon className="w-3 h-3 shrink-0" style={{ color: pCfg.stripe }} />}
                          </div>

                          {/* Ligne 3 : extrait IA */}
                          {snippet && (
                            <p className={`truncate mt-0.5 ${latest.aiSummary ? 'text-on-surface-variant italic' : 'text-on-surface-variant/70'}`} style={{ fontSize: isCompact ? 10 : 11 }}>
                              {snippet}
                            </p>
                          )}

                          {/* Ligne 4 : CC + métadonnées */}
                          {(t.ccRecipients?.length > 0 || latest.erpTicketId || sCfg) && (
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {t.ccRecipients?.length > 0 && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface-container border border-outline-variant/30 text-[9px] font-semibold text-on-surface-variant">
                                  <Send className="w-2.5 h-2.5 shrink-0" />
                                  Cc : {t.ccRecipients.slice(0, 2).map(displayAddr).join(', ')}
                                  {t.ccRecipients.length > 2 ? ` +${t.ccRecipients.length - 2}` : ''}
                                </span>
                              )}
                              {latest.erpTicketId && (
                                <span
                                  onClick={(e) => { e.stopPropagation(); navigate(`/tickets/${latest.erpTicketId}`); }}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 text-[9px] font-bold hover:bg-primary/15 transition-all cursor-pointer"
                                >
                                  <ArrowUpRight className="w-2.5 h-2.5" /> Ticket #{latest.erpTicketId}
                                </span>
                              )}
                              {sCfg && (
                                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${sCfg.bg} ${sCfg.color} ${sCfg.border}`}>
                                  {SIcon && <SIcon className="w-2 h-2" />}
                                  {sCfg.label}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Actions rapides au hover (Outlook-like) */}
                      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0 px-2 self-center" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => ctxMarkRead(t.isUnread)}
                          className="p-1.5 rounded-lg text-on-surface-variant/60 hover:text-sky-400 hover:bg-sky-500/10 transition-all cursor-pointer"
                          title={t.isUnread ? 'Marquer lu' : 'Marquer non lu'}>
                          {t.isUnread ? <MailOpen className="w-3.5 h-3.5" /> : <CircleDot className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => { setSelectedIds([t.id]); setShowMoveModal(true); }}
                          className="p-1.5 rounded-lg text-on-surface-variant/60 hover:text-violet-400 hover:bg-violet-500/10 transition-all cursor-pointer"
                          title="Déplacer">
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                        {t.hasAttachments && (
                          <span className="p-1.5 text-on-surface-variant/40">
                            <Paperclip className="w-3.5 h-3.5" />
                          </span>
                        )}
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pagination */}
          {total > 25 && (
            <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-t border-outline-variant/20 bg-surface-bright/10">
              <button
                disabled={page === 1}
                onClick={() => { const p = page - 1; setPage(p); load(p); }}
                className="text-[11px] font-semibold text-on-surface-variant disabled:opacity-30 hover:text-on-surface transition-colors px-2 py-1 rounded-lg hover:bg-surface-container cursor-pointer"
              >← Préc.</button>
              <span className="text-[11px] text-on-surface-variant">{page} / {Math.ceil(total / 25)}</span>
              <button
                disabled={page * 25 >= total}
                onClick={() => { const p = page + 1; setPage(p); load(p); }}
                className="text-[11px] font-semibold text-on-surface-variant disabled:opacity-30 hover:text-on-surface transition-colors px-2 py-1 rounded-lg hover:bg-surface-container cursor-pointer"
              >Suiv. →</button>
            </div>
          )}
        </div>

        {/* ═══ Volet de lecture (façon Outlook) ═══ */}
        <AnimatePresence>
          {selectedThread ? (
            <motion.div
              key={selectedThread.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex-1 flex flex-col min-w-0 overflow-hidden bg-surface-container-lowest"
            >
              {detailLoading && !threadDetail ? (
                <div className="h-full flex items-center justify-center text-on-surface-variant">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                </div>
              ) : threadDetail ? (
                <>
                  {/* En-tête du message */}
                  <div className="shrink-0 border-b border-outline-variant/20 px-5 py-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          onClick={closeThread}
                          className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer shrink-0"
                          title="Fermer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                        <h2 className="text-lg font-bold text-on-surface truncate">
                          {threadDetail.latest?.subject || '(sans objet)'}
                        </h2>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                        {threadDetail.latest?.aiPriority && (
                          <PriorityBadge p={threadDetail.latest.aiPriority} />
                        )}
                        {threadDetail.latest?.status && STATUS_CONFIG[threadDetail.latest.status] && (
                          <StatusBadge status={threadDetail.latest.status} />
                        )}
                      </div>
                    </div>

                    {/* Expéditeur / destinataires / date */}
                    <div className="flex items-start gap-3">
                      <div className={`shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                        PRIORITY_CONFIG[threadDetail.latest?.aiPriority]?.bg || 'bg-sky-600'
                      }`} style={{ width: 40, height: 40 }}>
                        {initialOf(threadDetail.latest?.fromName, threadDetail.latest?.fromEmail)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm text-on-surface">
                          <span className="font-bold">{threadDetail.latest?.fromName || threadDetail.latest?.fromEmail || 'Expéditeur inconnu'}</span>
                          {threadDetail.latest?.fromName && threadDetail.latest?.fromEmail && (
                            <span className="text-on-surface-variant">&lt;{threadDetail.latest.fromEmail}&gt;</span>
                          )}
                        </div>
                        {threadDetail.participants?.length > 0 && (
                          <div className="text-[11px] text-on-surface-variant mt-0.5">
                            Participants : {participantsLabel(threadDetail.participants)}
                          </div>
                        )}
                        {threadDetail.ccRecipients?.length > 0 && (
                          <div className="text-[11px] text-on-surface-variant mt-0.5 flex items-center gap-1">
                            <Send className="w-2.5 h-2.5 shrink-0" />
                            <span className="font-semibold">Cc :</span>
                            <span className="truncate">{threadDetail.ccRecipients.map(displayAddr).join(', ')}</span>
                          </div>
                        )}
                        <div className="text-[10px] text-on-surface-variant/70 mt-1">
                          {formatDateTime(threadDetail.latest?.date)}
                          {threadDetail.count > 1 && ` · ${threadDetail.count} message${threadDetail.count !== 1 ? 's' : ''}`}
                          {threadDetail.sentCount > 0 && ` · ${threadDetail.sentCount} envoyé${threadDetail.sentCount !== 1 ? 's' : ''}`}
                        </div>
                      </div>
                      <div className="ml-auto shrink-0 flex items-center gap-2">
                        {!threadDetail.latest?.erpTicketId && (
                          <button
                            onClick={() => {
                              const latest = threadDetail.latest || {};
                              setTicketForm({
                                title: (latest.subject || '').substring(0, 200),
                                content: (latest.bodyPreview || latest.bodyHtml || '').substring(0, 5000),
                                priority: 'P3',
                                category: '',
                                teamId: '',
                                assignedToId: '',
                              });
                              setShowCreateTicket(true);
                            }}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs font-bold hover:bg-emerald-500/15 transition-all cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Créer un ticket
                          </button>
                        )}
                        {['ERROR', 'DEAD_LETTER', 'RETRY'].includes(threadDetail.latest?.status) && (
                          <button
                            onClick={async () => {
                              try {
                                await api.post(`/inbox/${threadDetail.latest.id ?? threadDetail.latest.emailId}/retry`);
                                toast.success('Email relancé avec succès');
                                refreshSelection();
                                load();
                              } catch (err) {
                                toast.error(err.response?.data?.error || 'Erreur lors du relancement');
                              }
                            }}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-xs font-bold hover:bg-amber-500/15 transition-all cursor-pointer"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            Relancer
                          </button>
                        )}
                        {threadDetail.latest?.erpTicketId && (
                          <button
                            onClick={() => navigate(`/tickets/${threadDetail.latest.erpTicketId}`)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary/10 text-primary border border-primary/20 text-xs font-bold hover:bg-primary/15 transition-all cursor-pointer"
                          >
                            <ArrowUpRight className="w-3.5 h-3.5" />
                            Ticket #{threadDetail.latest.erpTicketId}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Pièces jointes */}
                    {detailAttachments.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Paperclip className="w-3.5 h-3.5 text-on-surface-variant shrink-0" />
                        {detailAttachments.map((a) => (
                          <span key={a.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-outline-variant/40 bg-surface-container text-[11px] font-medium text-on-surface">
                            <FileText className="w-3 h-3 text-sky-400 shrink-0" />
                            <span className="max-w-[180px] truncate">{a.filename}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Corps de la conversation */}
                  <div className="flex-1 overflow-y-auto">
                    <div className="max-w-3xl mx-auto px-5 py-6 space-y-6">
                      {(threadDetail.messages || []).map((msg) => {
                        const isInbound = msg.kind === 'inbound';
                        const sCfg = STATUS_CONFIG[msg.status];
                        const pCfg = PRIORITY_CONFIG[msg.aiPriority];
                        return (
                          <div key={`${msg.kind}-${msg.emailId || msg.messageId}`} className="space-y-4">
                            {/* En-tête du message */}
                            <div className="flex items-start gap-3">
                              <div className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white ${isInbound ? (pCfg ? pCfg.bg : 'bg-zinc-600') : 'bg-sky-600'}`}>
                                {initialOf(msg.fromName, msg.fromEmail)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-bold text-on-surface truncate">{msg.fromName || msg.fromEmail}</span>
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                                    isInbound ? 'bg-surface-container text-on-surface-variant border-outline-variant/40' : 'bg-sky-500/10 text-sky-400 border-sky-500/20'
                                  }`}>
                                    {isInbound ? <MailOpen className="w-2.5 h-2.5" /> : <Reply className="w-2.5 h-2.5" />}
                                    {isInbound ? 'Reçu' : 'Envoyé'}
                                  </span>
                                  {!isInbound && msg.ccRecipients?.length > 0 && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold text-on-surface-variant border border-outline-variant/40 bg-surface-container">
                                      <Send className="w-2.5 h-2.5" /> Cc : {msg.ccRecipients.map(displayAddr).join(', ')}
                                    </span>
                                  )}
                                  {sCfg && isInbound && (
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border ${sCfg.bg} ${sCfg.color} ${sCfg.border}`}>
                                      <sCfg.icon className="w-2.5 h-2.5" />
                                      {sCfg.label}
                                    </span>
                                  )}
                                  {pCfg && isInbound && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border" style={{ color: pCfg.stripe, borderColor: pCfg.stripe + '44', backgroundColor: pCfg.stripe + '11' }}>
                                      <pCfg.icon className="w-2.5 h-2.5" />
                                      {pCfg.label}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] text-on-surface-variant mt-0.5">{formatDateTime(msg.receivedAt || msg.timestamp)}</p>
                              </div>
                            </div>

                            {/* Analyse IA (entrant uniquement) */}
                            {isInbound && (msg.aiSummary || msg.aiCategory || msg.aiTeam || msg.aiConfidence != null) && (
                              <div className="ml-12 rounded-2xl border border-purple-500/20 bg-purple-500/5 overflow-hidden">
                                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-purple-500/15">
                                  <div className="p-1.5 rounded-lg bg-purple-500/10">
                                    <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                                  </div>
                                  <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">Analyse IA — Gemini</span>
                                  {msg.aiConfidence != null && (
                                    <span className="ml-auto text-[10px] font-bold text-purple-300">
                                      {Math.round(msg.aiConfidence * 100)}% confiance
                                    </span>
                                  )}
                                </div>
                                <div className="p-4 space-y-3">
                                  {msg.aiSummary && (
                                    <p className="text-sm text-on-surface leading-relaxed italic">"{msg.aiSummary}"</p>
                                  )}
                                  <div className="grid grid-cols-2 gap-3">
                                    {msg.aiCategory && (
                                      <div className="bg-surface-container/40 rounded-xl p-3">
                                        <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Catégorie</p>
                                        <p className="text-sm font-semibold text-on-surface">{msg.aiCategory}</p>
                                      </div>
                                    )}
                                    {msg.aiTeam && (
                                      <div className="bg-surface-container/40 rounded-xl p-3">
                                        <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Équipe suggérée</p>
                                        <p className="text-sm font-semibold text-on-surface">{msg.aiTeam}</p>
                                      </div>
                                    )}
                                    {msg.glpiTicketId && (
                                      <div className="bg-surface-container/40 rounded-xl p-3">
                                        <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Ticket GLPI</p>
                                        <p className="text-sm font-semibold text-on-surface">#{msg.glpiTicketId}</p>
                                      </div>
                                    )}
                                    {msg.erpTicketId && (
                                      <div className="bg-surface-container/40 rounded-xl p-3">
                                        <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Ticket ERP</p>
                                        <p className="text-sm font-semibold text-primary cursor-pointer" onClick={() => navigate(`/tickets/${msg.erpTicketId}`)}>#{msg.erpTicketId}</p>
                                      </div>
                                    )}
                                  </div>
                                  {msg.aiConfidence != null && (
                                    <div className="h-1.5 bg-surface-container rounded-full overflow-hidden">
                                      <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${Math.round(msg.aiConfidence * 100)}%` }}
                                        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                                        className="h-full bg-gradient-to-r from-purple-500 to-violet-400 rounded-full"
                                      />
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Erreur */}
                            {isInbound && msg.error && (
                              <div className="ml-12 rounded-xl border border-red-500/20 bg-red-500/5 p-4 space-y-2">
                                <div className="flex items-start gap-3">
                                  <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                                  <p className="text-sm text-red-400 flex-1">{msg.error}</p>
                                  {msg.errorDetail && (
                                    <button
                                      onClick={() => {
                                        const key = msg.emailId || msg.messageId;
                                        setExpandedErrors((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(key)) next.delete(key); else next.add(key);
                                          return next;
                                        });
                                      }}
                                      className="shrink-0 flex items-center gap-1 text-[11px] text-red-300/70 hover:text-red-300 transition-colors cursor-pointer"
                                    >
                                      <Info className="w-3 h-3" />
                                      {expandedErrors.has(msg.emailId || msg.messageId) ? 'Masquer' : 'Détails'}
                                      {expandedErrors.has(msg.emailId || msg.messageId)
                                        ? <ChevronUp className="w-3 h-3" />
                                        : <ChevronDown className="w-3 h-3" />}
                                    </button>
                                  )}
                                </div>
                                {msg.errorDetail && expandedErrors.has(msg.emailId || msg.messageId) && (
                                  <div className="ml-7 rounded-lg border border-red-500/10 bg-red-500/[0.03] p-3">
                                    <pre className="text-xs text-red-300/60 whitespace-pre-wrap font-sans leading-relaxed">{msg.errorDetail}</pre>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Corps du message */}
                            <div className={`rounded-2xl border border-outline-variant/25 ${isInbound ? 'bg-surface-container-low/40' : 'bg-sky-500/[0.03]'} overflow-hidden`}>
                              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-outline-variant/15">
                                <MailOpen className="w-3.5 h-3.5 text-on-surface-variant" />
                                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
                                  {isInbound ? 'Corps du message' : 'Réponse envoyée'}
                                </span>
                              </div>
                              <div className="p-5">
                                {(() => {
                                  const html = msg.bodyHtml;
                                  const plain = isInbound ? msg.bodyPreview : msg.body;
                                  return html ? (
                                    <div className="text-sm text-on-surface leading-relaxed prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
                                  ) : plain ? (
                                    <pre className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap font-sans">{plain}</pre>
                                  ) : (
                                    <p className="text-sm text-on-surface-variant italic">Corps du message non disponible.</p>
                                  );
                                })()}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {threadDetail.messages.length === 0 && (
                        <div className="flex flex-col items-center justify-center gap-3 text-on-surface-variant py-16">
                          <Mail className="w-10 h-10 text-outline/30" />
                          <p className="text-sm italic">Aucun message dans cette conversation.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center gap-4 text-on-surface-variant bg-surface-container-lowest"
            >
              <div className="p-6 rounded-full bg-surface-container">
                <Users className="w-10 h-10 text-outline/40" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold">Sélectionnez une conversation</p>
                <p className="text-xs text-on-surface-variant/60 mt-1">pour voir son contenu, les destinataires en copie et l'analyse IA</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Modale Test IA ───────────────────────────────────────────────── */}
      {canSync && createPortal(
        <AnimatePresence>
          {showTestModal && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setShowTestModal(false)}
                className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 16 }}
                transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }}
                className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl max-w-md w-full p-6 card-shadow flex flex-col gap-5 overflow-hidden max-h-[90vh]"
              >
                <div className="flex justify-between items-center pb-3 border-b border-outline-variant/30">
                  <h3 className="text-base font-bold text-on-surface flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-purple-500/10">
                      <Bot className="w-4 h-4 text-purple-400" />
                    </div>
                    Test analyse IA
                  </h3>
                  <motion.button onClick={() => setShowTestModal(false)} whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }} className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer">
                    <X className="w-4 h-4" />
                  </motion.button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-4">
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    Simulez l'analyse d'un e-mail par Gemini sans créer de ticket réel dans le système.
                  </p>

                  {testError && (
                    <div className="border border-red-500/20 bg-red-500/5 rounded-xl overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs font-bold">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        Analyse impossible
                      </div>
                      <div className="p-3 text-xs text-red-300/90 leading-relaxed max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-mono">
                        {testError}
                      </div>
                    </div>
                  )}

                  <form onSubmit={handleTestAnalyze} className="space-y-4">
                    {[
                      { label: 'Sujet *', key: 'subject', type: 'text', placeholder: 'ex: Mon VPN ne fonctionne plus', required: true },
                      { label: 'Email expéditeur', key: 'from', type: 'email', placeholder: 'user@example.com' },
                    ].map(f => (
                      <label key={f.key} className="flex flex-col gap-1.5">
                        <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">{f.label}</span>
                        <input
                          type={f.type}
                          required={f.required}
                          placeholder={f.placeholder}
                          value={testForm[f.key]}
                          onChange={e => setTestForm({ ...testForm, [f.key]: e.target.value })}
                          className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                        />
                      </label>
                    ))}
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Corps *</span>
                      <textarea
                        rows={4} required
                        placeholder="Bonjour, depuis ce matin je ne peux plus me connecter au VPN..."
                        value={testForm.body}
                        onChange={e => setTestForm({ ...testForm, body: e.target.value })}
                        className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none"
                      />
                    </label>

                    <div className="pt-3 border-t border-outline-variant/30 flex justify-end gap-2">
                      <button type="button" onClick={() => setShowTestModal(false)}
                        className="px-4 py-2.5 rounded-xl border border-outline-variant text-on-surface text-sm font-medium hover:bg-surface-container transition-colors cursor-pointer">
                        Annuler
                      </button>
                      <button type="submit" disabled={testing}
                        className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-violet-500 text-white text-sm font-bold shadow-md shadow-purple-500/20 transition-all hover:brightness-110 cursor-pointer disabled:opacity-60 flex items-center gap-2">
                        {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        {testing ? 'Analyse...' : 'Analyser'}
                      </button>
                    </div>
                  </form>

                  <AnimatePresence>
                    {testResult && (
                      <motion.div
                        key="result"
                        initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                        transition={{ type: 'spring', stiffness: 200, damping: 22 }}
                        className="border border-purple-500/20 bg-purple-500/5 rounded-xl p-4 space-y-2 overflow-hidden"
                      >
                        <p className="text-sm font-bold text-purple-400 flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4" />
                          Résultat Gemini
                        </p>
                        {Object.entries(testResult).map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-3 text-xs border-b border-outline-variant/15 pb-1.5 last:border-0 last:pb-0">
                            <span className="text-on-surface-variant capitalize">{k}</span>
                            <span className="text-on-surface font-medium text-right">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ── Modale Relance groupée (plage de dates) ──────────────────────── */}
      {canSync && createPortal(
        <AnimatePresence>
          {showRetryModal && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => !retryingAll && setShowRetryModal(false)}
                className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer"
              />
              <motion.form
                onSubmit={handleRetryRange}
                initial={{ opacity: 0, scale: 0.95, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 16 }}
                transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }}
                className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl max-w-md w-full p-6 card-shadow flex flex-col gap-5 overflow-hidden max-h-[90vh]"
              >
                <div className="flex justify-between items-center pb-3 border-b border-outline-variant/30">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-amber-500/10">
                      <CalendarRange className="w-5 h-5 text-amber-500" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-on-surface">Relancer les traitements échoués</h3>
                      <p className="text-[10px] text-on-surface-variant">Emails en erreur / échec — par période de réception</p>
                    </div>
                  </div>
                  <motion.button
                    type="button"
                    onClick={() => setShowRetryModal(false)}
                    disabled={retryingAll}
                    whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }}
                    className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer disabled:opacity-40"
                  >
                    <X className="w-4 h-4" />
                  </motion.button>
                </div>

                {/* Plage de dates */}
                <div className="space-y-4">
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    Sélectionnez la plage de dates de <strong className="text-on-surface">réception des emails</strong> à relancer.
                    Les <strong className="text-on-surface">7 derniers jours</strong> sont présélectionnés — ajustez selon vos besoins.
                    Seuls les emails en <strong className="text-amber-600 dark:text-amber-400">erreur / échec définitif</strong> seront traités.
                  </p>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Du *</span>
                      <input
                        type="date"
                        required
                        value={retryFrom}
                        max={retryTo || undefined}
                        onChange={(e) => setRetryFrom(e.target.value)}
                        className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3 py-2 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Au *</span>
                      <input
                        type="date"
                        required
                        value={retryTo}
                        min={retryFrom || undefined}
                        onChange={(e) => setRetryTo(e.target.value)}
                        className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3 py-2 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
                      />
                    </label>
                  </div>
                </div>

                <div className="pt-3 border-t border-outline-variant/30 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRetryModal(false)}
                    disabled={retryingAll}
                    className="px-4 py-2.5 rounded-xl border border-outline-variant text-on-surface text-xs font-medium hover:bg-surface-container transition-colors cursor-pointer disabled:opacity-40"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={retryingAll}
                    className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold shadow-md shadow-amber-500/20 transition-all hover:brightness-110 cursor-pointer disabled:opacity-60"
                  >
                    {retryingAll ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    {retryingAll ? 'Relance en cours...' : 'Relancer'}
                  </button>
                </div>
              </motion.form>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ── Modal Création Ticket depuis Email ────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {showCreateTicket && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => !ticketSaving && setShowCreateTicket(false)}
                className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: 'spring', duration: 0.35, bounce: 0.12 }}
                className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">

                {/* Header */}
                <div className="flex items-center gap-3 px-5 py-4 border-b border-outline-variant/30 shrink-0">
                  <div className="p-1.5 rounded-lg bg-emerald-500/10"><FileText className="w-4 h-4 text-emerald-600" /></div>
                  <div>
                    <h3 className="text-sm font-bold text-on-surface">Créer un ticket</h3>
                    <p className="text-[10px] text-on-surface-variant">À partir de l'email « {threadDetail?.subject || ''} »</p>
                  </div>
                  <motion.button onClick={() => setShowCreateTicket(false)} whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }}
                    className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all">
                    <X className="w-4 h-4" />
                  </motion.button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  {/* Bouton Assistant IA */}
                  <button
                    onClick={async () => {
                      setAiAnalyzing(true);
                      try {
                        const { data } = await api.post('/inbox/test-analyze', {
                          subject: ticketForm.title,
                          body: ticketForm.content,
                          from: threadDetail?.latest?.fromEmail || '',
                          fromName: threadDetail?.latest?.fromName || '',
                        });
                        setTicketForm(prev => ({
                          ...prev,
                          title: data.suggestedTitle || prev.title,
                          priority: data.priority || prev.priority,
                          category: data.category || prev.category,
                        }));
                        toast.success('Assistant IA : champs pré-remplis !');
                      } catch (err) {
                        toast.error(err.response?.data?.error || 'Erreur analyse IA');
                      } finally {
                        setAiAnalyzing(false);
                      }
                    }}
                    disabled={aiAnalyzing}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-500/30 text-violet-600 dark:text-violet-400 text-xs font-bold hover:from-violet-500/15 hover:to-purple-500/15 transition-all cursor-pointer disabled:opacity-60"
                  >
                    {aiAnalyzing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                    {aiAnalyzing ? 'Analyse en cours...' : 'Assistant IA — Remplir automatiquement'}
                  </button>

                  {/* Champs */}
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Titre *</span>
                    <input
                      required
                      value={ticketForm.title}
                      onChange={e => setTicketForm({ ...ticketForm, title: e.target.value })}
                      placeholder="Titre du ticket"
                      className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                    />
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Description *</span>
                    <textarea
                      rows={5} required
                      value={ticketForm.content}
                      onChange={e => setTicketForm({ ...ticketForm, content: e.target.value })}
                      placeholder="Description détaillée du problème..."
                      className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Priorité</span>
                      <select
                        value={ticketForm.priority}
                        onChange={e => setTicketForm({ ...ticketForm, priority: e.target.value })}
                        className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
                      >
                        <option value="P1">P1 — Critique</option>
                        <option value="P2">P2 — Haute</option>
                        <option value="P3">P3 — Moyenne</option>
                        <option value="P4">P4 — Basse</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Catégorie</span>
                      <input
                        value={ticketForm.category}
                        onChange={e => setTicketForm({ ...ticketForm, category: e.target.value })}
                        placeholder="ex: Réseau, Logiciel..."
                        className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                      />
                    </label>
                  </div>

                  {/* Info email source */}
                  <div className="p-3 rounded-xl bg-surface-container border border-outline-variant/30 text-[11px] text-on-surface-variant space-y-1">
                    <p><span className="font-bold text-on-surface">De :</span> {threadDetail?.latest?.fromEmail || 'Inconnu'}</p>
                    <p><span className="font-bold text-on-surface">Date :</span> {formatDateTime(threadDetail?.latest?.date)}</p>
                    {threadDetail?.latest?.erpTicketId && (
                      <p className="text-amber-500 font-bold">⚠️ Un ticket est déjà associé (#{threadDetail.latest.erpTicketId})</p>
                    )}
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-outline-variant/30 shrink-0">
                  <button onClick={() => setShowCreateTicket(false)} disabled={ticketSaving}
                    className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-semibold hover:bg-surface-container transition-all cursor-pointer">
                    Annuler
                  </button>
                  <button
                    onClick={async () => {
                      if (!ticketForm.title.trim() || !ticketForm.content.trim()) {
                        toast.error('Titre et description requis');
                        return;
                      }
                      setTicketSaving(true);
                      try {
                        const { data } = await api.post('/tickets', {
                          title: ticketForm.title.trim(),
                          content: ticketForm.content.trim(),
                          priority: ticketForm.priority,
                          category: ticketForm.category.trim() || null,
                          teamId: ticketForm.teamId ? Number(ticketForm.teamId) : null,
                          assignedToId: ticketForm.assignedToId ? Number(ticketForm.assignedToId) : null,
                          source: 'Email',
                          requesterEmail: threadDetail?.latest?.fromEmail || null,
                        });
                        toast.success(`Ticket #${data.id} créé avec succès`);
                        setShowCreateTicket(false);
                        load();
                        refreshSelection();
                      } catch (err) {
                        toast.error(err.response?.data?.error || 'Erreur lors de la création');
                      } finally {
                        setTicketSaving(false);
                      }
                    }}
                    disabled={ticketSaving || !ticketForm.title.trim() || !ticketForm.content.trim()}
                    className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-bold shadow-md shadow-emerald-500/20 transition-all hover:brightness-110 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {ticketSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    {ticketSaving ? 'Création...' : 'Créer le ticket'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ── Modal Créer un dossier ──────────────────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {showCreateFolder && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => !creatingFolder && setShowCreateFolder(false)}
                className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer" />
              <motion.form
                onSubmit={handleCreateFolder}
                initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 16 }}
                transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }}
                className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl max-w-sm w-full p-6 card-shadow flex flex-col gap-5 overflow-hidden max-h-[90vh]"
              >
                <div className="flex justify-between items-center pb-3 border-b border-outline-variant/30">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-sky-500/10">
                      <FolderPlus className="w-5 h-5 text-sky-500" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-on-surface">Créer un dossier</h3>
                      <p className="text-[10px] text-on-surface-variant">Classez vos emails par thème</p>
                    </div>
                  </div>
                  <motion.button type="button" onClick={() => setShowCreateFolder(false)} disabled={creatingFolder}
                    whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }}
                    className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer disabled:opacity-40">
                    <X className="w-4 h-4" />
                  </motion.button>
                </div>

                <div className="space-y-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Nom du dossier *</span>
                    <input
                      type="text"
                      autoFocus
                      required
                      maxLength={50}
                      placeholder="Ex: Projets clients"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-outline-variant/60 bg-surface-container text-on-surface text-sm placeholder-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500/60"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Couleur</span>
                    <div className="flex items-center gap-2">
                      {['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#6b7280'].map((c) => (
                        <button key={c} type="button"
                          onClick={() => setNewFolderColor(c)}
                          className={`w-7 h-7 rounded-full border-2 transition-all cursor-pointer ${newFolderColor === c ? 'border-on-surface scale-110' : 'border-transparent hover:scale-105'}`}
                          style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  </label>
                </div>

                <div className="pt-3 border-t border-outline-variant/30 flex justify-end gap-2">
                  <button type="button" onClick={() => setShowCreateFolder(false)} disabled={creatingFolder}
                    className="px-4 py-2.5 rounded-xl border border-outline-variant text-on-surface text-xs font-medium hover:bg-surface-container transition-colors cursor-pointer disabled:opacity-40">
                    Annuler
                  </button>
                  <button type="submit" disabled={creatingFolder || !newFolderName.trim()}
                    className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-500 text-white text-xs font-bold shadow-md shadow-sky-500/20 transition-all hover:brightness-110 cursor-pointer disabled:opacity-60">
                    {creatingFolder ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderPlus className="w-3.5 h-3.5" />}
                    {creatingFolder ? 'Création...' : 'Créer'}
                  </button>
                </div>
              </motion.form>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ── Menu contextuel clic droit ──────────────────────────────────────── */}
      {contextMenu && createPortal(
        <div
          className="fixed z-[99999]"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 220), top: Math.min(contextMenu.y, window.innerHeight - 300) }}
          onClick={(e) => e.stopPropagation()}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-surface-container-lowest border border-outline-variant/60 rounded-xl shadow-2xl py-1.5 w-56 overflow-hidden"
          >
            <div className="px-3 py-1.5 border-b border-outline-variant/20">
              <p className="text-[10px] font-bold text-on-surface truncate">{contextMenu.thread.latest?.subject || '(sans objet)'}</p>
              <p className="text-[9px] text-on-surface-variant/60 truncate">{contextMenu.thread.latest?.fromEmail}</p>
            </div>
            <button onClick={() => ctxMarkRead(contextMenu.thread.isUnread)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-on-surface hover:bg-surface-container transition-colors cursor-pointer">
              {contextMenu.thread.isUnread ? <MailOpen className="w-3.5 h-3.5" /> : <CircleDot className="w-3.5 h-3.5" />}
              {contextMenu.thread.isUnread ? 'Marquer comme lu' : 'Marquer comme non lu'}
            </button>
            <button onClick={ctxMoveToFolder}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-on-surface hover:bg-surface-container transition-colors cursor-pointer">
              <ArrowRight className="w-3.5 h-3.5" />
              Déplacer vers un dossier...
            </button>
            <div className="mx-3 border-t border-outline-variant/20" />
            <button onClick={ctxCreateRule}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-on-surface hover:bg-surface-container transition-colors cursor-pointer">
              <Filter className="w-3.5 h-3.5 text-violet-400" />
              <span>Créer une règle...</span>
            </button>
            <button onClick={ctxCreateTicket}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-on-surface hover:bg-surface-container transition-colors cursor-pointer">
              <FileText className="w-3.5 h-3.5 text-emerald-400" />
              Créer un ticket...
            </button>
            <div className="mx-3 border-t border-outline-variant/20" />
            <button onClick={ctxMarkSpam}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-amber-500 hover:bg-amber-500/10 transition-colors cursor-pointer">
              <Ban className="w-3.5 h-3.5" />
              Marquer comme spam
            </button>
            <button onClick={ctxDelete}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer">
              <Trash2 className="w-3.5 h-3.5" />
              Supprimer
            </button>
          </motion.div>
        </div>,
        document.body
      )}

      {/* ── Modal Créer une règle depuis un email ───────────────────────────── */}
      {showCreateRuleFromEmail && ruleFromEmail && createPortal(
        <CreateRuleFromEmailModal
          email={ruleFromEmail}
          folders={customFolders}
          onClose={() => { setShowCreateRuleFromEmail(false); setRuleFromEmail(null); }}
        />
      ), document.body}

      {/* ── Modal Déplacer vers dossier ──────────────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {showMoveModal && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setShowMoveModal(false)}
                className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer" />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 16 }}
                transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }}
                className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl max-w-sm w-full p-6 card-shadow flex flex-col gap-3 overflow-hidden max-h-[90vh]"
              >
                <div className="flex justify-between items-center pb-3 border-b border-outline-variant/30">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-sky-500/10">
                      <ArrowRight className="w-5 h-5 text-sky-500" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-on-surface">Déplacer {selectedIds.length} email(s)</h3>
                      <p className="text-[10px] text-on-surface-variant">Choisissez le dossier de destination</p>
                    </div>
                  </div>
                  <motion.button onClick={() => setShowMoveModal(false)} whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }}
                    className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer">
                    <X className="w-4 h-4" />
                  </motion.button>
                </div>

                <div className="space-y-1 max-h-60 overflow-y-auto overscroll-contain">
                  {/* Inbox */}
                  <button onClick={() => handleMoveToFolder(null)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-all cursor-pointer">
                    <InboxIcon className="w-4 h-4" />
                    <span>Boîte de réception</span>
                  </button>
                  {customFolders.map((f) => (
                    <button key={f.id} onClick={() => handleMoveToFolder(f.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-all cursor-pointer">
                      <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: f.color || '#6b7280' }} />
                      <span className="flex-1 text-left truncate">{f.name}</span>
                      <span className="text-[9px] text-on-surface-variant/60">{f.emailCount || 0}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ── Modal Gestion des règles ─────────────────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {showRulesModal && (
            <InboxRulesModal onClose={() => setShowRulesModal(false)} />
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}

// ── Petits composants d'affichage ────────────────────────────────────────────
function PriorityBadge({ p }) {
  const cfg = PRIORITY_CONFIG[p];
  if (!cfg) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border" style={{ color: cfg.stripe, borderColor: `${cfg.stripe}44`, backgroundColor: `${cfg.stripe}11` }}>
      <cfg.icon className="w-2.5 h-2.5" />
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status];
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
      <cfg.icon className="w-2.5 h-2.5" />
      {cfg.label}
    </span>
  );
}

// ── Modal Gestion des Règles de tri ──────────────────────────────────────────
function InboxRulesModal({ onClose }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testLoading, setTestLoading] = useState(null);
  const [form, setForm] = useState({
    label: '',
    conditions: [{ field: 'subject', operator: 'contains', value: '' }],
    conditionOperator: 'AND',
    action: 'move_to_folder',
    actionConfig: { folderId: null, category: '' },
  });
  const [folders, setFolders] = useState([]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/inbox/rules').catch(() => ({ data: [] })),
      api.get('/inbox/folders').catch(() => ({ data: [] })),
    ]).then(([rulesRes, foldersRes]) => {
      setRules(rulesRes.data || []);
      setFolders(foldersRes.data || []);
    }).finally(() => setLoading(false));
  }, []);

  function resetForm() {
    setForm({
      label: '',
      conditions: [{ field: 'subject', operator: 'contains', value: '' }],
      conditionOperator: 'AND',
      action: 'move_to_folder',
      actionConfig: { folderId: null, category: '' },
    });
    setEditingRule(null);
    setShowForm(false);
    setTestResult(null);
  }

  function startEdit(rule) {
    setForm({
      label: rule.label,
      conditions: Array.isArray(rule.conditions) ? rule.conditions : [],
      conditionOperator: rule.conditionOperator || 'AND',
      action: rule.action,
      actionConfig: rule.actionConfig || {},
    });
    setEditingRule(rule);
    setShowForm(true);
  }

  function addCondition() {
    setForm((f) => ({ ...f, conditions: [...f.conditions, { field: 'subject', operator: 'contains', value: '' }] }));
  }

  function updateCondition(index, key, value) {
    setForm((f) => {
      const conditions = [...f.conditions];
      conditions[index] = { ...conditions[index], [key]: value };
      return { ...f, conditions };
    });
  }

  function removeCondition(index) {
    setForm((f) => ({ ...f, conditions: f.conditions.filter((_, i) => i !== index) }));
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.label.trim() || form.conditions.length === 0 || form.conditions.some((c) => !c.value.trim())) {
      toast.error('Remplissez le libellé et toutes les conditions');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, actionConfig: { ...form.actionConfig } };
      if (form.action === 'move_to_folder') payload.actionConfig.folderId = Number(form.actionConfig.folderId) || null;
      if (editingRule) {
        await api.patch(`/inbox/rules/${editingRule.id}`, payload);
      } else {
        await api.post('/inbox/rules', payload);
      }
      const { data } = await api.get('/inbox/rules');
      setRules(data);
      resetForm();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Supprimer cette règle ?')) return;
    try {
      await api.delete(`/inbox/rules/${id}`);
      setRules((r) => r.filter((x) => x.id !== id));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
  }

  async function handleToggle(id) {
    try {
      const { data } = await api.patch(`/inbox/rules/${id}/toggle`);
      setRules((rs) => rs.map((r) => (r.id === id ? data : r)));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
  }

  async function handleTest(id) {
    setTestLoading(id);
    setTestResult(null);
    try {
      const { data } = await api.post(`/inbox/rules/${id}/test`);
      setTestResult({ id, count: data.matchCount });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors du test');
    } finally {
      setTestLoading(null);
    }
  }

  async function handleApply(id) {
    if (!confirm('Appliquer cette règle sur tous les emails existants ?')) return;
    try {
      const { data } = await api.post(`/inbox/rules/${id}/apply`);
      toast.success(`${data.applied} email(s) déplacé(s) sur ${data.total} analysés`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de l\'application');
    }
  }

  const FIELD_OPTIONS = [
    { value: 'subject', label: 'Sujet' },
    { value: 'fromEmail', label: 'Email expéditeur' },
    { value: 'fromName', label: 'Nom expéditeur' },
    { value: 'bodyPreview', label: 'Contenu' },
    { value: 'aiCategory', label: 'Catégorie IA' },
    { value: 'aiPriority', label: 'Priorité IA' },
    { value: 'aiTeam', label: 'Équipe IA' },
  ];
  const OP_OPTIONS = [
    { value: 'contains', label: 'contient' },
    { value: 'not_contains', label: 'ne contient pas' },
    { value: 'equals', label: 'égal à' },
    { value: 'starts_with', label: 'commence par' },
    { value: 'ends_with', label: 'finit par' },
  ];

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={() => !saving && onClose()}
        className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer" />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }}
        className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-outline-variant/30 shrink-0">
          <div className="p-1.5 rounded-lg bg-violet-500/10"><Filter className="w-4 h-4 text-violet-500" /></div>
          <div>
            <h3 className="text-sm font-bold text-on-surface">Règles de tri automatique</h3>
            <p className="text-[10px] text-on-surface-variant">Classez automatiquement vos emails selon des conditions</p>
          </div>
          <motion.button onClick={onClose} whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }}
            className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer">
            <X className="w-4 h-4" />
          </motion.button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain p-5 space-y-4">
          {loading ? (
            <div className="space-y-3">{[1,2,3].map((i) => <div key={i} className="h-16 rounded-xl bg-surface-container animate-pulse" />)}</div>
          ) : (
            <>
              {rules.map((rule) => (
                <div key={rule.id} className={`rounded-xl border p-3 transition-all ${rule.isEnabled ? 'border-violet-500/30 bg-violet-500/5' : 'border-outline-variant/30 bg-surface-container-lowest opacity-60'}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-on-surface truncate">{rule.label}</span>
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-surface-container-high text-on-surface-variant">
                          {rule.action === 'move_to_folder' ? '→ Déplacer' : rule.action === 'mark_read' ? '✓ Lu' : rule.action === 'mark_spam' ? '⚠ Spam' : '🏷 Catégorie'}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {Array.isArray(rule.conditions) && rule.conditions.map((c, i) => (
                          <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-container-high text-[9px] text-on-surface-variant">
                            {FIELD_OPTIONS.find((f) => f.value === c.field)?.label || c.field} {OP_OPTIONS.find((o) => o.value === c.operator)?.label || c.operator} "{c.value}"
                          </span>
                        ))}
                      </div>
                      {testResult && testResult.id === rule.id && (
                        <p className="mt-1 text-[10px] text-sky-500 font-medium">{testResult.count} email(s) correspondent</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => handleTest(rule.id)} disabled={testLoading === rule.id}
                        className="p-1.5 rounded-lg text-on-surface-variant hover:text-sky-400 hover:bg-sky-500/10 transition-all cursor-pointer disabled:opacity-50"
                        title="Tester (compter les matchs)">
                        {testLoading === rule.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => handleApply(rule.id)}
                        className="p-1.5 rounded-lg text-on-surface-variant hover:text-emerald-400 hover:bg-emerald-500/10 transition-all cursor-pointer"
                        title="Appliquer sur tous les emails existants">
                        <Play className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleToggle(rule.id)}
                        className={`p-1.5 rounded-lg transition-all cursor-pointer ${rule.isEnabled ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-on-surface-variant/40 hover:bg-surface-container'}`}
                        title={rule.isEnabled ? 'Désactiver' : 'Activer'}>
                        <div className={`w-3.5 h-3.5 rounded-full border-2 ${rule.isEnabled ? 'bg-emerald-400 border-emerald-400' : 'border-on-surface-variant/40'}`} />
                      </button>
                      <button onClick={() => startEdit(rule)}
                        className="p-1.5 rounded-lg text-on-surface-variant hover:text-sky-400 hover:bg-sky-500/10 transition-all cursor-pointer"
                        title="Modifier">
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(rule.id)}
                        className="p-1.5 rounded-lg text-on-surface-variant hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                        title="Supprimer">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {rules.length === 0 && !showForm && (
                <div className="text-center py-8 text-on-surface-variant/50 text-xs">
                  <Filter className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>Aucune règle configurée</p>
                  <p className="text-[10px] mt-1">Créez une règle pour trier vos emails automatiquement</p>
                </div>
              )}

              {showForm && (
                <form onSubmit={handleSave} className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 space-y-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Settings className="w-4 h-4 text-violet-500" />
                    <span className="text-xs font-bold text-on-surface">{editingRule ? 'Modifier la règle' : 'Nouvelle règle'}</span>
                    <button type="button" onClick={resetForm} className="ml-auto text-[10px] text-on-surface-variant hover:text-on-surface cursor-pointer">Annuler</button>
                  </div>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Libellé *</span>
                    <input type="text" required maxLength={100} placeholder="Ex: Spam promotionnel"
                      value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-outline-variant/60 bg-surface-container text-on-surface text-xs" />
                  </label>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Conditions</span>
                      <select value={form.conditionOperator} onChange={(e) => setForm((f) => ({ ...f, conditionOperator: e.target.value }))}
                        className="px-2 py-1 rounded-lg border border-outline-variant/40 bg-surface-container text-[10px] text-on-surface-variant cursor-pointer">
                        <option value="AND">ET (toutes)</option>
                        <option value="OR">OU (au moins une)</option>
                      </select>
                      <button type="button" onClick={addCondition}
                        className="p-1 rounded text-on-surface-variant/60 hover:text-sky-400 transition-colors cursor-pointer">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {form.conditions.map((c, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <select value={c.field} onChange={(e) => updateCondition(i, 'field', e.target.value)}
                          className="flex-1 px-2 py-1.5 rounded-lg border border-outline-variant/40 bg-surface-container text-[10px] text-on-surface cursor-pointer">
                          {FIELD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <select value={c.operator} onChange={(e) => updateCondition(i, 'operator', e.target.value)}
                          className="w-28 px-2 py-1.5 rounded-lg border border-outline-variant/40 bg-surface-container text-[10px] text-on-surface cursor-pointer">
                          {OP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <input type="text" required placeholder="Valeur"
                          value={c.value} onChange={(e) => updateCondition(i, 'value', e.target.value)}
                          className="flex-1 px-2 py-1.5 rounded-lg border border-outline-variant/40 bg-surface-container text-[10px] text-on-surface" />
                        {form.conditions.length > 1 && (
                          <button type="button" onClick={() => removeCondition(i)}
                            className="p-1 text-on-surface-variant/40 hover:text-red-400 cursor-pointer">
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex items-end gap-3">
                    <label className="flex flex-col gap-1.5 flex-1">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Action</span>
                      <select value={form.action} onChange={(e) => setForm((f) => ({ ...f, action: e.target.value, actionConfig: {} }))}
                        className="px-2 py-2 rounded-lg border border-outline-variant/40 bg-surface-container text-xs text-on-surface cursor-pointer">
                        <option value="move_to_folder">Déplacer vers un dossier</option>
                        <option value="mark_read">Marquer comme lu</option>
                        <option value="mark_spam">Marquer comme spam</option>
                        <option value="mark_category">Appliquer une catégorie</option>
                      </select>
                    </label>
                    {form.action === 'move_to_folder' && (
                      <label className="flex flex-col gap-1.5 flex-1">
                        <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Dossier</span>
                        <select value={form.actionConfig.folderId || ''} onChange={(e) => setForm((f) => ({ ...f, actionConfig: { ...f.actionConfig, folderId: e.target.value } }))}
                          className="px-2 py-2 rounded-lg border border-outline-variant/40 bg-surface-container text-xs text-on-surface cursor-pointer">
                          <option value="">— Choisir —</option>
                          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      </label>
                    )}
                    {form.action === 'mark_category' && (
                      <label className="flex flex-col gap-1.5 flex-1">
                        <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Catégorie</span>
                        <input type="text" placeholder="Ex: COMMERCIAL"
                          value={form.actionConfig.category || ''}
                          onChange={(e) => setForm((f) => ({ ...f, actionConfig: { ...f.actionConfig, category: e.target.value } }))}
                          className="px-2 py-2 rounded-lg border border-outline-variant/40 bg-surface-container text-xs text-on-surface" />
                      </label>
                    )}
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t border-outline-variant/20">
                    <button type="button" onClick={resetForm} disabled={saving}
                      className="px-4 py-2 rounded-xl border border-outline-variant text-on-surface text-xs font-medium hover:bg-surface-container transition-colors cursor-pointer disabled:opacity-40">
                      Annuler
                    </button>
                    <button type="submit" disabled={saving}
                      className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 text-white text-xs font-bold shadow-md shadow-violet-500/20 transition-all hover:brightness-110 cursor-pointer disabled:opacity-60">
                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Filter className="w-3.5 h-3.5" />}
                      {saving ? 'Sauvegarde...' : editingRule ? 'Modifier' : 'Créer'}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>

        {!showForm && (
          <div className="px-5 py-3 border-t border-outline-variant/30 flex justify-end shrink-0">
            <button onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 text-white text-xs font-bold shadow-md shadow-violet-500/20 transition-all hover:brightness-110 cursor-pointer">
              <Plus className="w-3.5 h-3.5" />
              Nouvelle règle
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ── Modal Créer une règle depuis un email (clic droit) ────────────────────────
function CreateRuleFromEmailModal({ email, folders, onClose }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    label: `Messages de ${email.fromEmail}`,
    conditions: [
      { field: 'fromEmail', operator: 'contains', value: email.fromEmail || '' },
    ],
    conditionOperator: 'AND',
    action: 'move_to_folder',
    actionConfig: { folderId: '', category: '' },
  });

  const FIELD_OPTIONS = [
    { value: 'fromEmail', label: 'Email expéditeur' },
    { value: 'fromName', label: 'Nom expéditeur' },
    { value: 'subject', label: 'Sujet' },
    { value: 'bodyPreview', label: 'Contenu' },
    { value: 'aiCategory', label: 'Catégorie IA' },
  ];
  const OP_OPTIONS = [
    { value: 'contains', label: 'contient' },
    { value: 'not_contains', label: 'ne contient pas' },
    { value: 'equals', label: 'égal à' },
    { value: 'starts_with', label: 'commence par' },
    { value: 'ends_with', label: 'finit par' },
  ];

  function addCondition() {
    setForm((f) => ({ ...f, conditions: [...f.conditions, { field: 'subject', operator: 'contains', value: '' }] }));
  }

  function updateCondition(index, key, value) {
    setForm((f) => {
      const conditions = [...f.conditions];
      conditions[index] = { ...conditions[index], [key]: value };
      return { ...f, conditions };
    });
  }

  function removeCondition(index) {
    setForm((f) => ({ ...f, conditions: f.conditions.filter((_, i) => i !== index) }));
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.label.trim() || form.conditions.some((c) => !c.value.trim())) {
      toast.error('Remplissez le libellé et toutes les conditions');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, actionConfig: { ...form.actionConfig } };
      if (form.action === 'move_to_folder') payload.actionConfig.folderId = Number(form.actionConfig.folderId) || null;
      await api.post('/inbox/rules', payload);
      toast.success('Règle créée');
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={() => !saving && onClose()}
        className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer" />
      <motion.form
        onSubmit={handleSave}
        initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }}
        className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl max-w-lg w-full p-6 card-shadow flex flex-col gap-4 overflow-hidden max-h-[85vh]"
      >
        <div className="flex justify-between items-center pb-3 border-b border-outline-variant/30">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-violet-500/10"><Filter className="w-5 h-5 text-violet-500" /></div>
            <div>
              <h3 className="text-sm font-bold text-on-surface">Créer une règle depuis cet email</h3>
              <p className="text-[10px] text-on-surface-variant">De : {email.fromEmail}</p>
            </div>
          </div>
          <motion.button type="button" onClick={onClose} disabled={saving}
            whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }}
            className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer disabled:opacity-40">
            <X className="w-4 h-4" />
          </motion.button>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Libellé *</span>
          <input type="text" required maxLength={100} value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-outline-variant/60 bg-surface-container text-on-surface text-xs" />
        </label>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Conditions</span>
            <select value={form.conditionOperator} onChange={(e) => setForm((f) => ({ ...f, conditionOperator: e.target.value }))}
              className="px-2 py-1 rounded-lg border border-outline-variant/40 bg-surface-container text-[10px] text-on-surface-variant cursor-pointer">
              <option value="AND">ET (toutes)</option>
              <option value="OR">OU (au moins une)</option>
            </select>
            <button type="button" onClick={addCondition}
              className="p-1 rounded text-on-surface-variant/60 hover:text-sky-400 transition-colors cursor-pointer">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          {form.conditions.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <select value={c.field} onChange={(e) => updateCondition(i, 'field', e.target.value)}
                className="flex-1 px-2 py-1.5 rounded-lg border border-outline-variant/40 bg-surface-container text-[10px] text-on-surface cursor-pointer">
                {FIELD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select value={c.operator} onChange={(e) => updateCondition(i, 'operator', e.target.value)}
                className="w-28 px-2 py-1.5 rounded-lg border border-outline-variant/40 bg-surface-container text-[10px] text-on-surface cursor-pointer">
                {OP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <input type="text" required placeholder="Valeur" value={c.value}
                onChange={(e) => updateCondition(i, 'value', e.target.value)}
                className="flex-1 px-2 py-1.5 rounded-lg border border-outline-variant/40 bg-surface-container text-[10px] text-on-surface" />
              {form.conditions.length > 1 && (
                <button type="button" onClick={() => removeCondition(i)}
                  className="p-1 text-on-surface-variant/40 hover:text-red-400 cursor-pointer">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-end gap-3">
          <label className="flex flex-col gap-1.5 flex-1">
            <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Action</span>
            <select value={form.action} onChange={(e) => setForm((f) => ({ ...f, action: e.target.value, actionConfig: {} }))}
              className="px-2 py-2 rounded-lg border border-outline-variant/40 bg-surface-container text-xs text-on-surface cursor-pointer">
              <option value="move_to_folder">Déplacer vers un dossier</option>
              <option value="mark_read">Marquer comme lu</option>
              <option value="mark_spam">Marquer comme spam</option>
              <option value="mark_category">Appliquer une catégorie</option>
            </select>
          </label>
          {form.action === 'move_to_folder' && (
            <label className="flex flex-col gap-1.5 flex-1">
              <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Dossier</span>
              <select value={form.actionConfig.folderId || ''} onChange={(e) => setForm((f) => ({ ...f, actionConfig: { ...f.actionConfig, folderId: e.target.value } }))}
                className="px-2 py-2 rounded-lg border border-outline-variant/40 bg-surface-container text-xs text-on-surface cursor-pointer">
                <option value="">— Choisir —</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
          )}
          {form.action === 'mark_category' && (
            <label className="flex flex-col gap-1.5 flex-1">
              <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Catégorie</span>
              <input type="text" placeholder="Ex: COMMERCIAL"
                value={form.actionConfig.category || ''}
                onChange={(e) => setForm((f) => ({ ...f, actionConfig: { ...f.actionConfig, category: e.target.value } }))}
                className="px-2 py-2 rounded-lg border border-outline-variant/40 bg-surface-container text-xs text-on-surface" />
            </label>
          )}
        </div>

        <div className="pt-3 border-t border-outline-variant/30 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving}
            className="px-4 py-2.5 rounded-xl border border-outline-variant text-on-surface text-xs font-medium hover:bg-surface-container transition-colors cursor-pointer disabled:opacity-40">
            Annuler
          </button>
          <button type="submit" disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 text-white text-xs font-bold shadow-md shadow-violet-500/20 transition-all hover:brightness-110 cursor-pointer disabled:opacity-60">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Filter className="w-3.5 h-3.5" />}
            {saving ? 'Création...' : 'Créer la règle'}
          </button>
        </div>
      </motion.form>
    </div>
  );
}
