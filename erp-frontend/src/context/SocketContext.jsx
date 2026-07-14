import { createContext, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import { toast } from 'sonner';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    // Ne connecter le socket que si l'utilisateur est authentifié
    if (!user) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
      return;
    }

    const token = localStorage.getItem('token');
    
    // Déterminer l'URL du backend (directement l'API en dev pour court-circuiter le proxy conteneur, ou l'origine en prod)
    const backendUrl = import.meta.env.VITE_API_URL
      ? import.meta.env.VITE_API_URL.replace(/\/api$/, '')
      : window.location.origin;

    const newSocket = io(backendUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    newSocket.on('connect', () => {
      console.log('[Socket.io] Connecté au serveur');
    });

    newSocket.on('connect_error', (err) => {
      console.error('[Socket.io] Erreur de connexion:', err.message);
    });

    // ── Notifications temps réel ────────────────────────────────────────
    newSocket.on('ticket_created', (ticket) => {
      const p1 = ticket.priority === 'P1';
      toast(
        <div className="flex items-start gap-2 min-w-0">
          <span className={`material-symbols-outlined shrink-0 ${p1 ? 'text-red-500' : 'text-primary'}`} style={{ fontSize: '20px' }}>
            {p1 ? 'emergency' : 'confirmation_number'}
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-[13px] truncate">
              {p1 ? '🚨 Incident critique créé' : 'Nouveau ticket créé'}
            </p>
            <p className="text-[12px] text-on-surface-variant truncate mt-0.5">
              #{ticket.id} — {ticket.title}
            </p>
          </div>
        </div>,
        {
          duration: 6000,
          action: {
            label: 'Voir',
            onClick: () => navigate(`/tickets/${ticket.id}`),
          },
          style: p1 ? { borderLeft: '3px solid #ef4444' } : undefined,
        }
      );
    });

    newSocket.on('ticket_assigned_to_you', (data) => {
      toast(
        <div className="flex items-start gap-2 min-w-0">
          <span className="material-symbols-outlined shrink-0 text-indigo-500" style={{ fontSize: '20px', fontVariationSettings: "'FILL' 1" }}>
            person_pin
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-[13px]">Ticket assigné</p>
            <p className="text-[12px] text-on-surface-variant truncate mt-0.5">
              #{data.ticketId} — {data.title}
            </p>
            <p className="text-[10px] text-primary mt-0.5">
              {data.method === 'ai_skills' ? 'Assigné par compétence IA' :
               data.method === 'by_category' ? 'Assigné par catégorie' :
               'Assigné manuellement'}
            </p>
          </div>
        </div>,
        {
          duration: 8000,
          action: {
            label: 'Voir',
            onClick: () => navigate(`/tickets/${data.ticketId}`),
          },
        }
      );
    });

    newSocket.on('ticket_updated', (data) => {
      if (data.changes?.status) {
        toast.info(
          <div className="flex items-start gap-2 min-w-0">
            <span className="material-symbols-outlined shrink-0 text-amber-500" style={{ fontSize: '20px' }}>
              update
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-[13px]">Ticket mis à jour</p>
              <p className="text-[12px] text-on-surface-variant truncate mt-0.5">
                #{data.id} → {data.status}
              </p>
            </div>
          </div>,
          { duration: 4000 }
        );
      }
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [user, navigate]);

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
