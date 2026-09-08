import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import { toast } from 'sonner';
import { Ticket, Flame, UserCheck, RefreshCw, ExternalLink } from 'lucide-react';
import { useAuth } from './AuthContext';
import { sendBrowserNotification, requestBrowserNotifPermission } from '../utils/browserNotification';
import { playTicketCreated, playTicketAssigned, playTicketUpdated, playAlertP1 } from '../utils/sounds';

const SocketContext = createContext(null);

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
      const p1 = ticket.priority === 'P1';
      if (p1) playAlertP1(); else playTicketCreated();
      sendBrowserNotification(
        p1 ? '🚨 Incident critique' : 'Nouveau ticket',
        {
          body: `#${ticket.id} — ${ticket.title}`,
          tag: `ticket-${ticket.id}`,
          onClick: () => navigateRef.current(`/tickets/${ticket.id}`),
        }
      );
      toast(
        <div className="flex items-start gap-3 w-full min-w-0 pr-2 group cursor-pointer">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
            p1
              ? 'bg-red-500/10 text-red-500 border-red-500/20 shadow-xs shadow-red-500/20'
              : 'bg-primary/10 text-primary border-primary/20'
          }`}>
            {p1 ? <Flame className="w-4 h-4 animate-pulse text-red-500" /> : <Ticket className="w-4 h-4 text-primary" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={`text-xs font-bold ${p1 ? 'text-red-500' : 'text-on-surface'}`}>
                {p1 ? '🚨 Incident critique' : 'Nouveau ticket'}
              </span>
              <span className={`px-1.5 py-0.2 rounded-md text-[10px] font-mono font-extrabold shrink-0 ${
                p1 ? 'bg-red-500/15 text-red-500' : 'bg-primary/15 text-primary'
              }`}>
                #{ticket.id}
              </span>
            </div>
            <p className="text-xs text-on-surface-variant font-medium truncate mt-0.5 max-w-[240px]">
              {ticket.title}
            </p>
          </div>
          <div className="shrink-0 text-on-surface-variant/40 group-hover:text-primary transition-colors self-center">
            <ExternalLink className="w-3.5 h-3.5" />
          </div>
        </div>,
        {
          duration: 6000,
          onClick: () => navigateRef.current(`/tickets/${ticket.id}`),
        }
      );
    });

    // ── Ticket assigné ─────────────────────────────────────────────────
    newSocket.on('ticket_assigned_to_you', (data) => {
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
        <div className="flex items-start gap-3 w-full min-w-0 pr-2 group cursor-pointer">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
            <UserCheck className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-bold text-on-surface">Ticket assigné à vous</span>
              <span className="px-1.5 py-0.2 rounded-md text-[10px] font-mono font-extrabold bg-indigo-500/15 text-indigo-500 shrink-0">
                #{data.ticketId}
              </span>
            </div>
            <p className="text-xs text-on-surface-variant font-medium truncate mt-0.5 max-w-[240px]">
              {data.title}
            </p>
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 mt-1">
              {methodLabel}
            </span>
          </div>
          <div className="shrink-0 text-on-surface-variant/40 group-hover:text-indigo-500 transition-colors self-center">
            <ExternalLink className="w-3.5 h-3.5" />
          </div>
        </div>,
        {
          duration: 8000,
          onClick: () => navigateRef.current(`/tickets/${data.ticketId}`),
        }
      );
    });

    // ── Ticket mis à jour ──────────────────────────────────────────────
    newSocket.on('ticket_updated', (data) => {
      if (data.changes?.status) {
        playTicketUpdated();
        sendBrowserNotification(
          'Ticket mis à jour',
          {
            body: `#${data.id} → ${data.status}`,
            tag: `ticket-${data.id}`,
            onClick: () => navigateRef.current(`/tickets/${data.id}`),
          }
        );
        toast(
          <div className="flex items-start gap-3 w-full min-w-0 pr-2 group cursor-pointer">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-amber-500/10 text-amber-500 border border-amber-500/20">
              <RefreshCw className="w-4 h-4 text-amber-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs font-bold text-on-surface">Statut mis à jour</span>
                <span className="px-1.5 py-0.2 rounded-md text-[10px] font-mono font-extrabold bg-amber-500/15 text-amber-500 shrink-0">
                  #{data.id}
                </span>
              </div>
              <p className="text-xs text-on-surface-variant font-medium truncate mt-0.5">
                Nouveau statut : <span className="font-bold text-on-surface">{data.status}</span>
              </p>
            </div>
            <div className="shrink-0 text-on-surface-variant/40 group-hover:text-amber-500 transition-colors self-center">
              <ExternalLink className="w-3.5 h-3.5" />
            </div>
          </div>,
          {
            duration: 4000,
            onClick: () => navigateRef.current(`/tickets/${data.id}`),
          }
        );
      }
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
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
