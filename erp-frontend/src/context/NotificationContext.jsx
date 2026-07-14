import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import api from '../api/client';
import { useSocket } from './SocketContext';
import { useAuth } from './AuthContext';

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const socket = useSocket();
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const isFetchingRef = useRef(false);

  // ── Chargement initial des notifications (uniquement si authentifié) ────
  const loadNotifications = useCallback(async (offset = 0, append = false) => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }

    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      const res = await api.get(`/notifications?limit=20&offset=${offset}`);
      const data = res.data;

      if (!data.ok) return;

      if (append) {
        setNotifications((prev) => [...prev, ...data.notifications]);
      } else {
        setNotifications(data.notifications);
      }
      setUnreadCount(data.unreadCount);
      setHasMore(data.hasMore);
    } catch (err) {
      console.error('[NotificationContext] Erreur chargement:', err.message);
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadNotifications();
    } else {
      setNotifications([]);
      setUnreadCount(0);
      setLoading(false);
    }
  }, [user, loadNotifications]);

  // ── Charger plus de notifications (pagination) ─────────────────────────
  const loadMore = useCallback(() => {
    if (!hasMore || loading) return;
    loadNotifications(notifications.length, true);
  }, [hasMore, loading, notifications.length, loadNotifications]);

  // ── Écouter les événements socket pour ajouter des notifications ───────
  useEffect(() => {
    if (!socket) return;

    function handleTicketCreated(data) {
      const notif = {
        id: Date.now() + Math.random(),
        type: 'ticket_created',
        title: data.priority === 'P1' ? '🚨 Incident critique créé' : 'Nouveau ticket créé',
        message: `#${data.id} — ${data.title}`,
        link: `/tickets/${data.id}`,
        isRead: false,
        createdAt: new Date().toISOString(),
        metadata: { priority: data.priority, status: data.status },
      };

      if (data.assignedToId) {
        notif.title = 'Ticket assigné';
        notif.message = `#${data.id} — ${data.title}`;
      }

      setNotifications((prev) => [notif, ...prev]);
      setUnreadCount((prev) => prev + 1);
    }

    function handleTicketAssignedToYou(data) {
      const methodLabel = data.method === 'ai_skills' ? 'Assigné par compétence IA'
        : data.method === 'by_category' ? 'Assigné par catégorie'
        : 'Assigné manuellement';

      const notif = {
        id: Date.now() + Math.random(),
        type: 'ticket_assigned',
        title: 'Ticket assigné',
        message: `#${data.ticketId} — ${data.title}`,
        link: `/tickets/${data.ticketId}`,
        isRead: false,
        createdAt: new Date().toISOString(),
        metadata: { method: data.method, methodLabel },
      };

      setNotifications((prev) => [notif, ...prev]);
      setUnreadCount((prev) => prev + 1);
    }

    function handleTicketUpdated(data) {
      if (!data.changes?.status) return;

      const notif = {
        id: Date.now() + Math.random(),
        type: 'ticket_updated',
        title: 'Ticket mis à jour',
        message: `#${data.id} — ${data.title} → ${data.changes.status}`,
        link: `/tickets/${data.id}`,
        isRead: false,
        createdAt: new Date().toISOString(),
        metadata: { changes: data.changes },
      };

      setNotifications((prev) => [notif, ...prev]);
      setUnreadCount((prev) => prev + 1);
    }

    socket.on('ticket_created', handleTicketCreated);
    socket.on('ticket_assigned_to_you', handleTicketAssignedToYou);
    socket.on('ticket_updated', handleTicketUpdated);

    // Rafraîchir depuis la base quand on se reconnecte
    socket.on('connect', () => {
      loadNotifications();
    });

    return () => {
      socket.off('ticket_created', handleTicketCreated);
      socket.off('ticket_assigned_to_you', handleTicketAssignedToYou);
      socket.off('ticket_updated', handleTicketUpdated);
      socket.off('connect', loadNotifications);
    };
  }, [socket, loadNotifications]);

  // ── Marquer une notification comme lue ──────────────────────────────────
  const markAsRead = useCallback(async (id) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error('[NotificationContext] Erreur marquage lu:', err.message);
    }
  }, []);

  // ── Marquer toutes les notifications comme lues ─────────────────────────
  const markAllAsRead = useCallback(async () => {
    try {
      await api.post('/notifications/read-all');
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, isRead: true }))
      );
      setUnreadCount(0);
    } catch (err) {
      console.error('[NotificationContext] Erreur marquage tout lu:', err.message);
    }
  }, []);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        hasMore,
        loadMore,
        markAsRead,
        markAllAsRead,
        refresh: () => loadNotifications(),
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}
