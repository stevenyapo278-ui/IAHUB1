import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../api/client';
import { useSocket } from '../context/SocketContext';

const PIPELINE_STEPS = [
  { id: 'reception', label: 'Réception email', icon: 'mail' },
  { id: 'signature', label: 'Extraction signature', icon: 'ink_eraser' },
  { id: 'antispam', label: 'Filtre Anti-Spam', icon: 'shield' },
  { id: 'thread', label: 'Liaison fil', icon: 'link' },
  { id: 'dedup', label: 'Détection doublon', icon: 'filter_alt' },
  { id: 'intent', label: 'Analyse intention', icon: 'psychology' },
  { id: 'ticket', label: 'Création Ticket', icon: 'confirmation_number' },
  { id: 'reply', label: 'Génération réponse', icon: 'auto_awesome' },
  { id: 'finalize', label: 'Finalisation', icon: 'check_circle' },
];

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

const stepVariants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: (i) => ({
    opacity: 1,
    scale: 1,
    transition: { delay: i * 0.04, type: 'spring', stiffness: 150, damping: 15 },
  }),
};

function makeProgressBar(percent, totalBlocks = 20) {
  const filled = Math.round((percent / 100) * totalBlocks);
  return '█'.repeat(filled) + '░'.repeat(totalBlocks - filled);
}

