import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import api from '../api/client';
import { useSocket } from '../context/SocketContext';

const PIPELINE_STEPS = [
  { id: 'reception', label: 'Réception', icon: 'mail' },
  { id: 'signature', label: 'Signature', icon: 'ink_eraser' },
  { id: 'antispam', label: 'Anti-Spam', icon: 'shield' },
  { id: 'thread', label: 'Fil', icon: 'link' },
  { id: 'dedup', label: 'Doublon', icon: 'filter_alt' },
  { id: 'intent', label: 'Intention', icon: 'psychology' },
  { id: 'ticket', label: 'Ticket', icon: 'confirmation_number' },
  { id: 'reply', label: 'Réponse', icon: 'auto_awesome' },
  { id: 'finalize', label: 'Final', icon: 'check_circle' },
];

const EVENT_TYPES = {
  ticket_created: { icon: 'add_task', color: '#3B82F6', label: 'Ticket créé' },
  ticket_assigned: { icon: 'person_pin', color: '#8B5CF6', label: 'Ticket assigné' },
  email_received: { icon: 'mail', color: '#F97316', label: 'Email reçu' },
  email_updated: { icon: 'mark_email_read', color: '#10B981', label: 'Email traité' },
};

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
};

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="font-mono text-sm tabular-nums">
      {time.toLocaleTimeString('fr-FR')}
    </span>
  );
}

