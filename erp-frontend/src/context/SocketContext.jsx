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
    });

    newSocket.on('connect', () => {
      console.log('[Socket.io] Connecté au serveur');
    });

    newSocket.on('connect_error', (err) => {
      console.error('[Socket.io] Erreur de connexion:', err.message);
    });

    // ── Ticket créé ────────────────────────────────────────────────────
    newSocket.on('ticket_created', (ticket) => {
      const p1 = ticket.priority === 'P1';
      toast(
        <div className="toast-clickable-content">
          <div className="toast-icon-wrap">
            <span
              className="material-symbols-outlined toast-icon"
              style={{
                fontSize: '22px',
                fontVariationSettings: "'FILL' 1",
                color: p1 ? '#ef4444' : 'var(--color-primary)',
              }}
            >
              {p1 ? 'emergency' : 'confirmation_number'}
            </span>
          </div>
          <div className="toast-body">
            <p className="toast-title">{p1 ? 'Incident critique' : 'Nouveau ticket'}</p>
            <p className="toast-subtitle">#{ticket.id} — {ticket.title}</p>
          </div>
          <span className="material-symbols-outlined toast-arrow">open_in_new</span>
        </div>,
        {
          duration: 6000,
          onClick: () => navigate(`/tickets/${ticket.id}`),
          style: {
            background: p1
              ? 'linear-gradient(135deg, rgba(239,68,68,0.08) 0%, rgba(239,68,68,0.02) 100%)'
              : undefined,
            borderLeft: p1 ? '3px solid #ef4444' : undefined,
          },
        }
      );
    });

    // ── Ticket assigné ─────────────────────────────────────────────────
    newSocket.on('ticket_assigned_to_you', (data) => {
      toast(
        <div className="toast-clickable-content">
          <div className="toast-icon-wrap" style={{ backgroundColor: 'rgba(99,102,241,0.1)' }}>
            <span
              className="material-symbols-outlined toast-icon"
              style={{ fontSize: '22px', color: '#6366f1', fontVariationSettings: "'FILL' 1" }}
            >
              person_pin
            </span>
          </div>
          <div className="toast-body">
            <p className="toast-title">Ticket assigné à vous</p>
            <p className="toast-subtitle">#{data.ticketId} — {data.title}</p>
            <p className="toast-meta">
              {data.method === 'ai_skills' ? 'Par compétence IA' :
               data.method === 'by_category' ? 'Par catégorie' :
               'Manuellement'}
            </p>
          </div>
          <span className="material-symbols-outlined toast-arrow">open_in_new</span>
        </div>,
        {
          duration: 8000,
          onClick: () => navigate(`/tickets/${data.ticketId}`),
        }
      );
    });

    // ── Ticket mis à jour ──────────────────────────────────────────────
    newSocket.on('ticket_updated', (data) => {
      if (data.changes?.status) {
        toast.info(
          <div className="toast-clickable-content">
            <div className="toast-icon-wrap" style={{ backgroundColor: 'rgba(245,158,11,0.1)' }}>
              <span
                className="material-symbols-outlined toast-icon"
                style={{ fontSize: '22px', color: '#f59e0b', fontVariationSettings: "'FILL' 1" }}
              >
                update
              </span>
            </div>
            <div className="toast-body">
              <p className="toast-title">Ticket mis à jour</p>
              <p className="toast-subtitle">#{data.id} → {data.status}</p>
            </div>
            <span className="material-symbols-outlined toast-arrow">open_in_new</span>
          </div>,
          {
            duration: 4000,
            onClick: () => navigate(`/tickets/${data.id}`),
          }
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
