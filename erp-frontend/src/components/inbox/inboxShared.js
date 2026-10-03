// Constantes et helpers partagés entre la liste des mails, la lecture et les
// petits composants de la boîte de réception.
import {
  Clock, RefreshCw, CheckCircle2, XCircle, Ban, AlertTriangle, Mail,
  Flame, ChevronRight,
} from 'lucide-react';

export const STATUS_CONFIG = {
  PENDING: { label: 'En attente', icon: Clock,        color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  PROCESSING:{label: 'Traitement',icon: RefreshCw,    color: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20'   },
  DONE:    { label: 'Traité',     icon: CheckCircle2, color: 'text-emerald-400',bg: 'bg-emerald-500/10',border: 'border-emerald-500/20' },
  ERROR:   { label: 'Erreur',     icon: XCircle,      color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20'    },
  RETRY:   { label: 'Relance',    icon: RefreshCw,    color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/20'  },
  DEAD_LETTER: { label: 'Échec',  icon: AlertTriangle,color: 'text-red-500',    bg: 'bg-red-500/15',    border: 'border-red-500/25'    },
  SPAM:    { label: 'Spam',       icon: Ban,          color: 'text-zinc-400',   bg: 'bg-zinc-500/10',   border: 'border-zinc-500/20'   },
  INFORMATIONAL: { label: 'Info', icon: Mail,          color: 'text-on-surface-variant',  bg: 'bg-surface-container',  border: 'border-slate-500/20'  },
  NEEDS_REVIEW: { label: 'Révision', icon: AlertTriangle, color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
};

export const PRIORITY_CONFIG = {
  P1: { label: 'P1 Critique', icon: Flame,         color: 'text-red-400',    bg: 'bg-red-500',    stripe: '#ef4444' },
  P2: { label: 'P2 Haute',   icon: AlertTriangle,  color: 'text-orange-400', bg: 'bg-orange-500', stripe: '#f97316' },
  P3: { label: 'P3 Moyenne', icon: ChevronRight,   color: 'text-amber-400',  bg: 'bg-amber-500',  stripe: '#f59e0b' },
  P4: { label: 'P4 Basse',   icon: ChevronRight,   color: 'text-blue-400',   bg: 'bg-blue-500',   stripe: '#3b82f6' },
};

export function initialOf(name, email) {
  return ((name || email) || '?').charAt(0).toUpperCase();
}

export function displayAddr(addr) {
  const s = String(addr || '');
  return s.length > 28 ? `${s.slice(0, 26)}…` : s;
}

export function participantsLabel(participants) {
  if (!participants || participants.length === 0) return 'Inconnu';
  const names = participants.slice(0, 2).map((p) => p.name || p.email);
  if (participants.length > 2) return `${names.join(', ')} +${participants.length - 2}`;
  return names.join(', ');
}

// Date façon Outlook : toujours avec l'heure (ex. 14:32, Hier 14:32, 12 août 07:21)
export function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  const now = new Date();
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (diffDays === 0) return time;
  if (diffDays === 1) return `Hier ${time}`;
  if (diffDays < 7) return `${date.toLocaleDateString('fr-FR', { weekday: 'short' })} ${time}`;
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} ${time}`;
  }
  return `${date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })} ${time}`;
}

export function formatDateTime(d) {
  return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// En-tête de groupe façon Outlook (Aujourd'hui / Hier / Cette semaine / Plus ancien)
export function dateGroupLabel(d) {
  if (!d) return 'Sans date';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return 'Sans date';
  const now = new Date();
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (diffDays <= 0) return "Aujourd'hui";
  if (diffDays === 1) return 'Hier';
  if (diffDays < 7) return 'Cette semaine';
  return 'Plus ancien';
}
