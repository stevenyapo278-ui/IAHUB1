import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { AreaChart, Area, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import api from '../api/client';
import { useSocket } from '../context/SocketContext';

const EVENT_TYPES = {
  ticket_created: { icon: 'add_task', color: '#3B82F6', label: 'Ticket créé' },
  ticket_assigned: { icon: 'person_pin', color: '#8B5CF6', label: 'Assigné' },
  email_received: { icon: 'mail', color: '#F97316', label: 'Email reçu' },
  email_updated: { icon: 'mark_email_read', color: '#10B981', label: 'Email traité' },
};

/* ═══════════════════════════════════════════════════════════════════════════════ */
/* ANIMATED COMPONENTS                                                           */
/* ═══════════════════════════════════════════════════════════════════════════════ */

function AnimatedNumber({ value, color }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const num = typeof value === 'number' ? value : parseInt(value) || 0;
    const diff = num - display;
    if (diff === 0) return;
    const step = diff > 0 ? 1 : -1;
    const steps = Math.abs(diff);
    const interval = Math.max(20, Math.min(60, 300 / steps));
    let current = display;
    const timer = setInterval(() => {
      current += step;
      if ((step > 0 && current >= num) || (step < 0 && current <= num)) {
        current = num;
        clearInterval(timer);
      }
      setDisplay(current);
    }, interval);
    return () => clearInterval(timer);
  }, [value]);
  return <span style={{ color }}>{display}</span>;
}

