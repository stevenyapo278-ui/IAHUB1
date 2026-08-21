import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ScrollText, GripVertical, User } from 'lucide-react';
import SlaBadge from './SlaBadge';
import { STATUS_CONFIG } from '../constants/tickets';

const KANBAN_STATUSES = ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'SOLVED'];

export default function KanbanBoard({ tickets, canAssign, onStatusChange }) {
  const navigate = useNavigate();
  const [dragOverCol, setDragOverCol] = useState(null);
  const [draggingId, setDraggingId] = useState(null);

  const byStatus = useMemo(() => {
    const map = Object.fromEntries(KANBAN_STATUSES.map((s) => [s, []]));
    tickets.forEach((t) => {
      const col = KANBAN_STATUSES.includes(t.status) ? t.status : 'OPEN';
      map[col].push(t);
    });
    return map;
  }, [tickets]);

  function handleDrop(status) {
    setDragOverCol(null);
    if (draggingId === null) return;
    const ticket = tickets.find((t) => t.id === draggingId);
    if (ticket && ticket.status !== status) onStatusChange(ticket, status);
    setDraggingId(null);
  }

  const COLORS = {
    NEW: { dot: 'bg-amber-500', head: 'text-amber-600 dark:text-amber-400', count: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25' },
    OPEN: { dot: 'bg-blue-500', head: 'text-blue-600 dark:text-blue-400', count: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/25' },
    PLANNED: { dot: 'bg-purple-500', head: 'text-purple-600 dark:text-purple-400', count: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/25' },
    PENDING: { dot: 'bg-yellow-500', head: 'text-yellow-600 dark:text-yellow-400', count: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/25' },
    SOLVED: { dot: 'bg-emerald-500', head: 'text-emerald-600 dark:text-emerald-400', count: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25' },
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {KANBAN_STATUSES.map((status) => {
        const color = COLORS[status];
        const colTickets = byStatus[status];
        const isOver = dragOverCol === status;
        return (
          <div
            key={status}
            onDragOver={(e) => {
              if (!canAssign) return;
              e.preventDefault();
              setDragOverCol(status);
            }}
            onDragLeave={() => setDragOverCol((c) => (c === status ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(status);
            }}
            className={`rounded-2xl border flex flex-col max-h-[65vh] transition-colors ${
              isOver ? 'border-primary/60 bg-primary/5' : 'border-outline-variant/30 bg-surface-container-low/30'
            }`}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-outline-variant/20">
              <span className={`w-2.5 h-2.5 rounded-full ${color.dot}`} />
              <span className={`text-[11px] font-black uppercase tracking-widest ${color.head}`}>
                {STATUS_CONFIG[status]?.label || status}
              </span>
              <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${color.count}`}>
                {colTickets.length}
              </span>
            </div>

            <div className={`p-2.5 space-y-2 overflow-y-auto flex-1 ${isOver ? 'bg-primary/5' : ''}`}>
              <AnimatePresence>
                {colTickets.map((t) => (
                  <motion.div
                    key={t.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    draggable={canAssign}
                    onDragStart={() => setDraggingId(t.id)}
                    onDragEnd={() => { setDraggingId(null); setDragOverCol(null); }}
                    onClick={() => navigate(`/tickets/${t.id}`)}
                    className={`p-3 rounded-xl border bg-surface-container-lowest shadow-sm transition-all hover:shadow-md group cursor-pointer ${
                      draggingId === t.id ? 'opacity-50 scale-95' : ''
                    } ${canAssign ? 'hover:border-primary/40' : ''}`}
                  >
                    <div className="flex items-start gap-2">
                      {canAssign && (
                        <GripVertical className="w-3.5 h-3.5 text-outline/50 mt-0.5 shrink-0 group-hover:text-on-surface-variant transition-colors" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="font-mono text-[10px] font-bold text-primary">#{t.id}</span>
                          {t.priority && (
                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${t.priority === 'P1' ? 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/25' : t.priority === 'P2' ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/25' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/25'}`}>
                              {t.priority}
                            </span>
                          )}
                          {t.category && (
                            <span className="text-[9px] text-on-surface-variant truncate max-w-[100px] bg-surface-container-high px-1.5 py-0.5 rounded-full font-medium">
                              {t.category}
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-bold text-on-surface line-clamp-2 leading-snug group-hover:text-primary transition-colors">
                          {t.title}
                        </p>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <SlaBadge ticket={t} compact />
                          {t.assignedTo ? (
                            <span className="flex items-center gap-1 text-[9px] text-on-surface-variant truncate max-w-[90px]">
                              <User className="w-2.5 h-2.5 shrink-0" />
                              <span className="truncate">{t.assignedTo.fullName}</span>
                            </span>
                          ) : (
                            <span className="text-[9px] text-outline italic">Non assigné</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {colTickets.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-6 text-on-surface-variant/60 border border-dashed border-outline-variant/40 rounded-xl">
                  <ScrollText className="w-4 h-4" />
                  <p className="text-[10px] font-semibold">Aucun ticket</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}