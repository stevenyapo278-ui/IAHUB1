import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useNotifications } from '../context/NotificationContext';
import {
  Bell, Inbox as InboxIcon, UserPlus, RefreshCw, AlertTriangle, TrendingUp,
  Check, CheckCheck, X, Flame, Zap
} from 'lucide-react';

// ── Configuration par type de notification ─────────────────────────────────
const TYPE_CONFIG = {
  ticket_created:   { label: 'Nouveau ticket', icon: InboxIcon,       chip: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' },
  ticket_assigned:  { label: 'Assignation',    icon: UserPlus,        chip: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20' },
  ticket_updated:   { label: 'Mise à jour',    icon: RefreshCw,       chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
  sla_breached:     { label: 'SLA dépassé',    icon: AlertTriangle,   chip: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' },
  ticket_escalated: { label: 'Escalade',       icon: TrendingUp,      chip: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20' },
};

const DEFAULT_TYPE_CONFIG = {
  label: 'Notification',
  icon: Bell,
  chip: 'bg-surface-container text-on-surface-variant border-outline-variant/30',
};

// Priorités (badge sur les notifications de ticket)
const PRIORITY_CONFIG = {
  P1: { label: 'P1', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10 border-red-500/25' },
  P2: { label: 'P2', color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500/10 border-orange-500/25' },
  P3: { label: 'P3', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10 border-amber-500/25' },
  P4: { label: 'P4', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10 border-blue-500/25' },
};

function formatTimeAgo(dateString) {
  const now = Date.now();
  const date = new Date(dateString).getTime();
  const diffSec = Math.floor((now - date) / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 10) return "À l'instant";
  if (diffSec < 60) return `Il y a ${diffSec}s`;
  if (diffMin < 60) return `Il y a ${diffMin}min`;
  if (diffHour < 24) return `Il y a ${diffHour}h`;
  if (diffDay < 7) return `Il y a ${diffDay}j`;
  return new Date(dateString).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// Libellés de groupe par jour
function dayLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Hier';
  if (diff < 7) return d.toLocaleDateString('fr-FR', { weekday: 'long' });
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Extrait le numéro de ticket d'un lien "/tickets/123"
function ticketIdFromLink(link) {
  if (!link) return null;
  const m = String(link).match(/\/tickets\/(\d+)/);
  return m ? Number(m[1]) : null;
}

export default function NotificationPanel({ open, onClose }) {
  const { notifications, unreadCount, hasMore, loadMore, markAsRead, markAllAsRead } = useNotifications();
  const navigate = useNavigate();
  const panelRef = useRef(null);
  const scrollRef = useRef(null);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [filter, setFilter] = useState('all'); // all | unread

  // Fermeture au clic à l'extérieur
  useEffect(() => {
    function handleClickOutside(event) {
      if (panelRef.current && !panelRef.current.contains(event.target)) {
        onClose();
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, onClose]);

  // Détection du scroll pour la pagination
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore) return;

    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (isNearBottom && !scrolledToBottom) {
      setScrolledToBottom(true);
      loadMore();
    } else if (!isNearBottom) {
      setScrolledToBottom(false);
    }
  }, [hasMore, loadMore, scrolledToBottom]);

  // Traitement des notifications groupées par date
  const handleNotifClick = (notif) => {
    if (!notif.isRead) {
      markAsRead(notif.id);
    }
    if (notif.link) {
      navigate(notif.link);
    }
    onClose();
  };

  const handleMarkOneRead = (e, notif) => {
    e.stopPropagation();
    markAsRead(notif.id);
  };

  const handleMarkAllRead = () => {
    markAllAsRead();
  };

  // Filtre + regroupement par jour
  const filtered = useMemo(() => {
    if (filter === 'unread') return notifications.filter((n) => !n.isRead);
    return notifications;
  }, [notifications, filter]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const n of filtered) {
      const k = dayKey(n.createdAt);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(n);
    }
    return [...map.entries()];
  }, [filtered]);

  const hasUnread = unreadCount > 0;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Overlay mobile */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm md:hidden"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, scale: 0.96, y: -8, originX: 1, originY: 0 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="fixed md:absolute top-[calc(100%+8px)] right-0 left-0 md:left-auto z-50
                       mx-4 md:mx-0 md:w-[420px] max-h-[80vh] md:max-h-[600px]
                       rounded-2xl border shadow-xl overflow-hidden flex flex-col"
            style={{
              backgroundColor: 'var(--color-surface-container-lowest)',
              borderColor: 'var(--efferd-border)',
            }}
          >
            {/* Header */}
            <div
              className="shrink-0 border-b px-4 pt-3 pb-2.5"
              style={{ borderColor: 'var(--efferd-border)' }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--efferd-muted)' }}>
                    notifications
                  </span>
                  <span className="text-[14px] font-semibold" style={{ color: 'var(--efferd-text)' }}>
                    Notifications
                  </span>
                  {hasUnread && (
                    <span
                      className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold text-white"
                      style={{ backgroundColor: 'var(--nav-active-bg)' }}
                    >
                      {unreadCount}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {hasUnread && (
                    <button
                      onClick={handleMarkAllRead}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer"
                      style={{ color: 'var(--efferd-muted)' }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface-container-high)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                      Tout lire
                    </button>
                  )}
                  <button
                    onClick={onClose}
                    className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors cursor-pointer"
                    style={{ color: 'var(--efferd-muted)' }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface-container-high)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Onglets de filtre */}
              <div className="flex items-center gap-1 mt-2.5 p-1 rounded-xl bg-surface-container/70 border border-outline-variant/30">
                {[
                  { id: 'all', label: 'Toutes' },
                  { id: 'unread', label: `Non lues${hasUnread ? ` (${unreadCount})` : ''}` },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setFilter(t.id)}
                    className={`flex-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                      filter === t.id
                        ? 'bg-surface-container-high text-on-surface shadow-sm'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Liste des notifications */}
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="overflow-y-auto flex-1"
              style={{ maxHeight: 'calc(80vh - 110px)' }}
            >
              {groups.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12 px-4 text-center">
                  <div className="p-4 rounded-full bg-surface-container">
                    <Bell className="w-7 h-7" style={{ color: 'var(--efferd-muted)', opacity: 0.5 }} />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium" style={{ color: 'var(--efferd-text)' }}>
                      {filter === 'unread' ? 'Aucune notification non lue' : 'Aucune notification'}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--efferd-muted)' }}>
                      {filter === 'unread'
                        ? 'Vous avez tout lu. Bravo !'
                        : "Les alertes de tickets et d'assignations apparaîtront ici"}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="px-2 py-2 space-y-4">
                  {groups.map(([key, items]) => (
                    <div key={key}>
                      <div
                        className="flex items-center gap-2 px-2 pb-1.5 pt-0.5"
                        style={{ color: 'var(--efferd-muted)' }}
                      >
                        <span className="text-[10px] font-bold uppercase tracking-wider">
                          {dayLabel(items[0].createdAt)}
                        </span>
                        <div className="flex-1 h-px" style={{ backgroundColor: 'var(--efferd-border)' }} />
                        <span className="text-[9px] font-medium opacity-70">{items.length}</span>
                      </div>
                      <div className="space-y-0.5">
                        {items.map((notif) => (
                          <NotifItem
                            key={notif.id}
                            notif={notif}
                            onClick={handleNotifClick}
                            onMarkRead={handleMarkOneRead}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Load more */}
              {hasMore && (
                <div className="flex justify-center py-3">
                  <button
                    onClick={loadMore}
                    className="text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                    style={{ color: 'var(--efferd-muted)' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--color-surface-container-high)';
                      e.currentTarget.style.color = 'var(--efferd-text)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--efferd-muted)';
                    }}
                  >
                    Voir plus
                  </button>
                </div>
              )}

              {/* Bottom padding */}
              <div className="h-2" />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function NotifItem({ notif, onClick, onMarkRead }) {
  const read = notif.isRead;
  const typeCfg = TYPE_CONFIG[notif.type] || DEFAULT_TYPE_CONFIG;
  const Icon = typeCfg.icon;
  const metadata = notif.metadata || {};
  const priorityCfg = PRIORITY_CONFIG[metadata.priority];
  const ticketId = ticketIdFromLink(notif.link);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ duration: 0.15 }}
      role="button"
      tabIndex={0}
      onClick={() => onClick(notif)}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(notif); }}
      className={`group relative w-full flex items-start gap-3 px-2.5 py-2.5 rounded-xl text-left transition-all duration-150 cursor-pointer ${
        !read ? 'font-medium' : ''
      }`}
      style={{
        backgroundColor: !read ? 'var(--color-surface-container-high)' : 'transparent',
      }}
      onMouseEnter={(e) => {
        if (read) e.currentTarget.style.backgroundColor = 'var(--color-surface-container-high)';
      }}
      onMouseLeave={(e) => {
        if (read) e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      {/* Accent gauche si non lu */}
      {!read && (
        <div
          className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full"
          style={{ backgroundColor: 'var(--nav-active-bg)' }}
        />
      )}

      {/* Icône par type */}
      <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center border ${typeCfg.chip} ${!read ? 'ring-1 ring-inset' : ''}`}>
        <Icon className="w-4 h-4" />
      </div>

      {/* Contenu */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border ${typeCfg.chip}`}>
              {typeCfg.label}
            </span>
            {priorityCfg && (
              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border text-[9px] font-bold ${priorityCfg.bg} ${priorityCfg.color}`}>
                <Flame className="w-2.5 h-2.5" />
                {priorityCfg.label}
              </span>
            )}
          </div>
          <span
            className="shrink-0 text-[10px] whitespace-nowrap"
            style={{ color: 'var(--efferd-muted)' }}
          >
            {formatTimeAgo(notif.createdAt)}
          </span>
        </div>

        <p
          className="text-[13px] mt-1"
          style={{ color: 'var(--efferd-text)' }}
        >
          {notif.title}
        </p>
        <p
          className="text-[12px] mt-0.5 line-clamp-2"
          style={{ color: 'var(--efferd-muted)' }}
        >
          {notif.message}
        </p>

        {/* Sous-métadonnées */}
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          {ticketId && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-outline-variant/40 bg-surface-container text-[9px] font-bold text-on-surface-variant">
              <span className="material-symbols-outlined" style={{ fontSize: '11px' }}>confirmation_number</span>
              #{ticketId}
            </span>
          )}
          {metadata.methodLabel && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-semibold" style={{ color: 'var(--color-primary)' }}>
              <Zap className="w-2.5 h-2.5" />
              {metadata.methodLabel}
            </span>
          )}
          {metadata.escalationLevel && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20 text-[9px] font-bold">
              <TrendingUp className="w-2.5 h-2.5" />
              Niveau {metadata.escalationLevel}
            </span>
          )}
        </div>
      </div>

      {/* Actions au survol */}
      {!read && (
        <button
          onClick={(e) => onMarkRead(e, notif)}
          title="Marquer comme lue"
          className="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
          style={{ color: 'var(--efferd-muted)', backgroundColor: 'var(--color-surface-container-high)' }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--efferd-text)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--efferd-muted)'}
        >
          <Check className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Indicateur non-lu (petit point) */}
      {!read && (
        <div
          className="absolute right-2.5 top-2.5 w-2 h-2 rounded-full md:hidden"
          style={{ backgroundColor: 'var(--nav-active-bg)' }}
        />
      )}
    </motion.div>
  );
}