function PulseRing({ active, color = '#10B981' }) {
  return (
    <span className="relative flex h-3 w-3 shrink-0">
      {active && (
        <motion.span
          animate={{ scale: [1, 2.2], opacity: [0.6, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
          className="absolute inline-flex h-full w-full rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      <span
        className="relative inline-flex rounded-full h-3 w-3"
        style={{ backgroundColor: active ? color : '#52525b' }}
      />
    </span>
  );
}

function StatusChip({ label, ok, detail }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
      style={{ background: ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)' }}
    >
      <PulseRing active={ok} color={ok ? '#10B981' : '#EF4444'} />
      <span className="text-[11px] font-semibold text-white/80">{label}</span>
      {detail && <span className="text-[10px] text-white/35">{detail}</span>}
    </motion.div>
  );
}

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <motion.span
      key={time.getSeconds()}
      initial={{ opacity: 0.7 }}
      animate={{ opacity: 1 }}
      className="font-mono text-sm tabular-nums text-white/70"
    >
      {time.toLocaleTimeString('fr-FR')}
    </motion.span>
  );
}

function Sparkline({ data, color, height = 28 }) {
  if (!data || data.length < 2) return null;
  const id = `sp-${color.replace('#', '')}-${Math.random().toString(36).slice(2, 6)}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${id})`}
          dot={false}
          isAnimationActive={true}
          animationDuration={800}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function KpiCard({ label, value, prevValue, icon, color, sparkData, suffix = '' }) {
  const trend = prevValue != null && prevValue !== 0
    ? Math.round(((value - prevValue) / prevValue) * 100)
    : null;
  const trendUp = trend !== null && trend >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      whileHover={{ y: -3, scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 200, damping: 20 }}
      className="noc-kpi-card group"
      style={{ borderTop: `2px solid ${color}20` }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/35">{label}</span>
        <motion.div
          whileHover={{ rotate: 15, scale: 1.15 }}
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${color}15` }}
        >
          <span className="material-symbols-outlined text-[16px]" style={{ color }}>{icon}</span>
        </motion.div>
      </div>
      <div className="flex items-end justify-between">
        <div>
          <motion.span
            key={value}
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="text-2xl font-bold tabular-nums leading-none"
            style={{ color }}
          >
            {typeof value === 'number' ? <AnimatedNumber value={value} color={color} /> : value}
          </motion.span>
          {suffix && <span className="text-[11px] text-white/30 ml-1">{suffix}</span>}
        </div>
        {sparkData && (
          <div className="w-16 h-7 opacity-60 group-hover:opacity-100 transition-opacity">
            <Sparkline data={sparkData} color={color} height={28} />
          </div>
        )}
      </div>
      {trend !== null && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="flex items-center gap-1 mt-2"
        >
          <span className="material-symbols-outlined text-[11px]" style={{ color: trendUp ? '#10B981' : '#EF4444' }}>
            {trendUp ? 'trending_up' : 'trending_down'}
          </span>
          <span className="text-[10px] font-semibold" style={{ color: trendUp ? '#10B981' : '#EF4444' }}>
            {trendUp ? '+' : ''}{trend}%
          </span>
          <span className="text-[9px] text-white/20 ml-0.5">vs hier</span>
        </motion.div>
      )}
    </motion.div>
  );
}

function EventItem({ event, index }) {
  const meta = EVENT_TYPES[event.type] || { icon: 'info', color: '#94A3B8', label: event.type };
  const ts = new Date(event.time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -20, height: 0 }}
      animate={{ opacity: 1, x: 0, height: 'auto' }}
      exit={{ opacity: 0, x: 20, height: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25, delay: index * 0.03 }}
      className="noc-event-row"
    >
      <div className="flex items-center gap-2 shrink-0 w-20">
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, delay: index * 0.03 + 0.1 }}
          className="material-symbols-outlined text-[13px]"
          style={{ color: meta.color }}
        >
          {meta.icon}
        </motion.span>
        <span className="text-[10px] font-mono text-white/25 tabular-nums">{ts}</span>
      </div>
      <div className="min-w-0 flex-1">
        <span className="text-[11px] font-semibold" style={{ color: meta.color }}>{meta.label}</span>
        <span className="text-[11px] text-white/35 ml-1.5 truncate inline-block max-w-[180px]">
          #{event.id} {event.title || event.subject || ''}
        </span>
      </div>
      {event.priority && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full shrink-0"
          style={{
            color: event.priority === 'P1' ? '#EF4444' : event.priority === 'P2' ? '#F97316' : '#94A3B8',
            backgroundColor: event.priority === 'P1' ? 'rgba(239,68,68,0.12)' : event.priority === 'P2' ? 'rgba(249,115,22,0.12)' : 'rgba(148,163,184,0.06)',
          }}
        >
          {event.priority}
        </motion.span>
      )}
    </motion.div>
  );
}

function TrendBar({ data, label, color }) {
  if (!data || data.length === 0) return null;
  return (
    <div className="noc-trend-block">
      <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-2">{label}</p>
      <ResponsiveContainer width="100%" height={90}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.2)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(d) => d?.slice(5)}
          />
          <Tooltip
            contentStyle={{
              background: '#1a1e30',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              fontSize: 11,
              color: '#e2e8f0',
            }}
          />
          <Bar dataKey="tickets" fill={color} radius={[3, 3, 0, 0]} opacity={0.7} />
          <Bar dataKey="resolved" fill="#10B981" radius={[3, 3, 0, 0]} opacity={0.9} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════ */
/* MAIN COMPONENT                                                                */
/* ═══════════════════════════════════════════════════════════════════════════════ */

export default function Supervision() {
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [systemHealth, setSystemHealth] = useState({ daemon: false, ai: false, glpi: false, mail: false });
  const [accuracyStats, setAccuracyStats] = useState(null);
  const [activityTrend, setActivityTrend] = useState([]);
  const [dashboardStats, setDashboardStats] = useState(null);
  const [events, setEvents] = useState([]);
  const [bootDone, setBootDone] = useState(false);
  const socket = useSocket();
  const maxEvents = 30;

  const addEvent = useCallback((type, data) => {
    setEvents(prev => [{ type, time: Date.now(), ...data }, ...prev].slice(0, maxEvents));
  }, []);

  /* ── Data Loading ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    const loadAll = async () => {
      try {
        const results = await Promise.allSettled([
          api.get('/inbox?page=1&limit=100'),
          api.get('/dashboard/stats'),
          api.get('/dashboard/activity-trend?days=7'),
          api.get('/skills/stats/accuracy?days=30'),
          api.get('/advanced-settings/scheduler-health'),
          api.get('/ai-providers'),
        ]);
        const [inbox, dash, trend, acc, health, ai] = results;
        if (inbox.status === 'fulfilled') setEmails(inbox.value.data.items || []);
        if (dash.status === 'fulfilled') setDashboardStats(dash.value.data);
        if (trend.status === 'fulfilled') setActivityTrend(trend.value.data || []);
        if (acc.status === 'fulfilled') setAccuracyStats(acc.value.data);
        if (health.status === 'fulfilled') {
          const schedulers = health.value.data || [];
          setSystemHealth(prev => ({ ...prev, daemon: schedulers.length > 0 }));
        }
        if (ai.status === 'fulfilled') {
          const providers = ai.value.data || [];
          setSystemHealth(prev => ({ ...prev, ai: providers.some(p => p.isActive) }));
        }
        setSystemHealth(prev => ({ ...prev, mail: true }));
        setTimeout(() => setBootDone(true), 600);
      } catch { setError('Erreur chargement'); }
      finally { setLoading(false); }
    };
    loadAll();
  }, []);

  /* ── Auto-refresh ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!bootDone) return;
    const id = setInterval(async () => {
      try {
        const [inboxRes, dashRes] = await Promise.allSettled([
          api.get('/inbox?page=1&limit=100'),
          api.get('/dashboard/stats'),
        ]);
        if (inboxRes.status === 'fulfilled') setEmails(inboxRes.value.data.items || []);
        if (dashRes.status === 'fulfilled') setDashboardStats(dashRes.value.data);
      } catch { /* next interval */ }
    }, 8000);
    return () => clearInterval(id);
  }, [bootDone]);

  /* ── Socket Events ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!socket) return;
    const handlers = {
      ticket_created: (t) => addEvent('ticket_created', t),
      ticket_assigned: (d) => addEvent('ticket_assigned', d),
      email_received: (e) => addEvent('email_received', e),
      email_updated: (e) => addEvent('email_updated', e),
    };
    Object.entries(handlers).forEach(([ev, fn]) => socket.on(ev, fn));
    return () => Object.entries(handlers).forEach(([ev, fn]) => socket.off(ev, fn));
  }, [socket, addEvent]);

  /* ── Computed Stats ────────────────────────────────────────────────────────── */
  const stats = useMemo(() => {
    const total = emails.length;
    const done = emails.filter(e => e.status === 'DONE').length;
    const pending = emails.filter(e => e.status === 'PENDING' || e.status === 'PROCESSING').length;
    const errors = emails.filter(e => e.status === 'ERROR').length;
    const spam = emails.filter(e => e.status === 'SPAM' || e.aiIsSpam).length;
    const aiProcessed = emails.filter(e => e.aiCategory).length;
    const accuracy = accuracyStats?.accuracy ?? null;
    const totalAssign = accuracyStats?.totalAssignments ?? 0;
    const tickets = dashboardStats?.total ?? 0;
    const openTickets = dashboardStats?.open ?? 0;
    return { total, done, pending, errors, spam, aiProcessed, accuracy, totalAssign, tickets, openTickets };
  }, [emails, accuracyStats, dashboardStats]);

  const globalStatus = useMemo(() => {
    if (stats.errors > 0 || !systemHealth.daemon) return { level: 'critical', label: 'ALERTE', color: '#EF4444' };
    if (stats.pending > 2 || !systemHealth.ai) return { level: 'warning', label: 'ATTENTION', color: '#F97316' };
    return { level: 'ok', label: 'OPERATIONNEL', color: '#10B981' };
  }, [stats, systemHealth]);

  const sparkTrend = useMemo(() => activityTrend.map(d => ({ v: d.tickets || 0 })), [activityTrend]);
  const sparkResolved = useMemo(() => activityTrend.map(d => ({ v: d.resolved || 0 })), [activityTrend]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.post('/inbox/sync');
      const res = await api.get('/inbox?page=1&limit=100');
      setEmails(res.data.items || []);
    } catch (err) { setError(err.response?.data?.error || 'Erreur sync'); }
    finally { setSyncing(false); }
  };

  /* ── Loading Screen ────────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="noc-container">
        <div className="flex items-center justify-center h-[80vh]">
          <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
            <div className="relative w-32 h-32 mx-auto mb-6">
              <svg viewBox="0 0 120 120" className="w-full h-full">
                <defs>
                  <radialGradient id="loadGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <circle cx="60" cy="60" r="55" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                <circle cx="60" cy="60" r="40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" strokeDasharray="3,3" />
                <circle cx="60" cy="60" r="12" fill="url(#loadGlow)" />
                <motion.circle
                  cx="60" cy="60" r="4"
                  fill="#3B82F6"
                  animate={{ scale: [1, 1.4, 1] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                />
                <motion.g
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 3, ease: 'linear' }}
                  style={{ transformOrigin: '60px 60px' }}
                >
                  <line x1="60" y1="60" x2="60" y2="5" stroke="#3B82F6" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
                </motion.g>
              </svg>
            </div>
            <motion.p
              animate={{ opacity: [0.4, 0.8, 0.4] }}
              transition={{ repeat: Infinity, duration: 2 }}
              className="text-white/40 text-xs font-mono"
            >
              Initialisation système...
            </motion.p>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="noc-container">
      {/* ═══ HEADER ═══ */}
      <motion.header
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 150, damping: 20 }}
        className="noc-header"
      >
        <div className="flex items-center gap-3">
          <motion.div
            animate={{ rotate: [0, 5, -5, 0] }}
            transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
          >
            <span className="material-symbols-outlined text-[22px] text-blue-400">monitor_heart</span>
          </motion.div>
          <div>
            <h1 className="text-white font-bold text-lg leading-tight">Supervision IA</h1>
            <p className="text-[11px] text-white/25">Command Center — Triage Automatique</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <LiveClock />
          <motion.button
            onClick={handleSync}
            disabled={syncing}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            className="noc-sync-btn"
          >
            <motion.span
              animate={syncing ? { rotate: 360 } : {}}
              transition={syncing ? { repeat: Infinity, duration: 0.8, ease: 'linear' } : {}}
              className="material-symbols-outlined text-[16px]"
            >
              sync
            </motion.span>
          </motion.button>
        </div>
      </motion.header>

      {/* ═══ STATUS BAR ═══ */}
      <motion.div
        initial={{ opacity: 0, scaleX: 0.95 }}
        animate={{ opacity: 1, scaleX: 1 }}
        transition={{ delay: 0.1, type: 'spring', stiffness: 150 }}
        className="noc-status-bar"
        style={{ borderLeft: `3px solid ${globalStatus.color}` }}
      >
        <div className="flex items-center gap-3">
          <PulseRing active={globalStatus.level === 'ok'} color={globalStatus.color} />
          <span className="text-sm font-bold" style={{ color: globalStatus.color }}>{globalStatus.label}</span>
        </div>
        <div className="noc-health-chips">
          <StatusChip label="Daemon" ok={systemHealth.daemon} />
          <StatusChip label="Gemini" ok={systemHealth.ai} />
          <StatusChip label="Boîtes mail" ok={systemHealth.mail} />
          <StatusChip label="GLPI" ok={systemHealth.glpi} />
        </div>
      </motion.div>

      {/* ═══ KPI GRID ═══ */}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
        className="noc-kpi-grid"
      >
        <KpiCard label="Tickets" value={stats.tickets} prevValue={null} icon="confirmation_number" color="#3B82F6" sparkData={sparkTrend} />
        <KpiCard label="Ouverts" value={stats.openTickets} prevValue={null} icon="radio_button_checked" color="#F97316" />
        <KpiCard label="Emails traités" value={stats.done} prevValue={null} icon="check_circle" color="#10B981" sparkData={sparkResolved} />
        <KpiCard label="En attente" value={stats.pending} prevValue={null} icon="hourglass_empty" color="#EAB308" />
        <KpiCard label="Précision IA" value={stats.accuracy != null ? `${stats.accuracy}%` : '—'} prevValue={null} icon="psychology" color="#8B5CF6" suffix={stats.totalAssign > 0 ? `(${stats.totalAssign} assig.)` : ''} />
        <KpiCard label="Erreurs" value={stats.errors} prevValue={null} icon="error" color="#EF4444" />
      </motion.div>

      {/* ═══ ERROR ═══ */}
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
            <button onClick={() => setError(null)} className="ml-auto text-white/40 hover:text-white/70">
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ MAIN: EVENTS + TRENDS ═══ */}
      <div className="noc-main-grid">
        {/* LIVE EVENT FEED */}
        <motion.div
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 120 }}
          className="noc-events-panel"
        >
          <div className="noc-panel-header">
            <div className="flex items-center gap-2">
              <motion.span
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ repeat: Infinity, duration: 2 }}
                className="material-symbols-outlined text-[14px] text-blue-400"
              >
                bolt
              </motion.span>
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/35">Flux temps réel</span>
            </div>
            <motion.span
              key={events.length}
              initial={{ scale: 1.3 }}
              animate={{ scale: 1 }}
              className="text-[10px] font-mono text-white/20"
            >
              {events.length} events
            </motion.span>
          </div>
          <div className="noc-events-scroll">
            <AnimatePresence initial={false}>
              {events.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center py-12"
                >
                  <motion.div
                    animate={{ y: [0, -8, 0], opacity: [0.2, 0.5, 0.2] }}
                    transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
                  >
                    <span className="material-symbols-outlined text-[40px] text-white/10">broadcast_on_home</span>
                  </motion.div>
                  <p className="text-[11px] text-white/15 mt-3">En écoute des événements...</p>
                </motion.div>
              ) : (
                events.map((ev, i) => <EventItem key={`${ev.time}-${i}`} event={ev} index={i} />)
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* TRENDS PANEL */}
        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3, type: 'spring', stiffness: 120 }}
          className="noc-trends-panel"
        >
          <div className="noc-panel-header">
            <span className="material-symbols-outlined text-[14px] text-emerald-400">show_chart</span>
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/35">Tendances 7 jours</span>
          </div>
          <div className="noc-trends-content">
            <TrendBar data={activityTrend} label="Tickets créés vs résolus" color="#3B82F6" />
            {/* AI Accuracy mini chart */}
            {accuracyStats?.dailyStats?.length > 0 && (
              <div className="noc-trend-block">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-2">Précision IA — 14 jours</p>
                <ResponsiveContainer width="100%" height={90}>
                  <AreaChart data={accuracyStats.dailyStats.slice(-14)} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="accGrad2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.2)' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(d) => d?.slice(5)}
                    />
                    <Area type="monotone" dataKey="total" stroke="#8B5CF6" strokeWidth={1.5} fill="url(#accGrad2)" dot={false} animationDuration={800} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* ═══ FOOTER ═══ */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="noc-footer"
      >
        <span className="material-symbols-outlined text-[12px] text-blue-400/30">terminal</span>
        <span className="font-mono text-[11px] text-white/12">
          supervision:~${' '}
          <motion.span
            animate={{ opacity: [1, 0] }}
            transition={{ repeat: Infinity, duration: 0.8 }}
            className="inline-block w-1.5 h-3 bg-blue-400/30 align-middle"
          />
        </span>
      </motion.div>
    </div>
  );
}
