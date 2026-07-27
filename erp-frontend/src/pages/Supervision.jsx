import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AreaChart, Area, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import api from '../api/client';
import { useSocket } from '../context/SocketContext';
import { useTheme } from '../context/ThemeContext';
import { Activity, Radio, CheckCircle2, Clock, Brain, AlertTriangle, RefreshCw, Bolt, TrendingUp, Terminal, X, ShieldAlert } from 'lucide-react';

const EVENT_TYPES = {
  ticket_created: { icon: 'add_task', color: '#2563EB', label: 'Ticket créé' },
  ticket_assigned: { icon: 'person_pin', color: '#7C3AED', label: 'Assigné' },
  email_received: { icon: 'mail', color: '#EA580C', label: 'Email reçu' },
  email_updated: { icon: 'mark_email_read', color: '#059669', label: 'Email traité' },
};

function AnimatedNumber({ value, color }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const num = typeof value === 'number' ? value : parseInt(value) || 0;
    const diff = num - display;
    if (diff === 0) return;
    const duration = 300;
    const steps = Math.min(30, Math.abs(diff));
    const step = diff / steps;
    const interval = duration / steps;
    let current = display;
    let count = 0;
    const timer = setInterval(() => {
      count++;
      if (count >= steps) { current = num; clearInterval(timer); }
      else { current += step; }
      setDisplay(Math.round(current));
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
        style={{ backgroundColor: active ? color : '#94A3B8' }}
      />
    </span>
  );
}

function StatusChip({ label, ok, detail }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-outline-variant/30 bg-surface-container"
    >
      <PulseRing active={ok} color={ok ? '#10B981' : '#EF4444'} />
      <span className="text-[11px] font-bold text-on-surface">{label}</span>
      {detail && <span className="text-[10px] text-on-surface-variant font-medium">{detail}</span>}
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
      className="font-mono text-sm tabular-nums text-on-surface font-semibold bg-surface-container px-3 py-1.5 rounded-xl border border-outline-variant/30"
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
      className="p-4 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm group"
      style={{ borderTop: `3px solid ${color}` }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-black uppercase tracking-wider text-on-surface-variant">{label}</span>
        <motion.div
          whileHover={{ rotate: 15, scale: 1.15 }}
          className="w-7 h-7 rounded-xl flex items-center justify-center"
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
            className="text-2xl font-bold tabular-nums leading-none text-on-surface"
          >
            {typeof value === 'number' ? <AnimatedNumber value={value} color={color} /> : value}
          </motion.span>
          {suffix && <span className="text-[11px] text-on-surface-variant font-medium ml-1">{suffix}</span>}
        </div>
        {sparkData && (
          <div className="w-16 h-7 opacity-70 group-hover:opacity-100 transition-opacity">
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
          <span className="text-[9px] text-on-surface-variant ml-0.5">vs hier</span>
        </motion.div>
      )}
    </motion.div>
  );
}

function EventItem({ event, index }) {
  const meta = EVENT_TYPES[event.type] || { icon: 'info', color: '#2563EB', label: event.type };
  const ts = new Date(event.time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -20, height: 0 }}
      animate={{ opacity: 1, x: 0, height: 'auto' }}
      exit={{ opacity: 0, x: 20, height: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25, delay: index * 0.03 }}
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-container-low/60 transition-colors border-b border-outline-variant/10"
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
        <span className="text-[10px] font-mono text-on-surface-variant font-semibold tabular-nums">{ts}</span>
      </div>
      <div className="min-w-0 flex-1">
        <span className="text-[11px] font-bold" style={{ color: meta.color }}>{meta.label}</span>
        <span className="text-[11px] text-on-surface ml-1.5 truncate inline-block max-w-[200px]">
          #{event.id} {event.title || event.subject || ''}
        </span>
      </div>
      {event.priority && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full shrink-0 border"
          style={{
            color: event.priority === 'P1' ? '#DC2626' : event.priority === 'P2' ? '#EA580C' : '#64748B',
            borderColor: event.priority === 'P1' ? 'rgba(220,38,38,0.25)' : event.priority === 'P2' ? 'rgba(234,88,12,0.25)' : 'rgba(100,116,139,0.25)',
            backgroundColor: event.priority === 'P1' ? 'rgba(220,38,38,0.1)' : event.priority === 'P2' ? 'rgba(234,88,12,0.1)' : 'rgba(100,116,139,0.1)',
          }}
        >
          {event.priority}
        </motion.span>
      )}
    </motion.div>
  );
}

