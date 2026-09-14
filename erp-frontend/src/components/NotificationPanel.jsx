import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../context/NotificationContext';
import {
  Bell, Inbox as InboxIcon, UserPlus, RefreshCw, AlertTriangle, TrendingUp,
  Check, CheckCheck, X, Trash2
} from 'lucide-react';

const TYPE_ICONS = {
  ticket_created:   InboxIcon,
  ticket_assigned:  UserPlus,
  ticket_updated:   RefreshCw,
  sla_breached:     AlertTriangle,
  ticket_escalated: TrendingUp,
};

const TYPE_COLORS = {
  ticket_created:   'bg-blue-500',
  ticket_assigned:  'bg-indigo-500',
  ticket_updated:   'bg-amber-500',
  sla_breached:     'bg-red-500',
  ticket_escalated: 'bg-orange-500',
};

function timeAgo(dateString) {
  const s = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}j`;
  return new Date(dateString).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function dayLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = Math.round((start(now) - start(d)) / 86400000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Hier';
  if (diff < 7) return d.toLocaleDateString('fr-FR', { weekday: 'long' });
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function ticketIdFromLink(link) {
  if (!link) return null;
  const m = String(link).match(/\/tickets\/(\d+)/);
  return m ? Number(m[1]) : null;
}

export default function NotificationPanel({ open, onClose }) {
  const { notifications, unreadCount, hasMore, loadMore, markAsRead, markAllAsRead, dismissNotification, clearAll } = useNotifications();
  const navigate = useNavigate();
  const panelRef = useRef(null);
  const scrollRef = useRef(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) loadMore();
  }, [hasMore, loadMore]);

  const handleClick = (notif) => {
    if (!notif.isRead) markAsRead(notif.id);
    const link = notif.link || (() => {
      const m = (notif.message || '').match(/#(\d+)/);
      return m ? `/tickets/${m[1]}` : null;
    })();
    if (link) navigate(link);
    onClose();
  };

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

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />

      <div
        ref={panelRef}
        className="fixed md:absolute z-50
                   top-[calc(100%+6px)] right-0
                   w-[calc(100vw-24px)] md:w-[400px]
                   max-h-[80vh] md:max-h-[520px]
                   flex flex-col overflow-hidden
                   rounded-2xl"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-outline-variant)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.12)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--color-outline-variant)' }}>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold" style={{ color: 'var(--color-on-surface)' }}>
              Notifications
            </span>
            {hasUnread && (
              <span
                className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold"
                style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-surface)' }}
              >
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {hasUnread && (
              <button
                onClick={markAllAsRead}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer"
                style={{ color: 'var(--color-on-surface-variant)' }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface-container)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <CheckCheck className="w-3 h-3" />
                Tout lire
              </button>
            )}
            {notifications.length > 0 && (
              <button
                onClick={clearAll}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer"
                style={{ color: 'var(--color-on-surface-variant)' }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface-container)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                title="Supprimer toutes les notifications"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center rounded-md transition-colors cursor-pointer"
              style={{ color: 'var(--color-on-surface-variant)' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface-container)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex" style={{ borderBottom: '1px solid var(--color-outline-variant)' }}>
          {[
            { id: 'all', label: 'Toutes' },
            { id: 'unread', label: `Non lues${hasUnread ? ` (${unreadCount})` : ''}` },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setFilter(t.id)}
              className="flex-1 py-2.5 text-[12px] font-medium border-b-2 transition-colors cursor-pointer"
              style={{
                color: filter === t.id ? 'var(--color-on-surface)' : 'var(--color-on-surface-variant)',
                borderBottomColor: filter === t.id ? 'var(--color-primary)' : 'transparent',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Liste */}
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overscroll-y-contain">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 px-6 text-center">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ backgroundColor: 'var(--color-surface-container)' }}
              >
                <Bell className="w-5 h-5" style={{ color: 'var(--color-outline)' }} />
              </div>
              <p className="text-[13px] font-medium" style={{ color: 'var(--color-on-surface-variant)' }}>
                {filter === 'unread' ? 'Tout est lu' : 'Aucune notification'}
              </p>
            </div>
          ) : (
            <div>
              {groups.map(([key, items]) => (
                <div key={key}>
                  <div
                    className="px-4 pt-3 pb-1 sticky top-0 z-10"
                    style={{ backgroundColor: 'var(--color-surface)' }}
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-on-surface-variant)' }}>
                      {dayLabel(items[0].createdAt)}
                    </span>
                  </div>
                  {items.map((notif) => (
                    <NotifItem
                      key={notif.id}
                      notif={notif}
                      onClick={handleClick}
                      onMarkRead={(e) => { e.stopPropagation(); markAsRead(notif.id); }}
                      onDismiss={(e) => { e.stopPropagation(); dismissNotification(notif.id); }}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}

          {hasMore && (
            <div className="flex justify-center py-3" style={{ borderTop: '1px solid var(--color-outline-variant)' }}>
              <button
                onClick={loadMore}
                className="text-[11px] font-medium transition-colors cursor-pointer"
                style={{ color: 'var(--color-on-surface-variant)' }}
              >
                Charger plus
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function NotifItem({ notif, onClick, onMarkRead, onDismiss }) {
  const read = notif.isRead;
  const Icon = TYPE_ICONS[notif.type] || Bell;
  const dotColor = TYPE_COLORS[notif.type] || 'bg-gray-400';
  const metadata = notif.metadata || {};
  const ticketId = ticketIdFromLink(notif.link);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(notif)}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(notif); }}
      className="group flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors"
      style={{
        backgroundColor: !read ? 'color-mix(in srgb, var(--color-primary) 4%, transparent)' : 'transparent',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = !read ? 'color-mix(in srgb, var(--color-primary) 8%, transparent)' : 'var(--color-surface-container)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = !read ? 'color-mix(in srgb, var(--color-primary) 4%, transparent)' : 'transparent';
      }}
    >
      {/* Avatar */}
      <div className={`relative w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${dotColor}`}>
        <Icon className="w-4 h-4 text-white" />
        {!read && (
          <div
            className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
            style={{ backgroundColor: 'var(--color-primary)', borderColor: 'var(--color-surface)' }}
          />
        )}
      </div>

      {/* Texte */}
      <div className="flex-1 min-w-0">
        <p
          className="text-[13px] leading-snug truncate"
          style={{
            color: 'var(--color-on-surface)',
            fontWeight: !read ? 600 : 400,
          }}
        >
          {notif.title}
        </p>
        {notif.message && (
          <p className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--color-on-surface-variant)' }}>
            {notif.message}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1">
          {ticketId && (
            <span className="text-[10px]" style={{ color: 'var(--color-outline)' }}>#{ticketId}</span>
          )}
          {metadata.methodLabel && (
            <span className="text-[10px]" style={{ color: 'var(--color-outline)' }}>{metadata.methodLabel}</span>
          )}
          {metadata.escalationLevel && (
            <span className="text-[10px] font-medium text-orange-500">Nv.{metadata.escalationLevel}</span>
          )}
        </div>
      </div>

      {/* Temps + actions */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-[10px] whitespace-nowrap" style={{ color: 'var(--color-outline)' }}>
          {timeAgo(notif.createdAt)}
        </span>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {!read && (
            <button
              onClick={onMarkRead}
              title="Marquer comme lue"
              className="w-5 h-5 rounded flex items-center justify-center transition-colors cursor-pointer"
              style={{ color: 'var(--color-on-surface-variant)' }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-primary)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-on-surface-variant)'}
            >
              <Check className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={onDismiss}
            title="Supprimer"
            className="w-5 h-5 rounded flex items-center justify-center transition-colors cursor-pointer"
            style={{ color: 'var(--color-on-surface-variant)' }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-on-surface-variant)'}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