export default function Supervision() {
  const [bootPhase, setBootPhase] = useState(0);
  const [loadingPercent, setLoadingPercent] = useState(0);
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [pipelineStates, setPipelineStates] = useState({});
  const [activeEmailId, setActiveEmailId] = useState(null);
  const [emailAccounts, setEmailAccounts] = useState([]);
  const [activeEnginesText, setActiveEnginesText] = useState('gemini-pro, glpi-api');
  const [showBoot, setShowBoot] = useState(true);
  const [accuracyStats, setAccuracyStats] = useState(null);
  const [schedulerHealth, setSchedulerHealth] = useState([]);
  const socket = useSocket();
  const pageLoadTime = useRef(new Date());
  const terminalEndRef = useRef(null);

  useEffect(() => {
    const loadSystemInfo = async () => {
      try {
        const [accountsRes, providersRes] = await Promise.all([
          api.get('/email-accounts'),
          api.get('/ai-providers'),
        ]);
        const activeAccounts = (accountsRes.data || []).filter((acc) => acc.isActive);
        setEmailAccounts(activeAccounts);
        const activeModels = [];
        (providersRes.data || []).forEach((p) => {
          if (p.isActive) {
            const defModel = (p.models || []).find((m) => m.isActive && m.isDefault && m.type === 'CHAT');
            if (defModel) activeModels.push(defModel.name);
          }
        });
        setActiveEnginesText(activeModels.length > 0 ? `${activeModels.join(', ')}, glpi-api` : 'glpi-api');
      } catch (err) {
        console.error('Erreur chargement infos système :', err);
      }
    };
    loadSystemInfo();
  }, []);

  useEffect(() => {
    if (!showBoot) return;
    if (bootPhase === 0) {
      const t1 = setTimeout(() => setBootPhase(1), 600);
      return () => clearTimeout(t1);
    }
    if (bootPhase === 1) {
      let pct = 0;
      const interval = setInterval(() => {
        pct += 3;
        if (pct >= 100) { pct = 100; clearInterval(interval); setBootPhase(2); }
        setLoadingPercent(pct);
      }, 25);
      return () => clearInterval(interval);
    }
    if (bootPhase === 2) {
      const t2 = setTimeout(() => { setBootPhase(3); }, 1000);
      return () => clearTimeout(t2);
    }
  }, [bootPhase, showBoot]);

  const loadEmails = async (isFirstLoad = false) => {
    try {
      if (isFirstLoad) setLoading(true);
      const res = await api.get('/inbox?page=1&limit=10');
      setEmails(res.data.items || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Erreur de chargement');
    } finally {
      if (isFirstLoad) setLoading(false);
    }
  };

  useEffect(() => {
    if (bootPhase !== 3) return;
    loadEmails(true);
    const interval = setInterval(() => loadEmails(false), 5000);
    return () => clearInterval(interval);
  }, [bootPhase]);

  useEffect(() => {
    if (emails.length > 0 && !activeEmailId) setActiveEmailId(emails[0].id);
  }, [emails, activeEmailId]);

  const handleScroll = (e) => {
    const container = e.target;
    const containerTop = container.getBoundingClientRect().top + container.clientHeight / 2;
    let closestId = null;
    let minDistance = Infinity;
    emails.forEach((email) => {
      const el = document.getElementById(`card-${email.id}`);
      if (el) {
        const rect = el.getBoundingClientRect();
        const cardCenter = rect.top + rect.height / 2;
        const distance = Math.abs(cardCenter - containerTop);
        if (distance < minDistance) {
          minDistance = distance;
          closestId = email.id;
        }
      }
    });
    if (closestId && closestId !== activeEmailId) setActiveEmailId(closestId);
  };

  // Charge les stats de précision des assignations
  useEffect(() => {
    async function loadAccuracyStats() {
      try {
        const [accuracyRes, healthRes] = await Promise.all([
          api.get('/skills/stats/accuracy?days=30').catch(() => ({ data: null })),
          api.get('/health/schedulers').catch(() => ({ data: [] })),
        ]);
        if (accuracyRes.data) setAccuracyStats(accuracyRes.data);
        if (Array.isArray(healthRes.data)) setSchedulerHealth(healthRes.data);
      } catch { /* ignore */ }
    }
    loadAccuracyStats();
  }, []);

  // Écoute les événements socket pour rafraîchir en temps réel
  useEffect(() => {
    if (!socket) return;

    const handleEmailReceived = () => loadEmails(false);
    const handleEmailUpdated = () => loadEmails(false);

    socket.on('email_received', handleEmailReceived);
    socket.on('email_updated', handleEmailUpdated);

    // Rafraîchir les stats quand un ticket est créé/mis à jour
    const refreshAccuracy = async () => {
      try {
        const res = await api.get('/skills/stats/accuracy?days=30');
        setAccuracyStats(res.data);
      } catch { /* ignore */ }
    };
    socket.on('ticket_created', refreshAccuracy);
    socket.on('ticket_assigned', refreshAccuracy);

    return () => {
      socket.off('email_received', handleEmailReceived);
      socket.off('email_updated', handleEmailUpdated);
      socket.off('ticket_created', refreshAccuracy);
      socket.off('ticket_assigned', refreshAccuracy);
    };
  }, [socket]);

  // Boot animation auto-hide after first load
  useEffect(() => {
    if (bootPhase === 3 && emails.length > 0 && !loading) {
      const t = setTimeout(() => setShowBoot(false), 6000);
      return () => clearTimeout(t);
    }
  }, [bootPhase, emails, loading]);

  useEffect(() => {
    if (terminalEndRef.current) terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [bootPhase, loadingPercent, error]);

  function getFinalPipelineState(email) {
    const isSpam = email.aiIsSpam || email.status === 'SPAM';
    const isError = email.status === 'ERROR';
    if (isSpam) {
      const states = PIPELINE_STEPS.map((_, i) => (i <= 1 ? 'done' : i === 2 ? 'failed' : 'skipped'));
      return { id: email.id, percent: 33, activeStepIndex: 2, stepStates: states, details: { status: 'SPAM', message: "Bloqué comme Spam", confidence: email.aiConfidence != null ? `${Math.round(email.aiConfidence * 100)}%` : '—' } };
    }
    if (isError) {
      const states = PIPELINE_STEPS.map((_, i) => (i < 6 ? 'done' : i === 6 ? 'failed' : 'skipped'));
      return { id: email.id, percent: 77, activeStepIndex: 6, stepStates: states, error: email.error || 'Erreur traitement' };
    }
    const states = PIPELINE_STEPS.map(() => 'done');
    return { id: email.id, percent: 100, activeStepIndex: PIPELINE_STEPS.length, stepStates: states, details: { status: 'DONE', ticketId: email.erpTicketId, glpiId: email.glpiTicketId, category: email.aiCategory || 'INCIDENT', priority: email.aiPriority || 'P3', summary: email.aiSummary || 'Triage effectué.' } };
  }

  useEffect(() => {
    if (emails.length === 0) return;
    setPipelineStates((prev) => {
      const next = { ...prev };
      let updated = false;
      emails.forEach((email) => {
        if (!next[email.id]) {
          const isOld = new Date(email.createdAt) < pageLoadTime.current;
          if (isOld) {
            next[email.id] = getFinalPipelineState(email);
          } else {
            next[email.id] = { id: email.id, percent: 0, activeStepIndex: 0, stepStates: PIPELINE_STEPS.map(() => 'pending'), isAnimating: true, targetState: getFinalPipelineState(email) };
          }
          updated = true;
        } else if (!next[email.id].isAnimating) {
          const finalState = getFinalPipelineState(email);
          if (next[email.id].percent !== finalState.percent || next[email.id].details?.ticketId !== finalState.details?.ticketId) {
            next[email.id] = finalState;
            updated = true;
          }
        }
      });
      return updated ? next : prev;
    });
  }, [emails]);

  useEffect(() => {
    const animatingIds = Object.keys(pipelineStates).filter((id) => pipelineStates[id].isAnimating);
    if (animatingIds.length === 0) return;
    const interval = setInterval(() => {
      setPipelineStates((prev) => {
        const next = { ...prev };
        let updated = false;
        animatingIds.forEach((id) => {
          const state = next[id];
          if (!state || !state.isAnimating) return;
          const currentIdx = state.activeStepIndex;
          const target = state.targetState;
          const states = [...state.stepStates];
          if (currentIdx > 0 && states[currentIdx - 1] === 'running') states[currentIdx - 1] = 'done';
          const maxIdx = target.activeStepIndex;
          if (currentIdx < maxIdx) {
            states[currentIdx] = 'running';
            next[id] = { ...state, percent: Math.round(((currentIdx + 1) / PIPELINE_STEPS.length) * 100), activeStepIndex: currentIdx + 1, stepStates: states };
            updated = true;
          } else {
            next[id] = { ...target, isAnimating: false };
            updated = true;
          }
        });
        return updated ? next : prev;
      });
    }, 400);
    return () => clearInterval(interval);
  }, [pipelineStates]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await api.post('/inbox/sync');
      await loadEmails(false);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Erreur synchronisation');
    } finally {
      setSyncing(false);
    }
  };

  const stats = {
    total: emails.length,
    done: emails.filter((e) => e.status === 'DONE').length,
    error: emails.filter((e) => e.status === 'ERROR').length,
    pending: emails.filter((e) => e.status === 'PENDING' || e.status === 'PROCESSING').length,
    spam: emails.filter((e) => e.status === 'SPAM' || e.aiIsSpam).length,
  };

  const activePipelines = emails.map((email) => {
    const state = pipelineStates[email.id];
    if (!state) return { id: email.id, subject: email.subject, percent: 0, activeStepIndex: 0, stepStates: PIPELINE_STEPS.map(() => 'pending') };
    return { ...state, subject: email.subject };
  });

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
      className="p-lg flex flex-col gap-lg"
    >
      {/* Header */}
      <motion.header variants={itemVariants} className="flex flex-col sm:flex-row sm:items-start justify-between gap-md">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-background font-bold flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[28px]">monitor_heart</span>
            Supervision
          </h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
            Moniteur en temps réel du daemon de triage IA.
          </p>
        </div>
        <motion.button
          onClick={handleSync}
          disabled={syncing}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.96 }}
          className="h-fit flex items-center gap-xs px-md py-sm rounded-xl btn-gradient font-semibold shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 disabled:opacity-60 text-body-sm"
        >
          <motion.span
            animate={syncing ? { rotate: 360 } : { rotate: 0 }}
            transition={syncing ? { repeat: Infinity, duration: 1, ease: 'linear' } : { duration: 0.3 }}
            className="material-symbols-outlined text-[18px]"
          >
            sync
          </motion.span>
          {syncing ? 'Synchro...' : 'Synchroniser'}
        </motion.button>
      </motion.header>

      <AnimatePresence>
        {error && (
          <motion.div
            key="supervision-error"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-sm overflow-hidden"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ Boot Sequence ═══ */}
      <AnimatePresence>
        {showBoot && (
          <motion.div
            key="boot-sequence"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="bento-card p-lg space-y-md overflow-hidden"
          >
            <div className="font-mono text-sm space-y-sm">
              <motion.div variants={itemVariants} className="flex items-center gap-2 text-primary font-semibold">
                <span className="material-symbols-outlined text-[18px]">terminal</span>
                itsm-triage-daemon v2.0.0 — initialisation...
              </motion.div>

              <AnimatePresence>
                {bootPhase >= 1 && (
                  <motion.div
                    key="phase1"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="space-y-sm pl-md overflow-hidden"
                  >
                    <div className="flex items-center gap-xs text-on-surface-variant">
                      <span className="text-primary font-bold">[{makeProgressBar(loadingPercent)}]</span>
                      <span>chargement des moteurs IA ({Math.round((loadingPercent / 100) * 9)}/9 modules)</span>
                    </div>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${loadingPercent}%` }}
                      className="h-1.5 bg-primary/20 rounded-full overflow-hidden"
                    >
                      <motion.div
                        className="progress-gradient h-full rounded-full"
                        style={{ width: `${loadingPercent}%` }}
                      />
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {bootPhase >= 2 && (
                  <motion.div
                    key="phase2"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="space-y-xs pl-md overflow-hidden"
                  >
                    <div className="text-on-surface-variant">connexion aux boîtes mail...</div>
                    {emailAccounts.length === 0 ? (
                      <div className="flex items-center gap-2 text-amber-500 text-xs">
                        <span className="material-symbols-outlined text-[14px]">warning</span>
                        Aucune boîte mail active configurée
                      </div>
                    ) : (
                      emailAccounts.map((acc) => (
                        <motion.div
                          key={acc.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="flex items-center gap-2 text-xs"
                        >
                          <span className="material-symbols-outlined text-[14px] text-emerald-400">check_circle</span>
                          <span className="text-on-surface-variant">{acc.emailAddress}</span>
                          <span className="text-emerald-400 font-semibold">[prêt]</span>
                        </motion.div>
                      ))
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {bootPhase >= 3 && (
                  <motion.div
                    key="phase3"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="pl-md overflow-hidden"
                  >
                    <div className="flex items-center gap-2">
                      <motion.span
                        animate={{ scale: [1, 1.3, 1] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                        className="w-2 h-2 rounded-full bg-emerald-400"
                      />
                      <span className="text-emerald-400 font-semibold">prêt</span>
                      <span className="text-on-surface-variant text-xs">— moteurs actifs : {activeEnginesText}</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ Section Précision des assignations ═══ */}
      {accuracyStats && (
        <motion.div variants={itemVariants} className="bento-card p-lg">
          <div className="flex items-center justify-between mb-md">
            <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[20px]">psychology</span>
              Précision des assignations IA
            </h3>
            <span className="text-[11px] text-on-surface-variant">30 derniers jours</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-md">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Assignations</span>
              <span className="font-display-md text-display-md text-on-surface font-bold">{accuracyStats.totalAssignments}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Auto IA</span>
              <span className="font-display-md text-display-md text-primary font-bold">{accuracyStats.autoAssigned}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Corrigées</span>
              <span className="font-display-md text-display-md text-amber-500 font-bold">{accuracyStats.corrected}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Précision</span>
              <span className={`font-display-md text-display-md font-bold ${
                accuracyStats.accuracy === null ? 'text-outline/50' :
                accuracyStats.accuracy >= 80 ? 'text-emerald-500' :
                accuracyStats.accuracy >= 50 ? 'text-amber-500' :
                'text-red-500'
              }`}>
                {accuracyStats.accuracy !== null ? `${accuracyStats.accuracy}%` : '—'}
              </span>
            </div>
          </div>

          {/* Raisons de réassignation */}
          {accuracyStats.reasons?.length > 0 && (
            <div className="mt-md pt-md border-t border-outline-variant/40">
              <p className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold mb-sm">Raisons de réassignation</p>
              <div className="flex flex-wrap gap-2">
                {accuracyStats.reasons.map((r) => (
                  <span
                    key={r.reason}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-surface-container-low text-on-surface-variant border border-outline-variant/40"
                  >
                    {r.reason.replace(/_/g, ' ')}
                    <span className="font-bold text-on-surface">{r._count.id}x</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Évolution journalière */}
          {accuracyStats.dailyStats?.length > 0 && (
            <div className="mt-md pt-md border-t border-outline-variant/40">
              <p className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold mb-sm">Évolution journalière</p>
              <div className="flex items-end gap-1 h-16">
                {accuracyStats.dailyStats.slice(-14).map((day) => {
                  const maxCount = Math.max(...accuracyStats.dailyStats.map((d) => d.total), 1);
                  const height = (day.total / maxCount) * 100;
                  return (
                    <div
                      key={day.date}
                      className="flex-1 flex flex-col items-center gap-0.5 group relative"
                    >
                      <div
                        className="w-full rounded-t-sm transition-all duration-200 group-hover:opacity-80"
                        style={{
                          height: `${Math.max(height, 4)}%`,
                          backgroundColor: day.corrected > 0 ? 'var(--color-amber-500)' : 'var(--color-primary)',
                          opacity: 0.6 + (height / 100) * 0.4,
                        }}
                      />
                      <span className="text-[8px] text-on-surface-variant/60 hidden group-hover:block absolute -top-5 whitespace-nowrap bg-surface-container-high px-1.5 py-0.5 rounded text-[10px]">
                        {day.date?.slice(5)} — {day.total} assign.
                        {day.corrected > 0 ? ` (${day.corrected} corrig.)` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {accuracyStats.totalAssignments === 0 && (
            <div className="mt-md pt-md border-t border-outline-variant/40 text-center py-4">
              <p className="text-[12px] text-on-surface-variant italic">
                Aucune assignation enregistrée — les données apparaîtront quand des tickets seront traités.
              </p>
            </div>
          )}
        </motion.div>
      )}

      {/* ═══ Stats Cards ═══ */}
      <motion.div
        variants={itemVariants}
        className="grid grid-cols-2 md:grid-cols-4 gap-gutter"
      >
        {[
          { label: 'Total emails', value: stats.total, icon: 'inbox', color: 'text-primary' },
          { label: 'Traités', value: stats.done, icon: 'check_circle', color: 'text-emerald-500' },
          { label: 'En attente', value: stats.pending, icon: 'hourglass_empty', color: 'text-amber-500' },
          { label: 'Erreurs', value: stats.error, icon: 'error', color: 'text-red-500', critical: stats.error > 0 },
        ].map((stat) => (
          <motion.div
            key={stat.label}
            variants={itemVariants}
            whileHover={{ y: -2 }}
            className={`bento-card flex flex-col p-lg justify-between ${stat.critical ? 'stat-card-glow' : ''}`}
          >
            <div className="flex items-center justify-between mb-sm">
              <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">{stat.label}</span>
              <span className={`material-symbols-outlined ${stat.color} text-xl`}>{stat.icon}</span>
            </div>
            <motion.span
              key={stat.value}
              initial={{ scale: 1.3, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
              className={`font-display-lg text-display-lg font-bold ${stat.color}`}
            >
              {stat.value}
            </motion.span>
          </motion.div>
        ))}
      </motion.div>

      {/* ═══ Status Bar ═══ */}
      <motion.div variants={itemVariants} className="bento-card p-md flex items-center gap-md">
        <span className="relative flex h-3 w-3 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
        </span>
        <div className="flex-1">
          <div className="font-headline-sm text-headline-sm text-on-surface font-semibold">Daemon de triage actif</div>
          <div className="font-body-sm text-body-sm text-on-surface-variant">Mise à jour toutes les 5 secondes — {activeEnginesText}</div>
        </div>
        {bootPhase >= 3 && (
          <div className="flex items-center gap-2 text-xs text-on-surface-variant font-medium">
            <span className="hidden sm:inline">Dernière synchro :</span>
            <span className="font-semibold text-on-surface">{new Date().toLocaleTimeString('fr-FR')}</span>
          </div>
        )}
      </motion.div>

      {/* ═══ Main Content ═══ */}
      {!loading && emails.length === 0 ? (
        /* État vide — Moniteur en veille */
        <motion.div variants={itemVariants} className="bento-card p-xl flex flex-col items-center justify-center text-center">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 100, damping: 12 }}
            className="relative w-48 h-48 mb-6"
          >
            <svg className="w-full h-full" viewBox="0 0 200 200">
              <defs>
                <radialGradient id="emptyCoreGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
                </radialGradient>
              </defs>
              <circle cx="100" cy="100" r="90" fill="none" stroke="var(--color-outline-variant)" strokeWidth="1" />
              <circle cx="100" cy="100" r="65" fill="none" stroke="var(--color-outline-variant)" strokeWidth="1" strokeDasharray="4,4" />
              <circle cx="100" cy="100" r="40" fill="none" stroke="var(--color-outline-variant)" strokeWidth="1" />
              <motion.g
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 8, ease: 'linear' }}
                className="origin-center"
              >
                <line x1="100" y1="100" x2="100" y2="10" stroke="var(--color-primary)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
              </motion.g>
              <motion.g
                animate={{ rotate: -360 }}
                transition={{ repeat: Infinity, duration: 12, ease: 'linear' }}
                className="origin-center"
              >
                <circle cx="35" cy="100" r="4" fill="var(--color-secondary)" opacity="0.6" />
              </motion.g>
              <motion.g
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 15, ease: 'linear' }}
                className="origin-center"
              >
                <circle cx="160" cy="80" r="3" fill="var(--color-primary)" opacity="0.5" />
                <circle cx="140" cy="160" r="5" fill="var(--color-tertiary)" opacity="0.4" />
              </motion.g>
              <circle cx="100" cy="100" r="20" fill="url(#emptyCoreGlow)" />
              <circle cx="100" cy="100" r="6" fill="var(--color-primary)" />
            </svg>
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
            >
              <span className="material-symbols-outlined text-3xl text-white/80">mail</span>
            </motion.div>
          </motion.div>
          <h3 className="font-headline-md text-headline-md text-on-surface font-semibold mb-2">Moniteur en veille</h3>
          <p className="font-body-sm text-body-sm text-on-surface-variant max-w-md">
            Daemon de triage en écoute. Aucun e-mail dans la boîte de réception à analyser.
          </p>
        </motion.div>
      ) : (
        /* Liste d'e-mails avec pipelines */
        <div className="flex gap-md items-stretch w-full relative">
          {/* Colonne principale */}
          <motion.div
            variants={itemVariants}
            className="flex-1 min-w-0 space-y-md"
            style={{
              WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 6%, black 94%, transparent 100%)',
              maskImage: 'linear-gradient(to bottom, transparent 0%, black 6%, black 94%, transparent 100%)',
            }}
          >
            <div onScroll={handleScroll} className="max-h-[70vh] overflow-y-auto py-lg pr-sm space-y-md">
              <AnimatePresence>
                {activePipelines.map((sim) => {
                  const finalState = pipelineStates[sim.id];
                  return (
                    <motion.div
                      key={sim.id}
                      id={`card-${sim.id}`}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      className="bento-card p-md space-y-md"
                    >
                      {/* Header */}
                      <div className="flex items-center justify-between border-b border-outline-variant/40 pb-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-[11px] text-primary font-bold shrink-0">#{sim.id}</span>
                          <span className="font-body-sm text-body-sm text-on-surface truncate">{sim.subject}</span>
                        </div>
                        <div className="shrink-0">
                          {sim.error ? (
                            <span className="text-[10px] font-bold uppercase text-red-500 border border-red-500/20 bg-red-500/5 px-2 py-0.5 rounded-full">Erreur</span>
                          ) : sim.details?.status === 'SPAM' ? (
                            <span className="text-[10px] font-bold uppercase text-amber-500 border border-amber-500/20 bg-amber-500/5 px-2 py-0.5 rounded-full">Spam</span>
                          ) : sim.percent >= 100 ? (
                            <span className="text-[10px] font-bold uppercase text-emerald-500 border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 rounded-full">Prêt</span>
                          ) : (
                            <motion.span
                              animate={{ opacity: [1, 0.4, 1] }}
                              transition={{ duration: 1.5, repeat: Infinity }}
                              className="text-[10px] font-bold uppercase text-primary border border-primary/20 bg-primary/5 px-2 py-0.5 rounded-full"
                            >
                              Traitement...
                            </motion.span>
                          )}
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-surface-container-high rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${sim.percent}%` }}
                            transition={{ duration: 0.4, ease: 'easeInOut' }}
                            className={`h-full rounded-full ${
                              sim.error ? 'bg-red-500' : sim.details?.status === 'SPAM' ? 'bg-amber-500' : sim.percent >= 100 ? 'bg-emerald-500' : 'bg-primary'
                            }`}
                          />
                        </div>
                        <span className="font-mono text-[11px] text-on-surface-variant font-medium shrink-0">{sim.percent}%</span>
                      </div>

                      {/* Pipeline Steps */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5">
                        {PIPELINE_STEPS.map((step, idx) => {
                          const state = sim.stepStates[idx];
                          let bgColor = 'bg-surface-container-high/40';
                          let textColor = 'text-on-surface-variant/40';
                          let icon = step.icon;
                          if (state === 'running') { bgColor = 'bg-primary/10 border border-primary/20'; textColor = 'text-primary font-semibold'; }
                          else if (state === 'done') { bgColor = 'bg-emerald-500/8'; textColor = 'text-emerald-500'; }
                          else if (state === 'failed') { bgColor = 'bg-red-500/10 border border-red-500/20'; textColor = 'text-red-500 font-semibold'; icon = 'cancel'; }
                          else if (state === 'skipped') { textColor = 'text-on-surface-variant/20'; }

                          return (
                            <motion.div
                              key={step.id}
                              custom={idx}
                              variants={stepVariants}
                              initial="hidden"
                              animate="visible"
                              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] ${bgColor} ${textColor} transition-colors`}
                            >
                              <span className="material-symbols-outlined text-[14px] shrink-0">{icon}</span>
                              <span className="truncate">{step.label}</span>
                              {state === 'running' && (
                                <motion.span
                                  animate={{ opacity: [1, 0.3, 1] }}
                                  transition={{ duration: 1, repeat: Infinity }}
                                  className="w-1.5 h-1.5 rounded-full bg-primary ml-auto shrink-0"
                                />
                              )}
                              {state === 'done' && <span className="ml-auto text-[10px] shrink-0">✓</span>}
                            </motion.div>
                          );
                        })}
                      </div>

                      {/* Résultats */}
                      <AnimatePresence>
                        {sim.details && (
                          <motion.div
                            key={`${sim.id}-details`}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            transition={{ duration: 0.3 }}
                            className="border-t border-outline-variant/40 pt-md space-y-2 overflow-hidden"
                          >
                            {sim.details.status === 'SPAM' ? (
                              <div className="flex items-center gap-2 text-amber-500 font-body-sm text-body-sm">
                                <span className="material-symbols-outlined text-[16px]">block</span>
                                {sim.details.message} — Confiance : {sim.details.confidence}
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-3 text-body-sm text-body-sm flex-wrap">
                                  <span className="flex items-center gap-1 text-emerald-500">
                                    <span className="material-symbols-outlined text-[16px]">confirmation_number</span>
                                    <span className="text-on-surface font-semibold">#{sim.details.ticketId}</span>
                                  </span>
                                  <span className="text-on-surface-variant">|</span>
                                  <span className="text-on-surface-variant">Catégorie : <span className="text-on-surface font-semibold uppercase">{sim.details.category}</span></span>
                                  <span className="text-on-surface-variant">|</span>
                                  <span className="text-on-surface-variant">Priorité : <span className={`font-semibold uppercase ${sim.details.priority === 'P1' ? 'text-red-500' : sim.details.priority === 'P2' ? 'text-amber-500' : 'text-on-surface'}`}>{sim.details.priority}</span></span>
                                </div>
                                <div className="text-body-sm text-body-sm text-on-surface-variant italic bg-surface-container-low/30 p-sm rounded-xl border border-outline-variant/40 line-clamp-2">
                                  "{sim.details.summary}"
                                </div>
                              </>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {sim.error && (
                        <div className="flex items-center gap-2 text-red-500 font-body-sm text-body-sm border border-red-500/20 bg-red-500/5 p-sm rounded-xl">
                          <span className="material-symbols-outlined text-[16px]">error</span>
                          {sim.error}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </motion.div>

          {/* Timeline ticks */}
          {activePipelines.length > 0 && (
            <motion.div variants={itemVariants} className="w-10 shrink-0 flex flex-col justify-center items-center gap-3 self-center">
              {activePipelines.map((sim) => {
                const isActive = sim.id === activeEmailId;
                let color = 'bg-surface-container-high';
                if (sim.error) color = 'bg-red-500';
                else if (sim.details?.status === 'SPAM') color = 'bg-amber-500';
                else if (sim.percent >= 100) color = 'bg-emerald-500';
                else color = 'bg-primary';

                return (
                  <motion.button
                    key={sim.id}
                    onClick={() => {
                      const card = document.getElementById(`card-${sim.id}`);
                      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      setActiveEmailId(sim.id);
                    }}
                    whileHover={{ scale: 1.3 }}
                    whileTap={{ scale: 0.8 }}
                    className={`rounded-full transition-all duration-200 cursor-pointer ${
                      isActive ? 'w-3 h-3 shadow-lg' : 'w-2 h-2 opacity-40 hover:opacity-80'
                    } ${color}`}
                  />
                );
              })}
            </motion.div>
          )}
        </div>
      )}

      {/* Console prompt */}
      {!loading && bootPhase >= 3 && (
        <motion.div variants={itemVariants} className="flex items-center gap-2 font-mono text-sm text-on-surface-variant">
          <span className="text-primary font-bold">supervision:~$</span>
          <motion.span
            animate={{ opacity: [1, 0] }}
            transition={{ duration: 1, repeat: Infinity }}
            className="w-2 h-4 bg-primary inline-block"
          />
        </motion.div>
      )}

      <div ref={terminalEndRef} />
    </motion.div>
  );
}
