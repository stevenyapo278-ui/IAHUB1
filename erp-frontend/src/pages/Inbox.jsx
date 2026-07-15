import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import { useSocket } from '../context/SocketContext';

const STATUS_LABELS = {
  PENDING: 'En attente',
  PROCESSING: 'Traitement...',
  DONE: 'Traité',
  ERROR: 'Erreur',
  SPAM: 'Spam',
};

const PRIORITY_COLORS = {
  P1: 'border-l-4 border-l-error',
  P2: 'border-l-4 border-l-amber-500',
  P3: '',
  P4: '',
};

const FILTERS = ['Tous', 'PENDING', 'DONE', 'ERROR', 'SPAM'];

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

const emailCardVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 120, damping: 20 } },
  exit: { opacity: 0, height: 0, padding: 0, margin: 0, overflow: 'hidden', transition: { duration: 0.2 } },
};

export default function Inbox() {
  const { user } = useAuth();
  const canSync = hasPermission(user, 'inbox.sync');
  const [emails, setEmails] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('Tous');
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testForm, setTestForm] = useState({ subject: '', body: '', from: '', fromName: '' });
  const [testResult, setTestResult] = useState(null);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testError, setTestError] = useState('');
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const socket = useSocket();

  // Garder une référence à jour des états pour éviter les fermetures lexicales périmées (stale closures) dans le socket
  const stateRef = useRef({ page, filter, search });
  useEffect(() => {
    stateRef.current = { page, filter, search };
  }, [page, filter, search]);

  const load = useCallback((p, f, q) => {
    const params = new URLSearchParams({ page: p, limit: 20 });
    if (f && f !== 'Tous') params.set('status', f);
    if (q && q.trim()) params.set('q', q.trim());
    api
      .get(`/inbox?${params}`)
      .then(({ data }) => { setEmails(data.items); setTotal(data.total); })
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
  }, []);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      load(1, filter, search);
      setPage(1);
    }, 350);
    return () => clearTimeout(delayDebounceFn);
  }, [filter, search, load]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      const { page: currentPage, filter: currentFilter, search: currentSearch } = stateRef.current;
      if (currentPage === 1) load(1, currentFilter, currentSearch);
    }, 15000);
    return () => clearInterval(intervalId);
  }, [load]);

  useEffect(() => {
    if (!socket) return;

    const handleEmailReceived = (newEmail) => {
      const { page: currentPage, filter: currentFilter, search: currentSearch } = stateRef.current;
      // Si l'utilisateur est sur la première page, on recharge pour récupérer l'email en haut de la liste
      if (currentPage === 1) {
        load(1, currentFilter, currentSearch);
      }
      toast.info('Nouveau mail reçu', {
        description: `Sujet : ${newEmail.subject}`,
      });
    };

    const handleEmailUpdated = (updatedEmail) => {
      // Met à jour l'email dans l'état local en temps réel
      setEmails((current) =>
        current.map((e) => (e.id === updatedEmail.id ? updatedEmail : e))
      );
      
      // Met à jour l'email sélectionné si c'est celui-ci qui a changé
      setSelected((currSelected) => 
        currSelected && currSelected.id === updatedEmail.id ? updatedEmail : currSelected
      );
    };

    socket.on('email_received', handleEmailReceived);
    socket.on('email_updated', handleEmailUpdated);

    return () => {
      socket.off('email_received', handleEmailReceived);
      socket.off('email_updated', handleEmailUpdated);
    };
  }, [socket, load]);

  async function handleSync() {
    setSyncing(true);
    setError('');
    try {
      const { data } = await api.post('/inbox/sync');
      load(1, filter, search);
      setError('');
      toast.success('Synchronisation terminée', {
        description: `${data.processed} email(s) traité(s) par l'agent IA.`,
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du sync');
    } finally {
      setSyncing(false);
    }
  }

  async function handleTestAnalyze(e) {
    e.preventDefault();
    setTesting(true);
    setTestResult(null);
    setTestError('');
    try {
      const { data } = await api.post('/inbox/test-analyze', testForm);
      setTestResult(data);
    } catch (err) {
      setTestError(err.response?.data?.error || 'Erreur lors du test');
    } finally {
      setTesting(false);
    }
  }

  function openTestModal() {
    setTestForm({ subject: '', body: '', from: '', fromName: '' });
    setTestResult(null);
    setTestError('');
    setShowTestModal(true);
  }

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
      className="p-lg flex flex-col gap-lg"
    >
      <motion.header variants={itemVariants} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-md">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-background font-bold">Boîte mail</h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
            Emails reçus et traités automatiquement par l'agent IA.
          </p>
        </div>
        {canSync && (
          <div className="flex flex-wrap gap-2 items-center">
            <motion.button
              onClick={openTestModal}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex items-center gap-xs px-md py-sm rounded-xl border border-outline-variant text-on-surface bg-surface-container-lowest font-body-sm text-body-sm hover:bg-surface-container-low transition-all shadow-sm disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">smart_toy</span>
              Test analyse IA
            </motion.button>
            <motion.button
              onClick={handleSync}
              disabled={syncing}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex items-center gap-xs px-md py-sm rounded-xl text-white btn-gradient font-body-sm text-body-sm font-semibold transition-all shadow-md shadow-primary/20 hover:shadow-lg whitespace-nowrap cursor-pointer disabled:opacity-60"
            >
              <motion.span
                animate={syncing ? { rotate: 360 } : { rotate: 0 }}
                transition={syncing ? { repeat: Infinity, duration: 1, ease: 'linear' } : { duration: 0.3 }}
                className="material-symbols-outlined text-[18px]"
              >
                sync
              </motion.span>
              {syncing ? 'Synchronisation...' : 'Sync maintenant'}
            </motion.button>
          </div>
        )}
      </motion.header>

      <AnimatePresence>
        {error && (
          <motion.div
            key="inbox-error"
            initial={{ opacity: 0, height: 0, y: -8 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md overflow-hidden"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Recherche et Filtres */}
        <motion.div variants={itemVariants} className="flex flex-col lg:flex-row gap-md justify-between items-stretch lg:items-center">
          {/* Barre de recherche */}
          <div className="relative flex-1 max-w-md">
            <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px] select-none">
              search
            </span>
            <input
              type="text"
              placeholder="Rechercher par sujet, expéditeur..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-surface-container border border-outline-variant/60 rounded-xl pl-10 pr-10 py-2.5 text-body-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 shadow-sm"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Effacer la recherche"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface p-0.5 rounded-full hover:bg-surface-container-high transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            )}
          </div>

          {/* Boutons de filtres */}
          <div className="flex gap-xs flex-wrap">
            {FILTERS.map((f) => (
              <motion.button
                key={f}
                onClick={() => setFilter(f)}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className={`px-4 py-2.5 rounded-xl border transition-all duration-300 font-body-sm text-body-sm font-semibold ${
                  filter === f
                    ? 'border-primary bg-primary/10 text-primary shadow-sm shadow-primary/5'
                    : 'border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high/60 hover:text-on-surface'
                }`}
              >
                {f === 'Tous' ? `Tous (${total})` : STATUS_LABELS[f]}
              </motion.button>
            ))}
          </div>
        </motion.div>

        {/* Split View: Liste + Détail */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-lg items-start">
          {/* ── Left Column: Email List ── */}
          <div className="lg:col-span-2 flex flex-col gap-md">
            <motion.div variants={itemVariants} className="bento-card overflow-hidden w-full">
              {emails.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="p-xl text-center text-on-surface-variant font-body-md text-body-md italic"
                >
                  <motion.span
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.15, type: 'spring', stiffness: 150, damping: 15 }}
                    className="material-symbols-outlined text-4xl block mb-3 text-on-surface-variant/50"
                  >
                    inbox
                  </motion.span>
                  Aucun email trouvé.
                </motion.div>
              ) : (
                <motion.div
                  initial="hidden"
                  animate="visible"
                  variants={{ visible: { transition: { staggerChildren: 0.02 } } }}
                  className="divide-y divide-outline-variant/40"
                >
                  <AnimatePresence mode="sync">
                    {emails.map((email) => (
                      <motion.button
                        key={email.id}
                        variants={emailCardVariants}
                        onClick={() => setSelected(email)}
                        whileHover={{ backgroundColor: 'var(--color-surface-container-low)' }}
                        className={`w-full text-left p-md transition-all duration-200 border-b border-outline-variant/30 last:border-0 ${PRIORITY_COLORS[email.aiPriority] || ''} ${selected?.id === email.id ? 'bg-surface-container-low/60 ring-2 ring-inset ring-primary/20' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-sm">
                          <div className="flex-1 min-w-0">
                            <p className="font-headline-sm text-headline-sm text-on-surface font-semibold truncate">{email.subject}</p>
                            <p className="font-body-sm text-body-sm text-on-surface-variant truncate mt-0.5">
                              {email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail}
                            </p>
                            {email.aiSummary && (
                              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5 line-clamp-1 italic bg-surface-container-low/30 px-2.5 py-1 rounded-lg w-fit max-w-full">
                                {email.aiSummary}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-xs shrink-0">
                            <motion.span
                              whileHover={{ scale: 1.05 }}
                              className={`badge px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${
                                email.status === 'DONE'
                                  ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/30'
                                  : email.status === 'ERROR'
                                  ? 'bg-error/10 text-error border-error/20'
                                  : 'bg-surface-container border-outline-variant text-on-surface-variant'
                              }`}
                            >
                              {STATUS_LABELS[email.status]}
                            </motion.span>
                            {email.aiPriority && (
                              <motion.span
                                whileHover={{ scale: 1.05 }}
                                className={`badge px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                  email.aiPriority === 'P1'
                                    ? 'bg-error/10 text-error border-error/20'
                                    : email.aiPriority === 'P2'
                                    ? 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400 dark:border-amber-500/30'
                                    : 'bg-surface-container border-outline-variant text-on-surface-variant'
                                }`}
                              >
                                {email.aiPriority}
                              </motion.span>
                            )}
                            <span className="font-mono-sm text-[10px] text-on-surface-variant">
                              {new Date(email.receivedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      </motion.button>
                    ))}
                  </AnimatePresence>
                </motion.div>
              )}
            </motion.div>

            {/* Pagination */}
            {total > 20 && (
              <motion.div variants={itemVariants} className="flex justify-center items-center gap-sm">
                <motion.button
                  disabled={page === 1}
                  onClick={() => {
                    setPage(page - 1);
                    load(page - 1, filter, search);
                  }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.95 }}
                  className="px-4 py-2 border border-outline-variant/60 text-on-surface font-semibold text-body-sm disabled:opacity-40 hover:bg-surface-container-low rounded-xl transition-all duration-300 shadow-sm"
                >
                  ← Précédent
                </motion.button>
                <motion.span
                  key={page}
                  initial={{ scale: 1.2, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="px-md font-body-sm text-body-sm text-on-surface-variant font-medium"
                >
                  Page {page} / {Math.ceil(total / 20)}
                </motion.span>
                <motion.button
                  disabled={page * 20 >= total}
                  onClick={() => {
                    setPage(page + 1);
                    load(page + 1, filter, search);
                  }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.95 }}
                  className="px-4 py-2 border border-outline-variant/60 text-on-surface font-semibold text-body-sm disabled:opacity-40 hover:bg-surface-container-low rounded-xl transition-all duration-300 shadow-sm"
                >
                  Suivant →
                </motion.button>
              </motion.div>
            )}
          </div>

          {/* ── Right Column: Detail Panel ── */}
          <div className="lg:col-span-1 lg:sticky lg:top-0">
            {selected ? (
              <motion.div
                key={selected.id}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="bento-card p-lg space-y-md"
              >
                {/* Close + Header */}
                <div className="flex items-start justify-between gap-md">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-headline-md text-headline-md text-on-surface font-bold leading-tight">{selected.subject}</h3>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                      {selected.fromName ? `${selected.fromName} <${selected.fromEmail}>` : selected.fromEmail}
                    </p>
                    <p className="font-mono-sm text-[11px] text-on-surface-variant mt-0.5">
                      {new Date(selected.receivedAt).toLocaleString('fr-FR')}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    className="shrink-0 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low p-1.5 rounded-lg transition-all cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>

                {/* Status badges */}
                <div className="flex flex-wrap gap-2">
                  <span className={`badge px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase ${
                    selected.status === 'DONE'
                      ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                      : selected.status === 'ERROR'
                      ? 'bg-error/10 text-error border-error/20'
                      : 'bg-surface-container border-outline-variant text-on-surface-variant'
                  }`}>
                    {STATUS_LABELS[selected.status]}
                  </span>
                  {selected.aiPriority && (
                    <span className={`badge px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                      selected.aiPriority === 'P1'
                        ? 'bg-error/10 text-error border-error/20'
                        : selected.aiPriority === 'P2'
                        ? 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                        : 'bg-surface-container border-outline-variant text-on-surface-variant'
                    }`}>
                      {selected.aiPriority}
                    </span>
                  )}
                </div>

                {/* AI Summary */}
                {selected.aiSummary && (
                  <div className="bg-surface-container-low/40 border border-outline-variant/40 rounded-xl p-md">
                    <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-1">Résumé IA</p>
                    <p className="font-body-sm text-body-sm text-on-surface leading-relaxed">{selected.aiSummary}</p>
                  </div>
                )}

                {/* Analysis grid */}
                <div className="grid grid-cols-2 gap-md bg-surface-container-low/30 border border-outline-variant/40 rounded-xl p-md">
                  {selected.aiCategory && (
                    <div>
                      <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Catégorie</p>
                      <p className="font-body-sm text-body-sm text-on-surface font-semibold mt-0.5">{selected.aiCategory}</p>
                    </div>
                  )}
                  {selected.aiTeam && (
                    <div>
                      <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Équipe</p>
                      <p className="font-body-sm text-body-sm text-on-surface font-semibold mt-0.5">{selected.aiTeam}</p>
                    </div>
                  )}
                  {selected.aiConfidence != null && (
                    <div>
                      <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Confiance IA</p>
                      <p className="font-body-sm text-body-sm text-on-surface font-semibold mt-0.5">{Math.round(selected.aiConfidence * 100)}%</p>
                    </div>
                  )}
                  {selected.glpiTicketId && (
                    <div>
                      <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Ticket GLPI</p>
                      <p className="font-body-sm text-body-sm text-on-surface font-semibold mt-0.5">#{selected.glpiTicketId}</p>
                    </div>
                  )}
                </div>

                {/* Error */}
                {selected.error && (
                  <div className="p-sm bg-error/5 border border-error/15 rounded-xl text-error font-body-sm text-body-sm">
                    {selected.error}
                  </div>
                )}

                {/* View ticket button */}
                {selected.erpTicketId && (
                  <motion.button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/tickets/${selected.erpTicketId}`);
                    }}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="w-full mt-2 px-4 py-2.5 border border-outline-variant/60 text-on-surface font-semibold text-body-sm hover:bg-surface-container-high transition-colors rounded-xl flex items-center justify-center gap-xs shadow-sm"
                  >
                    <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                    Voir le ticket #{selected.erpTicketId}
                  </motion.button>
                )}
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bento-card p-xl text-center text-on-surface-variant"
              >
                <span className="material-symbols-outlined text-4xl block mb-3 text-on-surface-variant/30">mail_outline</span>
                <p className="font-body-md text-body-md">Sélectionnez un email pour voir ses détails</p>
              </motion.div>
            )}
          </div>
        </div>

      {/* ── Test AI Analysis Modal ──────────────────────────────────────── */}
      {canSync && createPortal(
        <AnimatePresence>
          {showTestModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setShowTestModal(false)}
                className="absolute inset-0 bg-black/60 backdrop-blur-[2px] cursor-pointer"
              />

              {/* Dialog Window */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 16 }}
                transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }}
                className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl max-w-md w-full p-lg card-shadow flex flex-col gap-md overflow-hidden max-h-[90vh]"
              >
                {/* Header */}
                <div className="flex justify-between items-start pb-2 border-b border-outline-variant/30 shrink-0">
                  <h3 className="font-headline-md text-headline-md text-on-background font-bold flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-[22px]" aria-hidden="true">smart_toy</span>
                    Test analyse IA
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowTestModal(false)}
                    className="text-on-surface-variant/70 hover:text-on-surface hover:bg-surface-container-low p-1.5 rounded-lg transition-all cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[20px]" aria-hidden="true">close</span>
                  </button>
                </div>

                {/* Content Area with scroll if needed */}
                <div className="flex-1 overflow-y-auto space-y-md pr-xs">
                  <p className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">
                    Simulez l'analyse d'un e-mail par Gemini sans créer de ticket réel dans le système.
                  </p>

                  {/* Error Box */}
                  {testError && (
                    <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-sm text-body-sm">
                      {testError}
                    </div>
                  )}

                  {/* Form */}
                  <form onSubmit={handleTestAnalyze} className="space-y-4">
                    <label className="flex flex-col gap-xs">
                      <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Sujet *</span>
                      <input
                        className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300"
                        value={testForm.subject}
                        onChange={(e) => setTestForm({ ...testForm, subject: e.target.value })}
                        placeholder="ex: Mon VPN ne fonctionne plus"
                        required
                        autoFocus
                      />
                    </label>

                    <label className="flex flex-col gap-xs">
                      <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Corps *</span>
                      <textarea
                        rows={4}
                        className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 resize-none"
                        value={testForm.body}
                        onChange={(e) => setTestForm({ ...testForm, body: e.target.value })}
                        placeholder="Bonjour, depuis ce matin je ne peux plus me connecter au VPN..."
                        required
                      />
                    </label>

                    <label className="flex flex-col gap-xs">
                      <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Email expéditeur</span>
                      <input
                        type="email"
                        className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300"
                        value={testForm.from}
                        onChange={(e) => setTestForm({ ...testForm, from: e.target.value })}
                        placeholder="user@example.com"
                      />
                    </label>

                    {/* Actions / Submit */}
                    <div className="pt-4 border-t border-outline-variant/30 flex justify-end gap-sm">
                      <button
                        type="button"
                        onClick={() => setShowTestModal(false)}
                        className="px-4 py-2.5 rounded-xl border border-outline-variant bg-surface text-on-surface font-body-sm text-body-sm hover:bg-surface-container-low transition-colors duration-300 font-medium cursor-pointer"
                      >
                        Annuler
                      </button>
                      <button
                        type="submit"
                        disabled={testing}
                        className="px-5 py-2.5 rounded-xl text-white font-body-sm text-body-sm font-semibold shadow-md btn-gradient shadow-primary/20 hover:shadow-lg transition-all cursor-pointer disabled:opacity-60"
                      >
                        {testing ? 'Analyse...' : 'Analyser l\'e-mail'}
                      </button>
                    </div>
                  </form>

                  {/* Gemini Result Box */}
                  <AnimatePresence>
                    {testResult && (
                      <motion.div
                        key="test-result"
                        initial={{ opacity: 0, height: 0, scale: 0.97 }}
                        animate={{ opacity: 1, height: 'auto', scale: 1 }}
                        exit={{ opacity: 0, height: 0, scale: 0.97 }}
                        transition={{ type: 'spring', stiffness: 200, damping: 22 }}
                        className="border border-outline-variant/60 bg-surface-container-low/40 rounded-xl p-md space-y-2 font-body-sm text-body-sm overflow-hidden"
                      >
                        <p className="font-headline-sm text-headline-sm text-on-surface mb-2 font-semibold flex items-center gap-2">
                          <motion.span
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                            className="material-symbols-outlined text-primary text-lg"
                          >
                            check_circle
                          </motion.span>
                          Résultat Gemini
                        </p>
                        {Object.entries(testResult).map(([k, v], i) => (
                          <div
                            key={k}
                            className="flex justify-between gap-sm border-b border-outline-variant/20 pb-1.5 last:border-0 last:pb-0"
                          >
                            <span className="text-on-surface-variant capitalize">{k}</span>
                            <span className="text-on-surface text-right font-medium">
                              {typeof v === 'boolean'
                                ? (v ? 'Oui' : 'Non')
                                : typeof v === 'number'
                                ? (k === 'confidence' ? `${Math.round(v * 100)}%` : v)
                                : String(v)}
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
    </motion.div>
  );
}
