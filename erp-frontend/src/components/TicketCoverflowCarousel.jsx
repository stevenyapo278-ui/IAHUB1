/**
 * TicketCoverflowCarousel — Katalyst-style slide carousel
 *
 * Mode: slide with framer-motion AnimatePresence
 * Navigation: arrow buttons + dot indicators + keyboard
 * Each slide is a full ticket card
 */
import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  User,
  Clock,
  MapPin,
  Tag,
  Sparkles,
  ExternalLink,
} from 'lucide-react';

// ─── Themes ───────────────────────────────────────────────────────────────────

const PRIORITY_THEMES = {
  P1: { border: 'border-red-500/40', bg: 'bg-red-500/10', text: 'text-red-400', label: 'P1 Critique', stripe: '#ef4444' },
  P2: { border: 'border-orange-500/40', bg: 'bg-orange-500/10', text: 'text-orange-400', label: 'P2 Haute', stripe: '#f97316' },
  P3: { border: 'border-amber-500/40', bg: 'bg-amber-500/10', text: 'text-amber-400', label: 'P3 Moyenne', stripe: '#f59e0b' },
  P4: { border: 'border-blue-500/40', bg: 'bg-blue-500/10', text: 'text-blue-400', label: 'P4 Basse', stripe: '#3b82f6' },
};

const STATUS_THEMES = {
  NEW:     { bg: 'bg-blue-500/10 text-blue-400 border-blue-500/20', label: 'Nouveau' },
  OPEN:    { bg: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20', label: 'En cours' },
  PLANNED: { bg: 'bg-purple-500/10 text-purple-400 border-purple-500/20', label: 'Planifié' },
  PENDING: { bg: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', label: 'En attente' },
  SOLVED:  { bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', label: 'Résolu' },
  CLOSED:  { bg: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20', label: 'Fermé' },
};

// ─── Slide variants ───────────────────────────────────────────────────────────

const slideVariants = {
  enter: (direction) => ({
    x: direction >= 0 ? '100%' : '-100%',
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction) => ({
    x: direction >= 0 ? '-100%' : '100%',
    opacity: 0,
  }),
};

const slideTransition = { x: { type: 'tween', duration: 0.35, ease: 'easeInOut' }, opacity: { duration: 0.25 } };

// ─── Ticket Card ──────────────────────────────────────────────────────────────

function TicketSlide({ ticket, isDark }) {
  const navigate = useNavigate();
  const pTheme = PRIORITY_THEMES[ticket.priority] || PRIORITY_THEMES.P3;
  const sTheme = STATUS_THEMES[ticket.status] || STATUS_THEMES.OPEN;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-border bg-surface-muted">
      {/* Priority stripe */}
      <div className="absolute top-0 left-0 right-0 h-1 rounded-t-xl" style={{ background: pTheme.stripe }} />

      {/* Card content */}
      <div className="p-6 sm:p-8 flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border/30 pb-4">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="px-3 py-1 rounded-xl bg-primary/10 text-primary font-mono font-bold text-sm border border-primary/20">
              #{ticket.id}
            </span>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${sTheme.bg}`}>
              {sTheme.label}
            </span>
            {ticket.aiProcessed && (
              <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 text-xs font-bold border border-purple-500/25">
                <Sparkles className="size-3.5" /> IA Triage
              </span>
            )}
          </div>
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-xl border text-xs font-bold ${pTheme.bg} ${pTheme.border} ${pTheme.text}`}>
            {pTheme.label}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 py-5 space-y-2">
          <h3 className="text-xl sm:text-2xl font-bold text-on-surface leading-snug line-clamp-2">
            {ticket.title}
          </h3>
          <p className="text-sm text-on-surface-variant line-clamp-3 leading-relaxed">
            {ticket.content || 'Aucune description fournie.'}
          </p>
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-on-surface-variant pt-4 border-t border-border/30">
          <div className="flex items-center gap-2 truncate">
            <User className="size-4 text-primary shrink-0" />
            <span className="truncate">{ticket.requester?.fullName || 'Demandeur'}</span>
          </div>
          <div className="flex items-center gap-2 truncate">
            <Tag className="size-4 text-blue-400 shrink-0" />
            <span className="truncate">{ticket.category || 'Général'}</span>
          </div>
          <div className="flex items-center gap-2 truncate">
            <MapPin className="size-4 text-emerald-400 shrink-0" />
            <span className="truncate">{ticket.glpiLocationName || 'Prosuma'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-amber-400 shrink-0" />
            <span>{new Date(ticket.createdAt).toLocaleDateString('fr-FR')}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary">
              {ticket.assignedTo?.fullName?.charAt(0) || '?'}
            </div>
            <span className="text-xs text-on-surface-variant font-medium truncate max-w-[200px]">
              {ticket.assignedTo?.fullName || 'Non assigné'}
            </span>
          </div>
          <button
            onClick={() => navigate(`/tickets/${ticket.id}`)}
            className="btn-primary px-5 py-2.5 text-xs flex items-center gap-2"
          >
            Consulter
            <ExternalLink className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Carousel ────────────────────────────────────────────────────────────

export default function TicketCoverflowCarousel({ tickets = [] }) {
  const [[index, direction], setIndex] = useState([0, 0]);
  const [isPaused, setIsPaused] = useState(false);

  const count = tickets.length;

  const goTo = useCallback((newIndex) => {
    const dir = newIndex > index ? 1 : -1;
    setIndex([newIndex, dir]);
  }, [index]);

  const goNext = useCallback(() => {
    if (count <= 1) return;
    const next = (index + 1) % count;
    setIndex([next, 1]);
  }, [index, count]);

  const goPrev = useCallback(() => {
    if (count <= 1) return;
    const prev = (index - 1 + count) % count;
    setIndex([prev, -1]);
  }, [index, count]);

  // Autoplay
  useEffect(() => {
    if (isPaused || count <= 1) return;
    const timer = setInterval(goNext, 4000);
    return () => clearInterval(timer);
  }, [isPaused, goNext, count]);

  // Keyboard
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrev]);

  if (count === 0) {
    return (
      <div className="w-full py-16 text-center text-on-surface-variant/60 italic bento-card">
        Aucun ticket à afficher dans le carousel.
      </div>
    );
  }

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-border bg-surface-muted"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Slides */}
      <div className="relative aspect-[16/7]">
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div
            key={tickets[index]?.id || index}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={slideTransition}
            className="absolute inset-0"
          >
            <TicketSlide ticket={tickets[index]} />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Arrow buttons */}
      {count > 1 && (
        <>
          <button
            type="button"
            onClick={goPrev}
            aria-label="Précédent"
            className="absolute left-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-surface/80 text-foreground shadow-md backdrop-blur transition-colors hover:bg-surface z-10"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={goNext}
            aria-label="Suivant"
            className="absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-surface/80 text-foreground shadow-md backdrop-blur transition-colors hover:bg-surface z-10"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}

      {/* Dot indicators */}
      {count > 1 && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5 z-10">
          {tickets.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Slide ${i + 1}`}
              aria-current={i === index ? 'true' : undefined}
              className={`h-1.5 rounded-full transition-all ${i === index ? 'w-5 bg-primary' : 'w-1.5 bg-surface/70 hover:bg-surface'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