function Sparkline({ data, color }) {
  if (!data || data.length < 2) return null;
  return (
    <ResponsiveContainer width="100%" height={32}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
        <defs>
          <linearGradient id={`spark-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#spark-${color.replace('#', '')})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function StatusIndicator({ ok, label, detail }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="relative flex h-2.5 w-2.5 shrink-0"
      >
        {ok && (
          <span
            className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
            style={{ backgroundColor: '#10B981' }}
          />
        )}
        <span
          className="relative inline-flex rounded-full h-2.5 w-2.5"
          style={{ backgroundColor: ok ? '#10B981' : '#EF4444' }}
        />
      </span>
      <span className="text-[11px] font-semibold text-white/80">{label}</span>
      {detail && (
        <span className="text-[10px] text-white/40">{detail}</span>
      )}
    </div>
  );
}

function KpiCard({ label, value, icon, color, trend, trendUp, sparkData }) {
  return (
    <motion.div
      variants={itemVariants}
      whileHover={{ y: -2 }}
      className="noc-kpi-card"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">{label}</span>
        <span className="material-symbols-outlined text-[18px]" style={{ color }}>{icon}</span>
      </div>
      <div className="flex items-end justify-between">
        <motion.span
          key={value}
          initial={{ scale: 1.2, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-2xl font-bold tabular-nums"
          style={{ color }}
        >
          {value}
        </motion.span>
        {sparkData && (
          <div className="w-20 h-8">
            <Sparkline data={sparkData} color={color} />
          </div>
        )}
      </div>
      {trend !== undefined && (
        <div className="flex items-center gap-1 mt-1">
          <span
            className="material-symbols-outlined text-[12px]"
            style={{ color: trendUp ? '#10B981' : '#EF4444' }}
          >
            {trendUp ? 'trending_up' : 'trending_down'}
          </span>
          <span
            className="text-[10px] font-semibold"
            style={{ color: trendUp ? '#10B981' : '#EF4444' }}
          >
            {trendUp ? '+' : ''}{trend}%
          </span>
          <span className="text-[10px] text-white/30 ml-1">vs hier</span>
        </div>
      )}
    </motion.div>
  );
}

function EventFeedItem({ event, index }) {
  const meta = EVENT_TYPES[event.type] || { icon: 'info', color: '#94A3B8', label: event.type };
  const timeStr = new Date(event.time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <motion.div
      initial={{ opacity: 0, x: -12, height: 0 }}
      animate={{ opacity: 1, x: 0, height: 'auto' }}
      transition={{ delay: index * 0.02, duration: 0.3 }}
      className="noc-event-item"
    >
      <div className="flex items-center gap-2 shrink-0">
        <span className="material-symbols-outlined text-[14px]" style={{ color: meta.color }}>
          {meta.icon}
        </span>
        <span className="text-[10px] font-mono text-white/30 tabular-nums">{timeStr}</span>
      </div>
      <div className="min-w-0 flex-1">
        <span className="text-[11px] font-semibold text-white/70">{meta.label}</span>
        <span className="text-[11px] text-white/40 ml-2 truncate">
          #{event.id} — {event.title || event.subject || ''}
        </span>
      </div>
      {event.priority && (
        <span
          className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full shrink-0"
          style={{
            color: event.priority === 'P1' ? '#EF4444' : event.priority === 'P2' ? '#F97316' : '#94A3B8',
            backgroundColor: event.priority === 'P1' ? 'rgba(239,68,68,0.12)' : event.priority === 'P2' ? 'rgba(249,115,22,0.12)' : 'rgba(148,163,184,0.08)',
          }}
        >
          {event.priority}
        </span>
      )}
    </motion.div>
  );
}

function PipelineMini({ email, pipelineState }) {
  const state = pipelineState[email.id];
  if (!state) return null;
  const percent = state.percent || 0;
  const isSpam = email.aiIsSpam || email.status === 'SPAM';
  const isError = email.status === 'ERROR';
  const isDone = email.status === 'DONE';

  let barColor = '#3B82F6';
  if (isSpam) barColor = '#F97316';
  else if (isError) barColor = '#EF4444';
  else if (isDone) barColor = '#10B981';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="noc-pipeline-item"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-mono text-white/50 truncate max-w-[70%]">
          <span className="text-blue-400 font-bold">#{email.id}</span>{' '}
          <span className="text-white/70">{email.subject?.slice(0, 50)}</span>
        </span>
        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full" style={{
          color: isSpam ? '#F97316' : isError ? '#EF4444' : isDone ? '#10B981' : '#3B82F6',
          backgroundColor: isSpam ? 'rgba(249,115,22,0.12)' : isError ? 'rgba(239,68,68,0.12)' : isDone ? 'rgba(16,185,129,0.12)' : 'rgba(59,130,246,0.12)',
        }}>
          {isSpam ? 'SPAM' : isError ? 'ERR' : isDone ? 'DONE' : `${percent}%`}
        </span>
      </div>
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.6, ease: 'easeInOut' }}
          className="h-full rounded-full"
          style={{ backgroundColor: barColor }}
        />
      </div>
      <div className="flex gap-1 mt-2 flex-wrap">
        {PIPELINE_STEPS.map((step, idx) => {
          const stepState = state.stepStates?.[idx] || 'pending';
          let bg = 'rgba(255,255,255,0.04)';
          let tc = 'rgba(255,255,255,0.2)';
          if (stepState === 'done') { bg = 'rgba(16,185,129,0.1)'; tc = '#10B981'; }
          else if (stepState === 'running') { bg = 'rgba(59,130,246,0.15)'; tc = '#3B82F6'; }
          else if (stepState === 'failed') { bg = 'rgba(239,68,68,0.1)'; tc = '#EF4444'; }
          return (
            <div
              key={step.id}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px]"
              style={{ backgroundColor: bg, color: tc }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '10px' }}>
                {stepState === 'failed' ? 'cancel' : step.icon}
              </span>
              <span className="hidden md:inline">{step.label}</span>
            </div>
          );
        })}
      </div>
      {email.aiSummary && isDone && (
        <p className="text-[10px] text-white/30 mt-2 line-clamp-1 italic">
          "{email.aiSummary}"
        </p>
      )}
    </motion.div>
  );
}

export default function Supervision() {
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [pipelineStates, setPipelineStates] = useState({});
  const [systemHealth, setSystemHealth] = useState({ daemon: false, ai: false, glpi: false, mail: false });
  const [dashboardStats, setDashboardStats] = useState(null);
  const [accuracyStats, setAccuracyStats] = useState(null);
  const [activityTrend, setActivityTrend] = useState([]);
  const [aiLatency, setAiLatency] = useState(null);
  const [events, setEvents] = useState([]);
  const [bootDone, setBootDone] = useState(false);
  const socket = useSocket();
  const pageLoadTime = useRef(new Date());
  const maxEvents = 50;

  const addEvent = useCallback((type, data) => {
    setEvents(prev => {
      const next = [{ type, time: Date.now(), ...data }, ...prev];
      return next.slice(0, maxEvents);
    });
  }, []);

  useEffect(() => {
    const loadAll = async () => {
      try {
        const [emailRes, dashRes, healthRes, accRes, trendRes, aiRes] = await Promise.allSettled([
          api.get('/inbox?page=1&limit=10'),
          api.get('/dashboard/stats'),
          api.get('/advanced-settings/scheduler-health'),
          api.get('/skills/stats/accuracy?days=30'),
          api.get('/dashboard/activity-trend?days=7'),
          api.get('/ai-providers'),
        ]);

        if (emailRes.status === 'fulfilled') setEmails(emailRes.value.data.items || []);
        if (dashRes.status === 'fulfilled') setDashboardStats(dashRes.value.data);
        if (healthRes.status === 'fulfilled') {
          const schedulers = healthRes.value.data || [];
          setSystemHealth(prev => ({
            ...prev,
            daemon: schedulers.some(s => s.name?.includes('inbox') || s.name?.includes('triage')),
          }));
        }
        if (accRes.status === 'fulfilled') setAccuracyStats(accRes.value.data);
        if (trendRes.status === 'fulfilled') setActivityTrend(trendRes.value.data || []);
        if (aiRes.status === 'fulfilled') {
          const providers = aiRes.value.data || [];
          const active = providers.some(p => p.isActive && p.keys?.some(k => k.isActive));
          setSystemHealth(prev => ({ ...prev, ai: active }));
        }

        setSystemHealth(prev => ({ ...prev, mail: true }));
        setTimeout(() => setBootDone(true), 800);
      } catch {
        setError('Erreur chargement initial');
      } finally {
        setLoading(false);
      }
    };
    loadAll();
  }, []);

  useEffect(() => {
    if (!bootDone) return;
    const interval = setInterval(async () => {
      try {
        const res = await api.get('/inbox?page=1&limit=10');
        setEmails(res.data.items || []);
      } catch { /* retry next interval */ }
    }, 8000);
    return () => clearInterval(interval);
  }, [bootDone]);

  useEffect(() => {
    if (emails.length === 0) return;
    setPipelineStates(prev => {
      const next = { ...prev };
      let updated = false;
      emails.forEach(email => {
        if (!next[email.id]) {
          const isOld = new Date(email.createdAt) < pageLoadTime.current;
          const final = computePipelineState(email);
          next[email.id] = isOld ? final : { ...final, isAnimating: true, activeStepIndex: 0, stepStates: PIPELINE_STEPS.map(() => 'pending') };
          updated = true;
        } else if (!next[email.id].isAnimating) {
          const final = computePipelineState(email);
          if (next[email.id].percent !== final.percent) { next[email.id] = final; updated = true; }
        }
      });
      return updated ? next : prev;
    });
  }, [emails]);

  useEffect(() => {
    const animatingIds = Object.keys(pipelineStates).filter(id => pipelineStates[id].isAnimating);
    if (animatingIds.length === 0) return;
    const interval = setInterval(() => {
      setPipelineStates(prev => {
        const next = { ...prev };
        let updated = false;
        animatingIds.forEach(id => {
          const s = next[id];
          if (!s || !s.isAnimating) return;
          const states = [...s.stepStates];
          if (s.activeStepIndex > 0 && states[s.activeStepIndex - 1] === 'running') states[s.activeStepIndex - 1] = 'done';
          const target = s.targetState || computePipelineState(emails.find(e => e.id === id));
          if (s.activeStepIndex < target.activeStepIndex) {
            states[s.activeStepIndex] = 'running';
            next[id] = { ...s, percent: Math.round(((s.activeStepIndex + 1) / PIPELINE_STEPS.length) * 100), activeStepIndex: s.activeStepIndex + 1, stepStates: states };
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
  }, [pipelineStates, emails]);

  useEffect(() => {
    if (!socket) return;
    const onCreated = (t) => { addEvent('ticket_created', t); refreshStats(); };
    const onAssigned = (d) => { addEvent('ticket_assigned', d); };
    const onEmail = (e) => { addEvent('email_received', e); };
    const onEmailUpd = (e) => { addEvent('email_updated', e); };
    socket.on('ticket_created', onCreated);
    socket.on('ticket_assigned', onAssigned);
    socket.on('email_received', onEmail);
    socket.on('email_updated', onEmailUpd);
    return () => {
      socket.off('ticket_created', onCreated);
      socket.off('ticket_assigned', onAssigned);
      socket.off('email_received', onEmail);
      socket.off('email_updated', onEmailUpd);
    };
  }, [socket, addEvent]);

  useEffect(() => {
    if (!bootDone) return;
    const interval = setInterval(async () => {
      try {
        const res = await api.get('/advanced-settings/scheduler-health');
        const schedulers = res.data || [];
        setSystemHealth(prev => ({
          ...prev,
          daemon: schedulers.some(s => s.name?.includes('inbox') || s.name?.includes('triage')),
        }));
      } catch { /* ignore */ }
    }, 30000);
    return () => clearInterval(interval);
  }, [bootDone]);

  useEffect(() => {
    if (!bootDone) return;
    const interval = setInterval(async () => {
      try {
        const res = await api.post('/ai-providers/keys/test-all').catch(() => null);
        if (res?.data) setAiLatency(res.data);
      } catch { /* ignore */ }
    }, 60000);
    return () => clearInterval(interval);
  }, [bootDone]);

  const refreshStats = async () => {
    try {
      const [dashRes, accRes] = await Promise.allSettled([
        api.get('/dashboard/stats'),
        api.get('/skills/stats/accuracy?days=30'),
      ]);
      if (dashRes.status === 'fulfilled') setDashboardStats(dashRes.value.data);
      if (accRes.status === 'fulfilled') setAccuracyStats(accRes.value.data);
    } catch { /* ignore */ }
  };

  function computePipelineState(email) {
    if (!email) return { percent: 0, activeStepIndex: 0, stepStates: PIPELINE_STEPS.map(() => 'pending') };
    const isSpam = email.aiIsSpam || email.status === 'SPAM';
    const isError = email.status === 'ERROR';
    if (isSpam) {
      const states = PIPELINE_STEPS.map((_, i) => (i <= 1 ? 'done' : i === 2 ? 'failed' : 'skipped'));
      return { percent: 33, activeStepIndex: 2, stepStates: states };
    }
    if (isError) {
      const states = PIPELINE_STEPS.map((_, i) => (i < 6 ? 'done' : i === 6 ? 'failed' : 'skipped'));
      return { percent: 77, activeStepIndex: 6, stepStates: states };
    }
    return { percent: 100, activeStepIndex: PIPELINE_STEPS.length, stepStates: PIPELINE_STEPS.map(() => 'done') };
  }

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.post('/inbox/sync');
      const res = await api.get('/inbox?page=1&limit=10');
      setEmails(res.data.items || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur sync');
    } finally {
      setSyncing(false);
    }
  };

  const kpiData = useMemo(() => {
    const done = emails.filter(e => e.status === 'DONE').length;
    const pending = emails.filter(e => e.status === 'PENDING' || e.status === 'PROCESSING').length;
    const errors = emails.filter(e => e.status === 'ERROR').length;
    const drafts = emails.filter(e => e.aiCategory).length;
    return [
      { label: 'Emails', value: emails.length, icon: 'inbox', color: '#3B82F6', sparkData: activityTrend.map(d => ({ v: d.tickets || 0 })) },
      { label: 'Traités', value: done, icon: 'check_circle', color: '#10B981', sparkData: activityTrend.map(d => ({ v: d.resolved || 0 })) },
      { label: 'En attente', value: pending, icon: 'hourglass_empty', color: '#F97316' },
      { label: 'Erreurs', value: errors, icon: 'error', color: '#EF4444' },
      { label: 'Précision', value: accuracyStats?.accuracy != null ? `${accuracyStats.accuracy}%` : '—', icon: 'psychology', color: '#8B5CF6', trend: null },
      { label: 'Assignations', value: accuracyStats?.totalAssignments || 0, icon: 'group', color: '#06B6D4' },
    ];
  }, [emails, accuracyStats, activityTrend]);

  if (loading) {
    return (
      <div className="noc-container">
        <div className="flex items-center justify-center h-full">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center"
          >
            <div className="noc-radar-container mb-6">
              <svg className="noc-radar" viewBox="0 0 200 200">
                <defs>
                  <radialGradient id="nocRadarGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <circle cx="100" cy="100" r="90" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
                <circle cx="100" cy="100" r="65" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" strokeDasharray="4,4" />
                <circle cx="100" cy="100" r="40" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
                <circle cx="100" cy="100" r="15" fill="url(#nocRadarGlow)" />
                <circle cx="100" cy="100" r="4" fill="#3B82F6" />
                <motion.g
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 4, ease: 'linear' }}
                  style={{ transformOrigin: '100px 100px' }}
                >
                  <line x1="100" y1="100" x2="100" y2="10" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
                </motion.g>
              </svg>
            </div>
            <p className="text-white/60 text-sm font-mono">Initialisation système...</p>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="noc-container">
      {/* ─── HEADER ─── */}
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="noc-header"
      >
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-[22px] text-blue-400">monitor_heart</span>
          <div>
            <h1 className="text-white font-bold text-lg leading-tight">Supervision IA</h1>
            <p className="text-[11px] text-white/30">Command Center — Triage Automatique</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <LiveClock />
          <div className="noc-status-dot-group">
            <span className={`noc-status-dot ${systemHealth.daemon ? 'active' : ''}`} />
            <span className={`noc-status-dot ${systemHealth.ai ? 'active' : ''}`} />
            <span className={`noc-status-dot ${systemHealth.glpi ? 'active' : ''}`} />
          </div>
          <motion.button
            onClick={handleSync}
            disabled={syncing}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="noc-sync-btn"
          >
            <motion.span
              animate={syncing ? { rotate: 360 } : {}}
              transition={syncing ? { repeat: Infinity, duration: 1, ease: 'linear' } : {}}
              className="material-symbols-outlined text-[16px]"
            >
              sync
            </motion.span>
          </motion.button>
        </div>
      </motion.header>

      {/* ─── HEALTH STATUS BAR ─── */}
      <motion.div
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="noc-health-bar"
      >
        <StatusIndicator ok={systemHealth.daemon} label="Daemon" detail="triage" />
        <div className="noc-health-sep" />
        <StatusIndicator ok={systemHealth.ai} label="Gemini" detail={aiLatency?.latencyMs ? `${aiLatency.latencyMs}ms` : ''} />
        <div className="noc-health-sep" />
        <StatusIndicator ok={systemHealth.mail} label="Boîtes mail" />
        <div className="noc-health-sep" />
        <StatusIndicator ok={systemHealth.glpi} label="GLPI" detail="sync" />
      </motion.div>

      {/* ─── KPI ROW ─── */}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.05 } } }}
        className="noc-kpi-grid"
      >
        {kpiData.map(kpi => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </motion.div>

      {/* ─── ERROR ─── */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="noc-error"
          >
            <span className="material-symbols-outlined text-[14px]">error</span>
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── MAIN GRID: EVENTS + PIPELINE ─── */}
      <div className="noc-main-grid">
        {/* EVENT FEED */}
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          className="noc-events-panel"
        >
          <div className="noc-panel-header">
            <span className="material-symbols-outlined text-[14px] text-blue-400">bolt</span>
            <span className="text-[11px] font-bold uppercase tracking-widest text-white/40">Flux événements</span>
            <span className="text-[10px] text-white/20 ml-auto font-mono">{events.length}</span>
          </div>
          <div className="noc-events-list">
            {events.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-8">
                <motion.span
                  animate={{ opacity: [0.3, 0.6, 0.3] }}
                  transition={{ repeat: Infinity, duration: 3 }}
                  className="material-symbols-outlined text-[32px] text-white/10 mb-2"
                >
                  broadcast_on_home
                </motion.span>
                <p className="text-[11px] text-white/20 text-center">En écoute des événements...</p>
                <p className="text-[10px] text-white/10 text-center mt-1">Les events Socket.io apparaîtront ici</p>
              </div>
            ) : (
              events.map((event, i) => (
                <EventFeedItem key={`${event.time}-${i}`} event={event} index={i} />
              ))
            )}
          </div>
        </motion.div>

        {/* PIPELINE */}
        <motion.div
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3 }}
          className="noc-pipeline-panel"
        >
          <div className="noc-panel-header">
            <span className="material-symbols-outlined text-[14px] text-green-400">route</span>
            <span className="text-[11px] font-bold uppercase tracking-widest text-white/40">Pipeline emails</span>
            <span className="text-[10px] text-white/20 ml-auto font-mono">{emails.length}</span>
          </div>
          <div className="noc-pipeline-list">
            {emails.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-8">
                <motion.div
                  animate={{ y: [0, -6, 0] }}
                  transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
                >
                  <span className="material-symbols-outlined text-[40px] text-white/10">mail</span>
                </motion.div>
                <p className="text-[11px] text-white/20 text-center mt-3">Aucun email en pipeline</p>
                <p className="text-[10px] text-white/10 text-center mt-1">Les emails traités apparaîtront ici</p>
              </div>
            ) : (
              emails.map(email => (
                <PipelineMini key={email.id} email={email} pipelineState={pipelineStates} />
              ))
            )}
          </div>
        </motion.div>
      </div>

      {/* ─── BOTTOM: ACCURACY CHART ─── */}
      {accuracyStats && accuracyStats.totalAssignments > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="noc-accuracy-panel"
        >
          <div className="noc-panel-header">
            <span className="material-symbols-outlined text-[14px] text-purple-400">psychology</span>
            <span className="text-[11px] font-bold uppercase tracking-widest text-white/40">Précision IA — 30 jours</span>
          </div>
          <div className="noc-accuracy-content">
            <div className="noc-accuracy-stats">
              <div className="noc-accuracy-stat">
                <span className="text-[10px] text-white/30 uppercase tracking-wider">Assignations</span>
                <span className="text-xl font-bold text-white">{accuracyStats.totalAssignments}</span>
              </div>
              <div className="noc-accuracy-stat">
                <span className="text-[10px] text-white/30 uppercase tracking-wider">Auto IA</span>
                <span className="text-xl font-bold text-blue-400">{accuracyStats.autoAssigned}</span>
              </div>
              <div className="noc-accuracy-stat">
                <span className="text-[10px] text-white/30 uppercase tracking-wider">Corrigées</span>
                <span className="text-xl font-bold text-amber-400">{accuracyStats.corrected}</span>
              </div>
              <div className="noc-accuracy-stat">
                <span className="text-[10px] text-white/30 uppercase tracking-wider">Précision</span>
                <span className="text-xl font-bold" style={{
                  color: accuracyStats.accuracy >= 80 ? '#10B981' : accuracyStats.accuracy >= 50 ? '#F97316' : '#EF4444'
                }}>
                  {accuracyStats.accuracy != null ? `${accuracyStats.accuracy}%` : '—'}
                </span>
              </div>
            </div>
            {accuracyStats.dailyStats?.length > 0 && (
              <div className="noc-accuracy-chart">
                <ResponsiveContainer width="100%" height={100}>
                  <AreaChart data={accuracyStats.dailyStats.slice(-14)} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                    <defs>
                      <linearGradient id="accGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="total" stroke="#8B5CF6" strokeWidth={1.5} fill="url(#accGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ─── FOOTER ─── */}
      <div className="noc-footer">
        <span className="material-symbols-outlined text-[12px] text-blue-400/50">terminal</span>
        <span className="font-mono text-[11px] text-white/15">
          supervision:~$ <motion.span animate={{ opacity: [1, 0] }} transition={{ repeat: Infinity, duration: 1 }} className="inline-block w-1.5 h-3 bg-blue-400/40 align-middle" />
        </span>
      </div>
    </div>
  );
}
