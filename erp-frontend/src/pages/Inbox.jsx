import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import { useSocket } from '../context/SocketContext';
import DOMPurify from 'dompurify';
import {
  Mail, MailOpen, RefreshCw, Sparkles, AlertTriangle, Flame,
  CheckCircle2, XCircle, Ban, Clock, ChevronRight, ExternalLink,
  Search, X, FlaskConical, Bot, Inbox as InboxIcon, ArrowUpRight,
  Reply, Paperclip, Users
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
  SPAM:    { label: 'Spam',       icon: Ban,          color: 'text-zinc-400',   bg: 'bg-zinc-500/10',   border: 'border-zinc-500/20'   },
};

const PRIORITY_CONFIG = {
  P1: { label: 'P1 Critique', icon: Flame,         color: 'text-red-400',    bg: 'bg-red-500',    stripe: '#ef4444' },
  P2: { label: 'P2 Haute',   icon: AlertTriangle,  color: 'text-orange-400', bg: 'bg-orange-500', stripe: '#f97316' },
  P3: { label: 'P3 Moyenne', icon: ChevronRight,   color: 'text-amber-400',  bg: 'bg-amber-500',  stripe: '#f59e0b' },
  P4: { label: 'P4 Basse',   icon: ChevronRight,   color: 'text-blue-400',   bg: 'bg-blue-500',   stripe: '#3b82f6' },
};

const FILTERS = ['Tous', 'PENDING', 'DONE', 'ERROR', 'SPAM'];

const AVATAR_COLORS = ['bg-sky-600', 'bg-indigo-600', 'bg-emerald-600', 'bg-violet-600', 'bg-rose-600'];

function initialOf(name, email) {
  return ((name || email) || '?').charAt(0).toUpperCase();
}

