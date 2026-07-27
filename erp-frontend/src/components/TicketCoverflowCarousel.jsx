/**
 * TicketCoverflowCarousel — Originkit-faithful Coverflow implementation
 *
 * Active card: wide landscape hero (738 × 400px, radius 16px)
 * Rest cards: narrow portrait slats (200 × 270px, radius 16px)
 * Navigation: white circular arrow buttons, no wheel scroll
 * Physics: linear rAF interpolation (no React re-renders during animation)
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  User,
  Clock,
  MapPin,
  Tag,
  Sparkles,
  ExternalLink,
} from 'lucide-react';

// ─── Constants ───────────────────────────────────────────────────────────────

const ACTIVE_W  = 738;
const ACTIVE_H  = 400;
const REST_W    = 200;
const REST_H    = 270;
const GAP       = 30;
const RADIUS    = 16;
const RENDER_R  = 5;   // how many side cards to render

// ─── Colour maps ─────────────────────────────────────────────────────────────

const PRIORITY_THEMES = {
  P1: { border: 'border-red-500/40',    bg: 'bg-red-500/10',    text: 'text-red-400',    label: 'P1 Critique', stripe: '#ef4444' },
  P2: { border: 'border-orange-500/40', bg: 'bg-orange-500/10', text: 'text-orange-400', label: 'P2 Haute',    stripe: '#f97316' },
  P3: { border: 'border-amber-500/40',  bg: 'bg-amber-500/10',  text: 'text-amber-400',  label: 'P3 Moyenne',  stripe: '#f59e0b' },
  P4: { border: 'border-blue-500/40',   bg: 'bg-blue-500/10',   text: 'text-blue-400',   label: 'P4 Basse',   stripe: '#3b82f6' },
};

const STATUS_THEMES = {
  NEW:     { bg: 'bg-blue-500/10 text-blue-400 border-blue-500/20',       label: 'Nouveau'    },
  OPEN:    { bg: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20', label: 'En cours'   },
  PENDING: { bg: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', label: 'En attente' },
  SOLVED:  { bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', label: 'Résolu'  },
  CLOSED:  { bg: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',       label: 'Fermé'      },
};

// ─── Math helpers ─────────────────────────────────────────────────────────────

/** Wrapped relative offset: always in (-count/2, count/2]
 *  Uses JS sign-preserving % so direction is correct:
 *  - negative rel → LEFT  (cards you passed going forward)
 *  - positive rel → RIGHT (cards coming next going forward)
 */
function relOf(idx, pos, count) {
  let r = (idx - pos) % count;           // JS keeps the sign
  if (r > count / 2)  r -= count;        // too far right → wrap left
  else if (r < -count / 2) r += count;   // too far left  → wrap right
  return r;
}

/** X centre of card at relative position `rel` from active */
function xForRel(rel) {
  const ar  = Math.abs(rel);
  const c1  = ACTIVE_W / 2 + GAP + REST_W / 2;   // dist to first slat
  const pitch = REST_W + GAP;                       // dist between slats
  const mag = ar <= 1 ? ar * c1 : c1 + (ar - 1) * pitch;
  return (rel < 0 ? -1 : 1) * mag;
}