function TrendBar({ data, label, color }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  if (!data || data.length === 0) return null;
  return (
    <div className="rounded-2xl border border-outline-variant/30 p-4 bg-surface-container-low/20">
      <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-2">{label}</p>
      <ResponsiveContainer width="100%" height={100}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 9, fill: isDark ? 'rgba(255,255,255,0.4)' : '#64748b' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(d) => d?.slice(5)}
          />
          <Tooltip
            contentStyle={{
              background: isDark ? '#0A0E1A' : '#FFFFFF',
              border: '1px solid rgba(148,163,184,0.3)',
              borderRadius: 12,
              fontSize: 11,
              color: isDark ? '#FFFFFF' : '#070D19',
              boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)',
            }}
          />
          <Bar dataKey="tickets" fill={color} radius={[3, 3, 0, 0]} opacity={0.8} />
          <Bar dataKey="resolved" fill="#10B981" radius={[3, 3, 0, 0]} opacity={0.9} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Supervision() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
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

  const stats = useMemo(() => {
    const total = emails.length;
    const done = emails.filter(e => e.status === 'DONE').length;
    const pending = emails.filter(e => e.status === 'PENDING' || e.status === 'PROCESSING').length;
    const errors = emails.filter(e => e.status === 'ERROR').length;
    const retries = emails.filter(e => e.status === 'RETRY').length;
    const deadLetters = emails.filter(e => e.status === 'DEAD_LETTER').length;
    const spam = emails.filter(e => e.status === 'SPAM' || e.aiIsSpam).length;
    const aiProcessed = emails.filter(e => e.aiCategory).length;
    const accuracy = accuracyStats?.accuracy ?? null;
    const totalAssign = accuracyStats?.totalAssignments ?? 0;
    const tickets = dashboardStats?.total ?? 0;
    const openTickets = dashboardStats?.open ?? 0;
    return { total, done, pending, errors, retries, deadLetters, spam, aiProcessed, accuracy, totalAssign, tickets, openTickets };
  }, [emails, accuracyStats, dashboardStats]);

  const globalStatus = useMemo(() => {
    if (stats.errors > 0 || !systemHealth.daemon) return { level: 'critical', label: 'ALERTE', color: '#EF4444' };
    if (stats.pending > 2 || !systemHealth.ai) return { level: 'warning', label: 'ATTENTION', color: '#EA580C' };
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
          <div className="relative w-24 h-24 mx-auto mb-4">
            <div className="w-full h-full rounded-full border-4 border-blue-500/20 border-t-blue-500 animate-spin" />
          </div>
          <p className="text-xs font-bold text-on-surface-variant">Initialisation du système de supervision...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="max-w-full mx-auto w-full space-y-6 px-4 sm:px-6 lg:px-8 min-w-0 pt-4 sm:pt-6 pb-8 min-h-screen">
      {/* Hero Header SEVEN-T */}
      <div className="p-6 sm:p-8 rounded-2xl sm:rounded-3xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-blue-500/10 rounded-xl">
                <Activity className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-display font-bold truncate text-on-surface">Supervision IA</h1>
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold uppercase tracking-wider animate-pulse border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {globalStatus.label}
              </span>
            </div>
            <p className="text-sm sm:text-base text-on-surface-variant font-medium">Centre de contrôle temps réel du triage IA et santé du système.</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <LiveClock />
            <motion.button
              onClick={handleSync}
              disabled={syncing}
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-xs flex items-center gap-2 shadow-md shadow-blue-500/20 disabled:opacity-50 transition-all cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Syncing...' : 'Sync'}</span>
            </motion.button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-6">
          <StatusChip label="Daemon" ok={systemHealth.daemon} />
          <StatusChip label="Gemini IA" ok={systemHealth.ai} />
          <StatusChip label="Boîtes mail" ok={systemHealth.mail} />
          <StatusChip label="GLPI Sync" ok={systemHealth.glpi} />
        </div>
      </div>

      {/* ═══ KPI GRID ═══ */}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3"
      >
        <KpiCard label="Tickets" value={stats.tickets} prevValue={null} icon="confirmation_number" color="#2563EB" sparkData={sparkTrend} />
        <KpiCard label="Ouverts" value={stats.openTickets} prevValue={null} icon="radio_button_checked" color="#EA580C" />
        <KpiCard label="Emails traités" value={stats.done} prevValue={null} icon="check_circle" color="#059669" sparkData={sparkResolved} />
        <KpiCard label="En attente" value={stats.pending} prevValue={null} icon="hourglass_empty" color="#D97706" />
        <KpiCard label="Précision IA" value={stats.accuracy != null ? `${stats.accuracy}%` : '—'} prevValue={null} icon="psychology" color="#7C3AED" suffix={stats.totalAssign > 0 ? `(${stats.totalAssign} assig.)` : ''} />
        <KpiCard label="Erreurs" value={stats.errors} prevValue={null} icon="error" color="#DC2626" />
        <KpiCard label="Réessais" value={stats.retries} prevValue={null} icon="autorenew" color="#D97706" />
        <KpiCard label="Abandonnés" value={stats.deadLetters} prevValue={null} icon="report_problem" color="#B91C1C" />
      </motion.div>

      {/* ═══ ERROR ═══ */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-bold flex items-center gap-2"
          >
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"><X className="w-4 h-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ MAIN: EVENTS + TRENDS ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LIVE EVENT FEED */}
        <motion.div
          initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5 shadow-sm space-y-4"
        >
          <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
            <div className="flex items-center gap-2">
              <Bolt className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-wider text-on-surface">Flux temps réel</span>
            </div>
            <span className="text-[10px] font-mono font-bold text-on-surface-variant">{events.length} évènement(s)</span>
          </div>

          <div className="divide-y divide-outline-variant/10 max-h-[380px] overflow-y-auto pr-1">
            <AnimatePresence initial={false}>
              {events.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-on-surface-variant gap-2">
                  <Activity className="w-8 h-8 text-outline/30 animate-bounce" />
                  <p className="text-xs italic">En écoute des événements temps réel...</p>
                </div>
              ) : (
                events.map((ev, i) => <EventItem key={`${ev.time}-${i}`} event={ev} index={i} />)
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* TRENDS PANEL */}
        <motion.div
          initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3 }}
          className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5 shadow-sm space-y-4"
        >
          <div className="flex items-center gap-2 border-b border-outline-variant/20 pb-3">
            <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-on-surface">Tendances & Métriques</span>
          </div>

          <div className="space-y-4">
            <TrendBar data={activityTrend} label="Tickets créés vs résolus" color="#2563EB" />

            {accuracyStats?.dailyStats?.length > 0 && (
              <div className="rounded-2xl border border-outline-variant/30 p-4 bg-surface-container-low/20">
                <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-2">Précision IA — 14 jours</p>
                <ResponsiveContainer width="100%" height={90}>
                  <AreaChart data={accuracyStats.dailyStats.slice(-14)} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="accGrad2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#7C3AED" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#7C3AED" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 9, fill: isDark ? 'rgba(255,255,255,0.4)' : '#64748b' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(d) => d?.slice(5)}
                    />
                    <Area type="monotone" dataKey="total" stroke="#7C3AED" strokeWidth={1.5} fill="url(#accGrad2)" dot={false} animationDuration={800} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* ═══ FOOTER ═══ */}
      <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-container-low/40 border border-outline-variant/20 text-on-surface-variant text-[11px] font-mono">
        <Terminal className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
        <span>supervision:~$ active</span>
      </div>
    </div>
  );
}