function participantsLabel(participants) {
  if (!participants || participants.length === 0) return 'Inconnu';
  const names = participants.slice(0, 2).map((p) => p.name || p.email);
  if (participants.length > 2) return `${names.join(', ')} +${participants.length - 2}`;
  return names.join(', ');
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function formatDateTime(d) {
  return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function Inbox() {
  const { user } = useAuth();
  const canSync = hasPermission(user, 'inbox.sync');
  const [threads, setThreads] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('Tous');
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [selectedThread, setSelectedThread] = useState(null);
  const [threadDetail, setThreadDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testForm, setTestForm] = useState({ subject: '', body: '', from: '', fromName: '' });
  const [testResult, setTestResult] = useState(null);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testError, setTestError] = useState('');
  const [search, setSearch] = useState('');
  const [newCount, setNewCount] = useState(0);
  const navigate = useNavigate();
  const socket = useSocket();

  const stateRef = useRef({ page, filter, search });
  useEffect(() => { stateRef.current = { page, filter, search }; }, [page, filter, search]);

  const load = useCallback((p, f, q) => {
    const params = new URLSearchParams({ page: p, limit: 25 });
    if (f && f !== 'Tous') params.set('status', f);
    if (q && q.trim()) params.set('q', q.trim());
    api.get(`/inbox?${params}`)
      .then(({ data }) => { setThreads(data.items); setTotal(data.total); })
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
  }, []);

  // Recharge le fil sélectionné (après un event socket) si besoin
  const refreshSelection = useCallback(() => {
    if (!selectedThread) return;
    api.get(`/inbox/thread?key=${encodeURIComponent(selectedThread.id)}`)
      .then(({ data }) => setThreadDetail(data))
      .catch(() => {});
  }, [selectedThread]);

  function openThread(thread) {
    setSelectedThread(thread);
    setDetailLoading(true);
    api.get(`/inbox/thread?key=${encodeURIComponent(thread.id)}`)
      .then(({ data }) => setThreadDetail(data))
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

  // À quelle clé de fil appartient un email (pour rafraîchir la sélection après un event)
  function keyOfEmail(email) {
    return email.conversationId || `single-${email.id}`;
  }

  useEffect(() => {
    const t = setTimeout(() => { load(1, filter, search); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [filter, search, load]);

  useEffect(() => {
    const id = setInterval(() => {
      const { page: p, filter: f, search: s } = stateRef.current;
      if (p === 1) load(1, f, s);
    }, 15000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!socket) return;
    const onReceived = (email) => {
      const { page: p, filter: f, search: s } = stateRef.current;
      if (p === 1) load(1, f, s);
      setNewCount(c => c + 1);
      toast.info('Nouveau mail reçu', { description: `Sujet : ${email.subject}` });
      if (selectedThread && email.conversationId === selectedThread.conversationId) refreshSelection();
    };
    const onUpdated = (email) => {
      const { page: p, filter: f, search: s } = stateRef.current;
      if (p === 1) load(1, f, s);
      if (selectedThread && (keyOfEmail(email) === selectedThread.id)) refreshSelection();
    };
    socket.on('email_received', onReceived);
    socket.on('email_updated', onUpdated);
    return () => { socket.off('email_received', onReceived); socket.off('email_updated', onUpdated); };
  }, [socket, load, selectedThread, refreshSelection]);

  async function handleSync() {
    setSyncing(true); setError(''); setNewCount(0);
    try {
      const { data } = await api.post('/inbox/sync');
      load(1, filter, search);
      toast.success('Synchronisation terminée', { description: `${data.processed} email(s) traité(s) par l'agent IA.` });
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du sync');
    } finally { setSyncing(false); }
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

  // Counts per status for filter tabs
  const pendingCount = threads.filter(t => t.latest?.status === 'PENDING').length;

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] max-h-[calc(100vh-64px)] overflow-hidden">
      {/* ── Top Bar ─────────────────────────────────────────────────────── */}
      <div className="relative shrink-0 border-b border-outline-variant/30 bg-surface-container-lowest px-4 sm:px-6 py-3 flex items-center gap-4">
        {/* Title */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-1.5 bg-sky-500/10 rounded-lg">
            <InboxIcon className="w-5 h-5 text-sky-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-on-surface truncate flex items-center gap-2">
              Boîte mail
              {newCount > 0 && (
                <motion.span
                  initial={{ scale: 0 }} animate={{ scale: 1 }}
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-sky-500 text-white text-[9px] font-black"
                >
                  {newCount}
                </motion.span>
              )}
            </h1>
            <p className="text-[11px] text-on-surface-variant">{total} conversation{total !== 1 ? 's' : ''} — triées par l'IA</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-xs hidden sm:block">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/60" />
          <input
            type="text"
            placeholder="Rechercher..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-surface border border-outline-variant/40 rounded-xl pl-9 pr-8 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50 hover:text-on-surface">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-1 hidden md:flex">
          {FILTERS.map(f => {
            const cfg = STATUS_CONFIG[f];
            const Icon = cfg?.icon;
            const isActive = filter === f;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all ${
                  isActive
                    ? (f === 'Tous' ? 'bg-sky-500/10 text-sky-400 border-sky-500/30' : `${cfg.bg} ${cfg.color} ${cfg.border}`)
                    : 'bg-transparent text-on-surface-variant border-outline-variant/30 hover:bg-surface-container-low'
                }`}
              >
                {Icon && <Icon className="w-3 h-3" />}
                {f === 'Tous' ? `Tous` : STATUS_LABELS[f]}
              </button>
            );
          })}
        </div>

        {/* Actions */}
        {canSync && (
          <div className="flex items-center gap-2 ml-auto shrink-0">
            <motion.button
              onClick={openTestModal}
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant/50 bg-surface-container text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high text-xs font-semibold transition-all"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Test IA</span>
            </motion.button>
            <motion.button
              onClick={handleSync}
              disabled={syncing}
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-blue-500 text-white text-xs font-bold shadow-md shadow-sky-500/20 transition-all hover:brightness-110 disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{syncing ? 'Syncing...' : 'Sync'}</span>
            </motion.button>
          </div>
        )}
      </div>

      {/* ── Error banner ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="shrink-0 overflow-hidden"
          >
            <div className="px-4 py-2 bg-red-500/5 border-b border-red-500/20 text-red-400 text-xs flex items-center gap-2">
              <XCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
              <button onClick={() => setError('')} className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"><X className="w-4 h-4" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main Split Pane ───────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left: Conversation list */}
        <div className={`flex flex-col border-r border-outline-variant/30 bg-surface-container-lowest overflow-hidden transition-all duration-300 ${
          selectedThread ? 'w-80 xl:w-96 shrink-0' : 'flex-1'
        }`}>
          {/* List header */}
          <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-outline-variant/20 bg-surface-bright/20">
            <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">
              {total} conversation{total !== 1 ? 's' : ''}
            </span>
            {pendingCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 text-[10px] font-bold border border-yellow-500/20">
                <Clock className="w-2.5 h-2.5" />
                {pendingCount} en attente
              </span>
            )}
          </div>

          {/* Scrollable list */}
          <div className="flex-1 overflow-y-auto">
            {threads.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-on-surface-variant">
                <Mail className="w-10 h-10 text-outline/30" />
                <p className="text-sm italic">Aucune conversation trouvée.</p>
                {canSync && (
                  <button onClick={handleSync} className="text-xs text-sky-400 underline underline-offset-2">
                    Synchroniser maintenant
                  </button>
                )}
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                {threads.map((thread, idx) => {
                  const latest = thread.latest || {};
                  const pCfg = PRIORITY_CONFIG[latest.aiPriority];
                  const sCfg = STATUS_CONFIG[latest.status];
                  const SIcon = sCfg?.icon;
                  const isSelected = selectedThread?.id === thread.id;
                  const label = participantsLabel(thread.participants);
                  const snippet = latest.aiSummary || latest.bodyPreview;

                  return (
                    <motion.button
                      key={thread.id}
                      layout
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.15, delay: idx * 0.008 }}
                      onClick={() => openThread(thread)}
                      className={`w-full text-left flex items-stretch gap-0 border-b border-outline-variant/15 transition-all group ${
                        isSelected
                          ? 'bg-sky-500/5 ring-1 ring-inset ring-sky-500/20'
                          : 'hover:bg-surface-container-low/60'
                      }`}
                    >
                      {/* Priority stripe */}
                      <div
                        className="w-0.5 shrink-0 rounded-r"
                        style={{ background: pCfg ? pCfg.stripe : 'transparent' }}
                      />

                      <div className="flex items-center gap-3 px-4 py-3.5 flex-1 min-w-0">
                        {/* Participant avatars */}
                        <div className="flex -space-x-2 shrink-0">
                          {(thread.participants || []).slice(0, 2).map((p, i) => (
                            <div
                              key={`${p.email}-${i}`}
                              className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white ring-2 ring-surface-container-lowest ${
                                i === 0 ? (pCfg ? pCfg.bg : 'bg-zinc-600') : AVATAR_COLORS[1]
                              }`}
                            >
                              {initialOf(p.name, p.email)}
                            </div>
                          ))}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className={`text-xs font-bold truncate ${isSelected ? 'text-sky-400' : 'text-on-surface group-hover:text-primary transition-colors'}`}>
                              {label}
                            </span>
                            {latest.aiSummary && (
                              <Bot className="w-2.5 h-2.5 text-purple-400 shrink-0" />
                            )}
                            {thread.sentCount > 0 && (
                              <Reply className="w-2.5 h-2.5 text-on-surface-variant/60 shrink-0" />
                            )}
                          </div>
                          <p className="text-[11px] font-semibold text-on-surface truncate mb-0.5">{latest.subject}</p>
                          {snippet && (
                            <p className={`text-[10px] truncate ${latest.aiSummary ? 'text-on-surface-variant italic' : 'text-on-surface-variant/70'}`}>
                              {snippet}
                            </p>
                          )}
                        </div>

                        {/* Right meta */}
                        <div className="shrink-0 flex flex-col items-end gap-1">
                          <span className="text-[10px] text-on-surface-variant whitespace-nowrap flex items-center gap-1">
                            {latest.hasAttachments && <Paperclip className="w-2.5 h-2.5" />}
                            {formatDate(latest.receivedAt || latest.date)}
                          </span>
                          <div className="flex items-center gap-1">
                            {thread.count > 1 && (
                              <span className="inline-flex items-center justify-center min-w-[1rem] px-1 py-0.5 rounded-full bg-sky-500/10 text-sky-400 text-[9px] font-bold border border-sky-500/20">
                                {thread.count}
                              </span>
                            )}
                            {sCfg && (
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${sCfg.bg} ${sCfg.color} ${sCfg.border}`}>
                                <SIcon className="w-2 h-2" />
                                {sCfg.label}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            )}
          </div>

          {/* Pagination */}
          {total > 25 && (
            <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-t border-outline-variant/20 bg-surface-bright/10">
              <button
                disabled={page === 1}
                onClick={() => { const p = page - 1; setPage(p); load(p, filter, search); }}
                className="text-[11px] font-semibold text-on-surface-variant disabled:opacity-30 hover:text-on-surface transition-colors px-2 py-1 rounded-lg hover:bg-surface-container"
              >← Préc.</button>
              <span className="text-[11px] text-on-surface-variant">{page} / {Math.ceil(total / 25)}</span>
              <button
                disabled={page * 25 >= total}
                onClick={() => { const p = page + 1; setPage(p); load(p, filter, search); }}
                className="text-[11px] font-semibold text-on-surface-variant disabled:opacity-30 hover:text-on-surface transition-colors px-2 py-1 rounded-lg hover:bg-surface-container"
              >Suiv. →</button>
            </div>
          )}
        </div>

        {/* Right: Conversation thread view */}
        <AnimatePresence mode="wait">
          {selectedThread ? (
            <motion.div
              key={selectedThread.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="flex-1 flex flex-col min-h-0 overflow-hidden bg-surface-container-lowest"
            >
              {/* Thread top bar */}
              <div className="shrink-0 flex items-center gap-3 px-6 py-4 border-b border-outline-variant/20">
                <motion.button
                  onClick={closeThread}
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"
                >
                  <X className="w-4 h-4" />
                </motion.button>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-bold text-on-surface truncate">{selectedThread.latest?.subject}</h2>
                  <p className="text-[11px] text-on-surface-variant truncate">
                    {participantsLabel(selectedThread.participants)}
                    {' · '}
                    {selectedThread.count} message{selectedThread.count !== 1 ? 's' : ''}
                    {selectedThread.sentCount > 0 && ` · ${selectedThread.sentCount} envoyé${selectedThread.sentCount !== 1 ? 's' : ''}`}
                  </p>
                </div>
                {selectedThread.latest?.erpTicketId && (
                  <motion.button
                    whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                    onClick={() => navigate(`/tickets/${selectedThread.latest.erpTicketId}`)}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary/10 text-primary border border-primary/20 text-xs font-bold hover:bg-primary/15 transition-all"
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    Ticket #{selectedThread.latest.erpTicketId}
                  </motion.button>
                )}
              </div>

              {/* Thread body */}
              <div className="flex-1 overflow-y-auto">
                {detailLoading && !threadDetail ? (
                  <div className="h-full flex items-center justify-center text-on-surface-variant">
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  </div>
                ) : (
                  <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
                    {(threadDetail?.messages || []).map((msg) => {
                      const isInbound = msg.kind === 'inbound';
                      const sCfg = STATUS_CONFIG[msg.status];
                      const pCfg = PRIORITY_CONFIG[msg.aiPriority];
                      return (
                        <div key={`${msg.kind}-${msg.emailId || msg.messageId}`} className="space-y-4">
                          {/* Message header */}
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
                                {sCfg && isInbound && (
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border ${sCfg.bg} ${sCfg.color} ${sCfg.border}`}>
                                    <sCfg.icon className="w-2.5 h-2.5" />
                                    {sCfg.label}
                                  </span>
                                )}
                                {pCfg && isInbound && (
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border ${pCfg.color} border-current bg-current/10`}>
                                    <pCfg.icon className="w-2.5 h-2.5" />
                                    {pCfg.label}
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-on-surface-variant mt-0.5">{formatDateTime(msg.receivedAt || msg.timestamp)}</p>
                            </div>
                          </div>

                          {/* AI Analysis (inbound only) */}
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
                                      <p className="text-sm font-semibold text-primary" onClick={() => navigate(`/tickets/${msg.erpTicketId}`)}>#{msg.erpTicketId}</p>
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

                          {/* Error */}
                          {isInbound && msg.error && (
                            <div className="ml-12 rounded-xl border border-red-500/20 bg-red-500/5 p-4 flex items-start gap-3">
                              <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                              <p className="text-sm text-red-400">{msg.error}</p>
                            </div>
                          )}

                          {/* Message body */}
                          <div className="ml-12 rounded-2xl border border-outline-variant/30 bg-surface-container-low/30 overflow-hidden">
                            <div className="flex items-center gap-2 px-4 py-3 border-b border-outline-variant/20">
                              <MailOpen className="w-4 h-4 text-on-surface-variant" />
                              <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Corps du message</span>
                            </div>
                            <div className="p-5">
                              {(() => {
                                const html = msg.bodyHtml;
                                const plain = isInbound ? msg.bodyPreview : msg.body;
                                return html ? (
                                  <div className="text-sm text-on-surface leading-relaxed prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
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
                    {threadDetail && threadDetail.messages.length === 0 && (
                      <div className="flex flex-col items-center justify-center gap-3 text-on-surface-variant py-16">
                        <Mail className="w-10 h-10 text-outline/30" />
                        <p className="text-sm italic">Aucun message dans cette conversation.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
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
                <p className="text-xs text-on-surface-variant/60 mt-1">pour voir son contenu et l'analyse IA</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Test AI Modal ───────────────────────────────────────────────── */}
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
                {/* Header */}
                <div className="flex justify-between items-center pb-3 border-b border-outline-variant/30">
                  <h3 className="text-base font-bold text-on-surface flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-purple-500/10">
                      <Bot className="w-4 h-4 text-purple-400" />
                    </div>
                    Test analyse IA
                  </h3>
                  <motion.button onClick={() => setShowTestModal(false)} whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }} className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all">
                    <X className="w-4 h-4" />
                  </motion.button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-4">
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    Simulez l'analyse d'un e-mail par Gemini sans créer de ticket réel dans le système.
                  </p>

                  {testError && (
                    <div className="border border-red-500/20 bg-red-500/5 text-red-400 p-3 rounded-xl text-sm">
                      {testError}
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
                            <span className="text-on-surface font-semibold text-right">
                              {typeof v === 'boolean' ? (v ? 'Oui' : 'Non') : typeof v === 'number' ? (k === 'confidence' ? `${Math.round(v * 100)}%` : v) : String(v)}
                            </span>
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
    </div>
  );
}