/** 0 = fully active, 1 = fully resting */
function blend(rel) {
  return Math.min(Math.abs(rel), 1);
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function Card({ ticket, index, pos, count, onSelect }) {
  const navigate = useNavigate();

  // All visuals driven by pos MotionValue — zero React re-renders
  const x       = useTransform(pos, p => xForRel(relOf(index, p, count)));
  const opacity = useTransform(pos, p => {
    const ar = Math.abs(relOf(index, p, count));
    return ar <= RENDER_R ? 1 : ar >= RENDER_R + 1 ? 0 : 1 - (ar - RENDER_R);
  });
  const zIndex  = useTransform(pos, p => Math.round(1000 - Math.abs(relOf(index, p, count)) * 100));

  const width   = useTransform(pos, p => {
    const a = blend(relOf(index, p, count));
    return ACTIVE_W + (REST_W - ACTIVE_W) * a;
  });
  const height  = useTransform(pos, p => {
    const a = blend(relOf(index, p, count));
    return ACTIVE_H + (REST_H - ACTIVE_H) * a;
  });

  // Slight 3D tilt on side cards (Originkit feel)
  const rotateY = useTransform(pos, p => {
    const rel = relOf(index, p, count);
    const a   = blend(rel);
    return Math.sign(rel) * a * 12; // max 12° tilt
  });

  const activeOp = useTransform(pos, p => {
    const ar = Math.abs(relOf(index, p, count));
    return ar < 0.5 ? (0.5 - ar) / 0.5 : 0;
  });
  const restOp   = useTransform(pos, p => {
    const ar = Math.abs(relOf(index, p, count));
    return ar >= 0.5 ? Math.min(1, (ar - 0.5) / 0.5) : 0;
  });

  const boxShadow = useTransform(pos, p =>
    Math.abs(relOf(index, p, count)) < 0.5
      ? '0 28px 80px rgba(0,0,0,0.65), inset 0 0 0 1px rgba(251,191,36,0.3)'
      : '0 10px 36px rgba(0,0,0,0.5),  inset 0 0 0 1px rgba(255,255,255,0.06)'
  );

  const pTheme = PRIORITY_THEMES[ticket.priority] || PRIORITY_THEMES.P3;
  const sTheme = STATUS_THEMES[ticket.status]     || STATUS_THEMES.OPEN;

  return (
    <motion.div
      onClick={() => onSelect(index)}
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        translateX: '-50%',
        translateY: '-50%',
        x,
        zIndex,
        opacity,
        cursor: 'pointer',
        perspective: 800,
      }}
    >
      <motion.div
        style={{
          width,
          height,
          borderRadius: RADIUS,
          rotateY,
          boxShadow,
          overflow: 'hidden',
          position: 'relative',
          background: 'linear-gradient(135deg, #1e2130 0%, #141824 60%, #1e2130 100%)',
          border: '1px solid rgba(100,116,139,0.25)',
        }}
      >
        {/* Priority stripe */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 4,
          background: pTheme.stripe, borderRadius: `${RADIUS}px ${RADIUS}px 0 0`,
        }} />

        {/* ── HERO CONTENT (centre) ── */}
        <motion.div
          style={{ opacity: activeOp }}
          className="absolute inset-0 p-7 flex flex-col justify-between"
        >
          {/* Top */}
          <div className="flex items-center justify-between gap-3 border-b border-slate-700/40 pb-3">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-xl bg-amber-400/10 text-amber-400 font-mono font-bold text-xs border border-amber-400/25">
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
          <div className="my-auto space-y-2 py-2">
            <h3 className="text-2xl font-bold text-white leading-snug line-clamp-2">
              {ticket.title}
            </h3>
            <p className="text-sm text-slate-300 line-clamp-3 leading-relaxed">
              {ticket.description || 'Aucune description fournie.'}
            </p>
          </div>

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-3 text-xs text-slate-300 pt-3 border-t border-slate-700/40">
            <div className="flex items-center gap-2 truncate">
              <User className="size-4 text-amber-400 shrink-0" />
              <span className="truncate">{ticket.requester?.fullName || ticket.requesterEmail || 'Demandeur'}</span>
            </div>
            <div className="flex items-center gap-2 truncate">
              <Tag className="size-4 text-blue-400 shrink-0" />
              <span className="truncate">{ticket.category || 'Général'}</span>
            </div>
            <div className="flex items-center gap-2 truncate">
              <MapPin className="size-4 text-emerald-400 shrink-0" />
              <span className="truncate">{ticket.location?.name || 'Prosuma'}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-amber-400 shrink-0" />
              <span>{new Date(ticket.createdAt).toLocaleDateString('fr-FR')}</span>
            </div>
          </div>

          {/* Footer action */}
          <div className="pt-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center text-xs font-bold text-amber-400">
                {ticket.assignedTo?.fullName?.charAt(0) || '?'}
              </div>
              <span className="text-xs text-slate-300 font-medium truncate max-w-[180px]">
                {ticket.assignedTo?.fullName || 'Non assigné'}
              </span>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/tickets/${ticket.id}`); }}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-amber-500/25 hover:brightness-110 cursor-pointer"
            >
              Consulter Ticket
              <ExternalLink className="size-4" />
            </button>
          </div>
        </motion.div>

        {/* ── SLAT CONTENT (sides) ── */}
        <motion.div
          style={{ opacity: restOp }}
          className="absolute inset-0 p-4 flex flex-col justify-between pointer-events-none"
        >
          <div>
            <div className="flex items-center justify-between gap-1 mb-2">
              <span className="font-mono text-xs font-bold text-amber-400">#{ticket.id}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${pTheme.text}`}>
                {ticket.priority}
              </span>
            </div>
            <h4 className="text-xs font-semibold text-slate-200 line-clamp-5 leading-tight">
              {ticket.title}
            </h4>
          </div>
          <div className="pt-2 border-t border-slate-700/40 flex items-center justify-between text-[10px] text-slate-400">
            <span className="truncate">{sTheme.label}</span>
            <Clock className="size-3 shrink-0" />
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

