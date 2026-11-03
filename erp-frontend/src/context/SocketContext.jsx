import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import { toast } from 'sonner';
import { useAuth } from './AuthContext';
import RealtimeToast from '../components/RealtimeToast';
import { sendBrowserNotification, requestBrowserNotifPermission } from '../utils/browserNotification';
import { playTicketCreated, playTicketAssigned, playTicketUpdated, playAlertP1 } from '../utils/sounds';
import { wasRecentlyUpdatedByMe } from '../utils/recentlyUpdatedTickets';

const SocketContext = createContext(null);

// Fenêtre de regroupement des changements de statut : une rafale (sync GLPI,
// import, clôture en lot) produit UN seul toast résumé au lieu d'un par ticket.
const UPDATE_BATCH_MS = 1200;

export function SocketProvider({ children }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [socket, setSocket] = useState(null);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (!user) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
      return;
    }

    const token = localStorage.getItem('token');

    const backendUrl = import.meta.env.VITE_API_URL
      ? import.meta.env.VITE_API_URL.replace(/\/api$/, '')
      : window.location.origin;

    const newSocket = io(backendUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    newSocket.on('connect', () => {
      console.log('[Socket.io] Connecté au serveur');
      requestBrowserNotifPermission();
    });

    newSocket.on('connect_error', (err) => {
      console.error('[Socket.io] Erreur de connexion:', err.message);
    });

    newSocket.on('system-settings:updated', () => {
      window.dispatchEvent(new CustomEvent('system-settings:updated'));
    });

    // ── Ticket créé ────────────────────────────────────────────────────
    newSocket.on('ticket_created', (ticket) => {
      // Signal pour les vues listes (re-fetch immédiat au lieu d'attendre le polling)
      window.dispatchEvent(new CustomEvent('tickets:changed', { detail: { type: 'created', id: ticket.id } }));
      const p1 = ticket.priority === 'P1';
      if (p1) {
        playAlertP1();
        // Signal pour l'UI vocale (carte alerte en session MARIE / mini-orbe)
        window.dispatchEvent(new CustomEvent('voice:p1-alert', { detail: ticket }));
      } else playTicketCreated();
      sendBrowserNotification(
        p1 ? '🚨 Incident critique' : 'Nouveau ticket',
        {
          body: `#${ticket.id} — ${ticket.title}`,
          tag: `ticket-${ticket.id}`,
          onClick: () => navigateRef.current(`/tickets/${ticket.id}`),
        }
      );
      toast(
        <RealtimeToast
          tone={p1 ? 'p1' : 'created'}
          title={p1 ? 'Incident critique' : 'Nouveau ticket'}
          ticketId={ticket.id}
          subtitle={ticket.title}
        />,
        {
          duration: p1 ? 6000 : 4500,
          className: p1 ? 'rt-host--p1' : undefined,
          onClick: () => navigateRef.current(`/tickets/${ticket.id}`),
        }
      );
    });

    // ── Ticket assigné ─────────────────────────────────────────────────
    newSocket.on('ticket_assigned_to_you', (data) => {
      window.dispatchEvent(new CustomEvent('tickets:changed', { detail: { type: 'assigned', id: data.ticketId } }));
      playTicketAssigned();
      const methodLabel =
        data.method === 'ai_skills' ? '✨ Par compétence IA' :
        data.method === 'by_category' ? '📂 Par catégorie' : '👤 Manuellement';
      sendBrowserNotification(
        'Ticket assigné à vous',
        {
          body: `#${data.ticketId} — ${data.title} (${methodLabel})`,
          tag: `ticket-${data.ticketId}`,
          onClick: () => navigateRef.current(`/tickets/${data.ticketId}`),
        }
      );
      toast(
        <RealtimeToast
          tone="assigned"
          title="Ticket assigné à vous"
          ticketId={data.ticketId}
          subtitle={data.title}
          meta={methodLabel}
        />,
        {
          duration: 5500,
          onClick: () => navigateRef.current(`/tickets/${data.ticketId}`),
        }
      );
    });

    // ── Ticket mis à jour ──────────────────────────────────────────────
    // Dedup: backend emits to 'assignments' room + 'user:X' rooms,
    // so ADMIN users who are also assigned receive the event TWICE.
    const recentUpdates = new Map(); // ticketId -> timestamp
    const UPDATE_DEDUP_MS = 3000;

    // File d'attente regroupée : les changements de statut arrivant dans la
    // même fenêtre sont fusionnés en un seul toast (« 4 tickets mis à jour »).
    let pendingUpdates = [];
    let updateFlushTimer = null;

    const flushUpdates = () => {
      updateFlushTimer = null;
      const batch = pendingUpdates;
      pendingUpdates = [];
      if (batch.length === 0) return;

      if (batch.length === 1) {
        const { id, status } = batch[0];
        toast(
          <RealtimeToast
            tone="updated"
            title="Statut mis à jour"
            ticketId={id}
            subtitle={`Nouveau statut : ${status}`}
          />,
          {
            duration: 3500,
            onClick: () => navigateRef.current(`/tickets/${id}`),
          }
        );
        return;
      }

      const preview = batch.slice(0, 3).map((u) => `#${u.id}`).join(' · ');
      toast(
        <RealtimeToast
          tone="updated"
          title={`${batch.length} tickets mis à jour`}
          count={batch.length}
          subtitle={`${preview}${batch.length > 3 ? ` +${batch.length - 3}` : ''}`}
        />,
        {
          duration: 4000,
          onClick: () => navigateRef.current('/tickets'),
        }
      );
    };

    newSocket.on('ticket_updated', (data) => {
      // Signal pour les vues listes : tout changement (statut, assignation, contenu…) doit
      // rafraîchir la liste immédiatement, pas seulement les changements de statut.
      window.dispatchEvent(new CustomEvent('tickets:changed', { detail: { type: 'updated', id: data.id } }));
      if (data.changes?.status) {
        // Skip toast if the current user just updated this ticket themselves
        if (wasRecentlyUpdatedByMe(data.id)) return;
        // Dedup: skip if same ticket updated within dedup window
        const now = Date.now();
        const last = recentUpdates.get(data.id);
        if (last && now - last < UPDATE_DEDUP_MS) return;
        recentUpdates.set(data.id, now);
        if (recentUpdates.size > 100) {
          for (const [k, v] of recentUpdates) {
            if (now - v > UPDATE_DEDUP_MS) recentUpdates.delete(k);
          }
        }

        playTicketUpdated();
        sendBrowserNotification(
          'Ticket mis à jour',
          {
            body: `#${data.id} → ${data.status}`,
            tag: `ticket-${data.id}`,
            onClick: () => navigateRef.current(`/tickets/${data.id}`),
          }
        );

        pendingUpdates.push({ id: data.id, status: data.status });
        if (updateFlushTimer) clearTimeout(updateFlushTimer);
        updateFlushTimer = setTimeout(flushUpdates, UPDATE_BATCH_MS);
      }
    });

    // ── Réponse sur ticket fermé ───────────────────────────────────────
    newSocket.on('ticket_reply_suggestion', (data) => {
      playTicketAssigned();
      sendBrowserNotification(
        'Réponse sur ticket fermé',
        {
          body: `${data.sender} a répondu au ticket #${data.ticketId} (${data.status})`,
          tag: `reply-suggestion-${data.ticketId}`,
          onClick: () => navigateRef.current('/email-drafts?tab=replies&sub=closed'),
        }
      );
      toast(
        <RealtimeToast
          tone="reply"
          title="Réponse sur ticket fermé"
          ticketId={data.ticketId}
          subtitle={`${data.sender} a répondu — ticket ${data.status}`}
        />,
        {
          duration: 6000,
          onClick: () => navigateRef.current('/email-drafts?tab=replies&sub=closed'),
        }
      );
    });

    // Nouvelle demande détectée sur un ticket EN COURS (autre besoin dans le fil)
    newSocket.on('ticket_new_suggestion', (data) => {
      playTicketAssigned();
      sendBrowserNotification(
        'Nouvelle demande détectée',
        {
          body: `${data.sender} a évoqué un autre besoin sur le ticket #${data.ticketId} (${data.status})`,
          tag: `new-suggestion-${data.ticketId}`,
          onClick: () => navigateRef.current('/email-drafts?tab=replies&sub=open'),
        }
      );
      toast(
        <RealtimeToast
          tone="newRequest"
          title="Nouvelle demande détectée"
          ticketId={data.ticketId}
          subtitle={`${data.sender} a évoqué un autre besoin — ${data.status}`}
        />,
        {
          duration: 6000,
          onClick: () => navigateRef.current('/email-drafts?tab=replies&sub=open'),
        }
      );
    });

    setSocket(newSocket);

    return () => {
      if (updateFlushTimer) clearTimeout(updateFlushTimer);
      pendingUpdates = [];
      if (newSocket.connected || newSocket.connecting) {
        newSocket.removeAllListeners();
        newSocket.disconnect();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
