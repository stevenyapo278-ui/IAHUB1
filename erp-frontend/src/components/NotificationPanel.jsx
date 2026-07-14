import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useNotifications } from '../context/NotificationContext';

const TYPE_ICONS = {
  ticket_created: 'confirmation_number',
  ticket_assigned: 'person_pin',
  ticket_updated: 'update',
};

const TYPE_COLORS = {
  ticket_created: 'text-primary',
  ticket_assigned: 'text-indigo-500',
  ticket_updated: 'text-amber-500',
};

function formatTimeAgo(dateString) {
  const now = Date.now();
  const date = new Date(dateString).getTime();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 10) return 'À l\'instant';
  if (diffSec < 60) return `Il y a ${diffSec}s`;
  if (diffMin < 60) return `Il y a ${diffMin}min`;
  if (diffHour < 24) return `Il y a ${diffHour}h`;
  if (diffDay < 7) return `Il y a ${diffDay}j`;
  return new Date(dateString).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function NotificationPanel({ open, onClose }) {
  const { notifications, unreadCount, hasMore, loadMore, markAsRead, markAllAsRead } = useNotifications();
  const navigate = useNavigate();
  const panelRef = useRef(null);
  const scrollRef = useRef(null);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);

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

  const handleMarkAllRead = () => {
    markAllAsRead();
  };

  // Séparer les notifications non lues et lues
  const unreadNotifications = notifications.filter((n) => !n.isRead);
  const readNotifications = notifications.filter((n) => n.isRead);

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
                       mx-4 md:mx-0 md:w-[400px] max-h-[80vh] md:max-h-[600px]
                       rounded-2xl border shadow-xl overflow-hidden"
            style={{
              backgroundColor: 'var(--color-surface-container-lowest)',
              borderColor: 'var(--efferd-border)',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3 border-b"
              style={{ borderColor: 'var(--efferd-border)' }}
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--efferd-muted)' }}>
                  notifications
                </span>
                <span className="text-[14px] font-semibold" style={{ color: 'var(--efferd-text)' }}>
                  Notifications
                </span>
                {unreadCount > 0 && (
                  <span
                    className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: 'var(--nav-active-bg)' }}
                  >
                    {unreadCount}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors"
                    style={{ color: 'var(--efferd-muted)' }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface-container-high)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>done_all</span>
                    Tout lire
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
                  style={{ color: 'var(--efferd-muted)' }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface-container-high)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
                </button>
              </div>
            </div>

            {/* Liste des notifications */}
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="overflow-y-auto"
              style={{ maxHeight: 'calc(80vh - 60px)' }}
            >
              {/* Notifications non lues */}
              {unreadNotifications.length > 0 && (
                <div className="px-2 pt-2 pb-1">
                  {unreadNotifications.map((notif) => (
                    <NotifItem
                      key={notif.id}
                      notif={notif}
                      onClick={handleNotifClick}
                    />
                  ))}
                </div>
              )}

              {/* Séparateur */}
              {unreadNotifications.length > 0 && readNotifications.length > 0 && (
                <div
                  className="flex items-center gap-2 px-4 py-1"
                  style={{ color: 'var(--efferd-muted)' }}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wider">Lues</span>
                  <div className="flex-1 h-px" style={{ backgroundColor: 'var(--efferd-border)' }} />
                </div>
              )}

              {/* Notifications lues */}
              {readNotifications.length > 0 && (
                <div className="px-2 pb-2 pt-1">
                  {readNotifications.map((notif) => (
                    <NotifItem
                      key={notif.id}
                      notif={notif}
                      onClick={handleNotifClick}
                      read
                    />
                  ))}
                </div>
              )}

              {/* État vide */}
              {notifications.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-12 px-4 text-center">
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: '36px', color: 'var(--efferd-muted)', opacity: 0.4 }}
                  >
                    notifications_off
                  </span>
                  <div>
                    <p className="text-[13px] font-medium" style={{ color: 'var(--efferd-text)' }}>
                      Aucune notification
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--efferd-muted)' }}>
                      Les alertes de tickets et d'assignations apparaîtront ici
                    </p>
                  </div>
                </div>
              )}

              {/* Load more */}
              {hasMore && (
                <div className="flex justify-center py-3">
                  <button
                    onClick={loadMore}
                    className="text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors"
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

function NotifItem({ notif, onClick, read = false }) {
  const icon = TYPE_ICONS[notif.type] || 'notifications';
  const colorClass = TYPE_COLORS[notif.type] || 'text-primary';
  const metadata = notif.metadata || {};

  return (
    <button
      onClick={() => onClick(notif)}
      className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150 ${
        !read ? 'font-medium' : 'opacity-60'
      }`}
      style={{
        backgroundColor: !read ? 'var(--color-surface-container-high)' : 'transparent',
      }}
      onMouseEnter={(e) => {
        if (!read) return;
        e.currentTarget.style.backgroundColor = 'var(--color-surface-container-high)';
      }}
      onMouseLeave={(e) => {
        if (!read) return;
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      {/* Icône */}
      <div className="shrink-0 mt-0.5">
        <span
          className={`material-symbols-outlined ${colorClass}`}
          style={{
            fontSize: '18px',
            fontVariationSettings: !read ? "'FILL' 1" : "'FILL' 0",
          }}
        >
          {icon}
        </span>
      </div>

      {/* Contenu */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p
            className="text-[13px] truncate"
            style={{ color: 'var(--efferd-text)' }}
          >
            {notif.title}
          </p>
          <span
            className="shrink-0 text-[10px] whitespace-nowrap"
            style={{ color: 'var(--efferd-muted)' }}
          >
            {formatTimeAgo(notif.createdAt)}
          </span>
        </div>
        <p
          className="text-[12px] mt-0.5 truncate"
          style={{ color: 'var(--efferd-muted)' }}
        >
          {notif.message}
        </p>
        {/* Sous-label pour les assignations */}
        {metadata.methodLabel && (
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-primary)' }}>
            {metadata.methodLabel}
          </p>
        )}
      </div>

      {/* Indicateur non-lu */}
      {!read && (
        <div
          className="shrink-0 w-2 h-2 mt-1.5 rounded-full"
          style={{ backgroundColor: 'var(--nav-active-bg)' }}
        />
      )}
    </button>
  );
}