// ─── Arrow button ─────────────────────────────────────────────────────────────

function ArrowBtn({ side, onClick, disabled }) {
  return (
    <button
      type="button"
      aria-label={side === 'left' ? 'Précédent' : 'Suivant'}
      disabled={disabled}
      onPointerDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); if (!disabled) onClick(); }}
      style={{
        position: 'absolute',
        top: '50%',
        [side === 'left' ? 'left' : 'right']: 24,
        transform: 'translateY(-50%)',
        width: 56, height: 56,
        borderRadius: '50%',
        background: disabled ? 'rgba(255,255,255,0.15)' : '#ffffff',
        color: disabled ? 'rgba(15,23,42,0.4)' : '#0f172a',
        border: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: 0,
        zIndex: 2000,
        boxShadow: disabled ? 'none' : '0 6px 20px rgba(0,0,0,0.4)',
        opacity: disabled ? 0.4 : 1,
        transition: 'opacity 0.2s, background 0.2s, box-shadow 0.2s',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <svg
        width={22} height={22}
        viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth={2.5}
        strokeLinecap="round" strokeLinejoin="round"
        style={{ pointerEvents: 'none' }}
      >
        {side === 'left'
          ? <polyline points="15 18 9 12 15 6" />
          : <polyline points="9 18 15 12 9 6" />
        }
      </svg>
    </button>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function TicketCoverflowCarousel({ tickets = [], isDark = true }) {
  const count = Math.max(1, tickets.length);
  const pos   = useMotionValue(0);

  // Linear (non-circular) position: 0 = first, count-1 = last
  const targetRef  = useRef(0);
  const rafRef     = useRef(null);
  const lastTRef   = useRef(null);
  // Track the currently displayed integer index for disabling arrows
  const [activeIdx, setActiveIdx] = React.useState(0);

  // Reset position when ticket list changes (filter change)
  useEffect(() => {
    targetRef.current = 0;
    pos.set(0);
    setActiveIdx(0);
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, [tickets]);

  const tick = useCallback((t) => {
    const last = lastTRef.current ?? t;
    const dt   = Math.min((t - last) / 1000, 1 / 30);
    lastTRef.current = t;

    const cur  = pos.get();
    const diff = targetRef.current - cur;
    const step = (1 / 0.35) * dt;   // 350ms settle

    if (Math.abs(diff) <= step) {
      pos.set(targetRef.current);
      setActiveIdx(Math.round(targetRef.current));
      rafRef.current  = null;
      lastTRef.current = null;
      return;
    }
    pos.set(cur + Math.sign(diff) * step);
    setActiveIdx(Math.round(pos.get()));
    rafRef.current = requestAnimationFrame(tick);
  }, [pos]);

  const start = useCallback(() => {
    if (rafRef.current == null) {
      lastTRef.current = null;
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  // Linear navigation — clamp at [0, count-1], no wrap
  const goNext = useCallback(() => {
    const next = Math.min(targetRef.current + 1, count - 1);
    if (next !== targetRef.current) { targetRef.current = next; start(); }
  }, [start, count]);

  const goPrev = useCallback(() => {
    const prev = Math.max(targetRef.current - 1, 0);
    if (prev !== targetRef.current) { targetRef.current = prev; start(); }
  }, [start]);

  const goTo = useCallback((idx) => {
    const clamped = Math.max(0, Math.min(idx, count - 1));
    if (clamped !== targetRef.current) { targetRef.current = clamped; start(); }
  }, [start, count]);

  // Keyboard support
  const handleKey = useCallback((e) => {
    if (e.key === 'ArrowLeft')  { e.preventDefault(); goPrev(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
  }, [goNext, goPrev]);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  const atStart = activeIdx <= 0;
  const atEnd   = activeIdx >= count - 1;

  if (tickets.length === 0) {
    return (
      <div className="w-full py-16 text-center text-slate-400 italic bg-slate-900/50 rounded-3xl border border-slate-700/50">
        Aucun ticket à afficher dans le carousel.
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="Coverflow des tickets"
      tabIndex={0}
      onKeyDown={handleKey}
      style={{
        position: 'relative',
        width: '100%',
        height: 520,
        overflow: 'hidden',
        outline: 'none',
        borderRadius: 24,
        background: 'linear-gradient(180deg, rgba(15,23,42,0.95) 0%, rgba(9,15,31,1) 50%, rgba(15,23,42,0.95) 100%)',
        border: '1px solid rgba(100,116,139,0.2)',
        marginTop: 16,
        marginBottom: 16,
        boxShadow: '0 32px 80px rgba(0,0,0,0.5)',
      }}
    >
      {/* Stage */}
      <div style={{ position: 'absolute', inset: 0 }}>
        {tickets.map((t, i) => (
          <Card
            key={t.id || i}
            ticket={t}
            index={i}
            pos={pos}
            count={count}
            onSelect={goTo}
          />
        ))}
      </div>

      {/* Navigation arrows */}
      {count > 1 && (
        <>
          <ArrowBtn side="left"  onClick={goPrev} disabled={atStart} />
          <ArrowBtn side="right" onClick={goNext} disabled={atEnd} />
        </>
      )}

      {/* Bottom bar: dots + counter */}
      {count > 1 && (
        <div style={{
          position: 'absolute',
          bottom: 18,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          zIndex: 10,
        }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {tickets.map((_, i) => (
              <DotIndicator key={i} index={i} pos={pos} count={count} onClick={() => goTo(i)} />
            ))}
          </div>
          <span style={{
            fontSize: 11,
            color: 'rgba(148,163,184,0.7)',
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '0.05em',
          }}>
            {activeIdx + 1} / {count}
          </span>
        </div>
      )}
    </div>
  );
}

function DotIndicator({ index, pos, count, onClick }) {
  const opacity = useTransform(pos, p => {
    const d = Math.abs(relOf(index, Math.round(p), count));
    return d === 0 ? 1 : 0.3;
  });
  const scale = useTransform(pos, p => {
    const d = Math.abs(relOf(index, Math.round(p), count));
    return d === 0 ? 1.4 : 1;
  });

  return (
    <motion.button
      onClick={onClick}
      style={{
        width: 7, height: 7,
        borderRadius: '50%',
        background: '#f59e0b',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        opacity,
        scale,
      }}
    />
  );
}
