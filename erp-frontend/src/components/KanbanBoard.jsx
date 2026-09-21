import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ScrollText, GripVertical, User } from 'lucide-react';
import SlaBadge from './SlaBadge';

const COLUMNS = [
  { key: 'OPEN', label: 'Ouverts', statuses: ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER'], color: { dot: 'bg-blue-500', head: 'text-blue-600 dark:text-blue-400', count: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/25' } },
  { key: 'SOLVED', label: 'Résolu', statuses: ['SOLVED'], color: { dot: 'bg-emerald-500', head: 'text-emerald-600 dark:text-emerald-400', count: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25' } },
  { key: 'CLOSED', label: 'Fermé', statuses: ['CLOSED'], color: { dot: 'bg-slate-400', head: 'text-slate-500 dark:text-slate-400', count: 'bg-slate-400/10 text-slate-500 dark:text-slate-400 border border-slate-400/25' } },
];

const STATUS_TO_COL = Object.fromEntries(COLUMNS.flatMap((col) => col.statuses.map((s) => [s, col.key])));

export default function KanbanBoard({ tickets, canAssign, onStatusChange }) {
  const navigate = useNavigate();
  const [dragOverCol, setDragOverCol] = useState(null);
  const [draggingId, setDraggingId] = useState(null);

  const byColumn = useMemo(() => {
    const map = Object.fromEntries(COLUMNS.map((c) => [c.key, []]));
    tickets.forEach((t) => {
      const col = STATUS_TO_COL[t.status] || 'OPEN';
      map[col].push(t);
    });
    return map;
  }, [tickets]);

  function handleDrop(colKey) {
    setDragOverCol(null);
    if (draggingId === null) return;
    const ticket = tickets.find((t) => t.id === draggingId);
    if (!ticket) { setDraggingId(null); return; }
    const col = COLUMNS.find((c) => c.key === colKey);
    const targetStatus = col.statuses.includes(ticket.status) ? ticket.status : col.statuses[0];
    if (ticket.status !== targetStatus) onStatusChange(ticket, targetStatus);
    setDraggingId(null);
  }

  return (
    <div className="grid grid-cols-3 gap-4 min-w-0">
      {COLUMNS.map((col) => {
        const colTickets = byColumn[col.key];
        const isOver = dragOverCol === col.key;
        return (
          <div
            key={col.key}
            onDragOver={(e) => { if (!canAssign) return; e.preventDefault(); setDragOverCol(col.key); }}
            onDragLeave={() => setDragOverCol((c) => (c === col.key ? null : c))}
            onDrop={(e) => { e.preventDefault(); handleDrop(col.key); }}
            className={`min-w-0 rounded-2xl border flex flex-col max-h-[70vh] transition-colors ${
              isOver ? 'border-primary/60 bg-primary/5' : 'border-outline-variant/30 bg-surface-container-low/30'
            }`}
          >
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-outline-variant/20 shrink-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${col.color.dot}`} />
              <span className={`text-[10px] font-black uppercase tracking-widest ${col.color.head} truncate`}>
                {col.label}
              </span>
              <span className={`ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${col.color.count}`}>
                {colTickets.length}
              </span>
            </div>

            <div className={`p-2 space-y-1.5 overflow-y-auto flex-1 min-h-0 ${isOver ? 'bg-primary/5' : ''}`}>
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
                    className={`p-2.5 rounded-xl border bg-surface-container-lowest shadow-sm transition-all hover:shadow-md cursor-pointer min-w-0 ${
                      draggingId === t.id ? 'opacity-50 scale-95' : ''
                    } ${canAssign ? 'hover:border-primary/40' : ''}`}
                  >
                    <div className="flex items-start gap-1.5">
                      {canAssign && (
                        <GripVertical className="w-3 h-3 text-outline/50 mt-0.5 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 mb-1 flex-wrap">
                          <span className="font-mono text-[9px] font-bold text-primary">#{t.id}</span>
                          {t.priority && (
                            <span className={`text-[8px] font-black px-1 py-0.5 rounded ${t.priority === 'P1' ? 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/25' : t.priority === 'P2' ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/25' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/25'}`}>
                              {t.priority}
                            </span>
                          )}
                          {t.category && (
                            <span className="text-[8px] text-on-surface-variant truncate max-w-[80px] bg-surface-container-high px-1 py-0.5 rounded-full font-medium">
                              {t.category}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] font-bold text-on-surface line-clamp-2 leading-snug group-hover:text-primary transition-colors">
                          {t.title}
                        </p>
                        <div className="mt-1 flex items-center gap-1">
                          <SlaBadge ticket={t} compact />
                          {t.assignedTo ? (
                            <span className="flex items-center gap-0.5 text-[8px] text-on-surface-variant truncate max-w-[80px]">
                              <User className="w-2.5 h-2.5 shrink-0" />
                              <span className="truncate">{t.assignedTo.fullName}</span>
                            </span>
                          ) : (
                            <span className="text-[8px] text-outline italic">Non assigné</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {colTickets.length === 0 && (
                <div className="flex flex-col items-center gap-1.5 py-5 text-on-surface-variant/60 border border-dashed border-outline-variant/40 rounded-xl">
                  <ScrollText className="w-3.5 h-3.5" />
                  <p className="text-[9px] font-semibold">Aucun ticket</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
