import { Clock } from 'lucide-react';

// Calcul de l'état SLA d'un ticket à partir de ses échéances.
// - breach : délai de réponse dépassé (badge rouge)
// - urgent : moins de 25% du délai restant (badge orange)
// - ok : délai respecté (badge vert, masqué si trop de temps restant)
export function getSlaState(ticket) {
  if (!ticket) return null;
  if (ticket.slaBreachedAt) return { state: 'breach', label: 'SLA dépassé' };

  const due = ticket.slaResponseDueAt ? new Date(ticket.slaResponseDueAt) : null;
  if (!due) return null;

  const now = new Date();
  if (now >= due) return { state: 'breach', label: 'SLA dépassé' };

  const createdAt = ticket.createdAt ? new Date(ticket.createdAt) : null;
  if (!createdAt) return null;

  const total = due.getTime() - createdAt.getTime();
  const remaining = due.getTime() - now.getTime();
  if (total <= 0) return null;

  const ratio = remaining / total;
  if (ratio <= 0.25) return { state: 'urgent', label: 'SLA urgent' };

  return null;
}

export function formatSlaRemaining(ticket) {
  if (!ticket?.slaResponseDueAt) return null;
  const due = new Date(ticket.slaResponseDueAt);
  const ms = due.getTime() - Date.now();
  if (ms <= 0) return null;
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours >= 24) return `${Math.floor(hours / 24)}j ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

const STYLES = {
  breach: 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30',
  urgent: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/30',
};

export default function SlaBadge({ ticket, showRemaining = true }) {
  const sla = getSlaState(ticket);
  if (!sla) return null;

  const remaining = showRemaining ? formatSlaRemaining(ticket) : null;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${STYLES[sla.state]}`}
      title={remaining ? `Délai de réponse restant : ${remaining}` : 'Délai de réponse dépassé'}
    >
      <Clock className="w-3 h-3" />
      {sla.label}
      {remaining ? ` · ${remaining}` : ''}
    </span>
  );
}
