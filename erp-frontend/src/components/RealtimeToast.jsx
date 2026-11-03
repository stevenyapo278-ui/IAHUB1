import { Flame, Ticket, UserCheck, RefreshCw, Sparkles, CornerUpLeft, ChevronRight } from 'lucide-react';

// ─── Contenu des toasts temps réel (Socket.IO) ───────────────────────────────
// Composant unique volontairement compact : une icône, un titre, une ligne de
// détail. Les anciens blocs inline de SocketContext étaient hauts (~70 px) et
// empilaient 5 cartes à l'écran ; ici tout tient sur ~44 px de haut.
//
// Les tons sont pilotés par CSS (.rt-tone-*) pour rester cohérents en light/dark.
const TONES = {
  p1: { Icon: Flame, tone: 'p1', pulse: true },
  created: { Icon: Ticket, tone: 'created' },
  assigned: { Icon: UserCheck, tone: 'assigned' },
  updated: { Icon: RefreshCw, tone: 'updated' },
  reply: { Icon: CornerUpLeft, tone: 'reply' },
  newRequest: { Icon: Sparkles, tone: 'newRequest' },
};

export default function RealtimeToast({ tone = 'created', title, ticketId, subtitle, meta, count }) {
  const { Icon, tone: toneClass, pulse } = TONES[tone] || TONES.created;

  return (
    <div className={`rt-toast rt-tone-${toneClass}`}>
      <span className="rt-toast__icon">
        <Icon className={`h-3.5 w-3.5 ${pulse ? 'animate-pulse' : ''}`} strokeWidth={2.5} />
      </span>

      <div className="rt-toast__body">
        <div className="rt-toast__head">
          <span className="rt-toast__title">{title}</span>
          {count > 1 ? (
            <span className="rt-toast__chip">{count}</span>
          ) : ticketId ? (
            <span className="rt-toast__chip">#{ticketId}</span>
          ) : null}
        </div>
        {subtitle ? <p className="rt-toast__sub">{subtitle}</p> : null}
        {meta ? <span className="rt-toast__meta">{meta}</span> : null}
      </div>

      <ChevronRight className="rt-toast__chevron" strokeWidth={2.5} />
    </div>
  );
}
