import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const STATUS_TONES = { NEW: 'primary', OPEN: 'info', PENDING: 'warning', SOLVED: 'success', CLOSED: 'neutral' };
const STATUS_LABELS = { NEW: 'Nouveau', OPEN: 'Ouvert', PENDING: 'En attente', SOLVED: 'Résolu', CLOSED: 'Fermé' };
const PRIORITY_COLORS = { P1: '#ef4444', P2: '#f97316', P3: '#3b82f6', P4: '#10b981' };

function getTimeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days}j`;
}

function StatusBadge({ status }) {
  const tone = STATUS_TONES[status] || 'neutral';
  const label = STATUS_LABELS[status] || status;
  const toneClasses = {
    primary: 'bg-primary/10 text-primary border-primary/20',
    info: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    warning: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    success: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    neutral: 'bg-surface-container text-on-surface-variant border-outline-variant/30',
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${toneClasses[tone]}`}>
      {label}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const color = PRIORITY_COLORS[priority] || '#6b7280';
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold border"
      style={{ color, borderColor: `${color}33`, backgroundColor: `${color}10` }}>
      {priority}
    </span>
  );
}

export default function RecentTicketsWidget({ activity, config }) {
  const navigate = useNavigate();
  const items = (activity || []).slice(0, 6);

  if (!items.length) {
    return <p className="text-xs text-on-surface-variant italic text-center py-4">Aucune activité récente</p>;
  }

  return (
    <div className="space-y-3 h-full w-full">
      {items.map((a, i) => (
        <motion.div
          key={a.id || i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: i * 0.04 }}
          className="flex items-start gap-3 group cursor-pointer"
          onClick={() => navigate(`/tickets/${a.id}`)}
        >
          <div className="relative mt-1">
            <div className="w-2 h-2 rounded-full bg-primary" />
            {i < items.length - 1 && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 w-px h-6 bg-outline-variant" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              {a.priority && <PriorityBadge priority={a.priority} />}
              <p className="text-xs font-semibold text-on-surface truncate group-hover:text-primary transition-colors">
                #{a.id} {a.title}
              </p>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              {a.status && <StatusBadge status={a.status} />}
              <span className="text-[10px] text-on-surface-variant">
                {a.assignee?.fullName || 'Non assigné'} · {getTimeAgo(a.updatedAt)}
              </span>
            </div>
          </div>
          <ChevronRight className="w-3 h-3 text-on-surface-variant/40 shrink-0 mt-1 group-hover:text-primary transition-colors" />
        </motion.div>
      ))}
    </div>
  );
}
