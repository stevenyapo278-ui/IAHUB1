import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronRight, Loader2, RotateCcw, Ticket, User } from 'lucide-react';
import { CATEGORY_ICONS, KIND_ICONS, STATUS_LABELS, CENTER_TYPE_LABEL } from './labels';
import { itemColor } from './fanLayout';

// ─── Mode « carte mentale » ──────────────────────────────────────────────────
// Arbre horizontal : racine (centre) → branches (catégories, pliables) →
// feuilles (éléments). Géométrie analytique pure (aucune mesure DOM), SVG pour
// les connecteurs (pathLength, jamais d'animation sur `d`), HTML pour les nœuds.
// Le composant est re-monté à chaque changement de centre (key côté parent) :
// pas d'effet de réinitialisation d'état.

const PAD = 36;
const ROOT = { w: 240, h: 84 };
const CAT = { w: 216, h: 64, gapY: 16 };
const ITEM = { w: 256, h: 58, gapY: 8 };
const COL_GAP = 104;
const MIN_H = 620;
const MIN_W = 960;

const initials = (label = '?') =>
  label.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function centerSub(centerType, sub) {
  if (!sub || sub === 'Lieu') return CENTER_TYPE_LABEL[centerType] || '';
  return `${CENTER_TYPE_LABEL[centerType] || ''} · ${STATUS_LABELS[sub] || sub}`;
}

export default function MindMapMode({
  centerType, centerId, centerData, loading, error, empty,
  loadCategory, onItem, onMore, onPickCenter,
}) {
  const reduce = useReducedMotion();
  const [expanded, setExpanded] = useState(() => new Set());
  const [data, setData] = useState({}); // key → {status:'loading'|'ready'|'error', items, total}

  async function ensure(key) {
    if (data[key]?.status) return;
    setData((d) => ({ ...d, [key]: { status: 'loading' } }));
    try {
      const res = await loadCategory(key);
      setData((d) => ({ ...d, [key]: { status: 'ready', items: res.items || [], total: res.total ?? 0 } }));
    } catch {
      setData((d) => ({ ...d, [key]: { status: 'error' } }));
    }
  }

  function toggle(cat) {
    const open = expanded.has(cat.key);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.delete(cat.key); else next.add(cat.key);
      return next;
    });
    if (!open) ensure(cat.key);
  }

  // ── Géométrie ───────────────────────────────────────────────────────────
  const geom = useMemo(() => {
    const cats = centerData?.categories || [];
    const itemX = PAD + ROOT.w + COL_GAP + CAT.w + COL_GAP;
    const branches = [];
    let y = PAD;
    for (const c of cats) {
      const isOpen = expanded.has(c.key);
      const entry = data[c.key];
      const items = isOpen && entry?.status === 'ready' ? entry.items : [];
      const total = isOpen && entry?.status === 'ready' ? entry.total : (c.count || 0);
      const leaves = items.map((item, i) => ({
        kind: 'item', item, x: itemX, y: y + CAT.h + ITEM.gapY + i * (ITEM.h + ITEM.gapY),
      }));
      let nextY = y + CAT.h + (leaves.length ? ITEM.gapY + leaves.length * (ITEM.h + ITEM.gapY) : 0);
      if (leaves.length && total > items.length) {
        leaves.push({ kind: 'more', cat: c, total, shown: items.length, x: itemX, y: nextY });
        nextY += ITEM.h + ITEM.gapY;
      }
      branches.push({ cat: c, x: PAD + ROOT.w + COL_GAP, y, isOpen, entry, leaves, total });
      y = nextY + CAT.gapY;
    }
    const height = Math.max(MIN_H, y + PAD - CAT.gapY + PAD);
    const width = Math.max(MIN_W, itemX + ITEM.w + PAD);
    const rootY = Math.round(height / 2 - ROOT.h / 2);
    return { branches, height, width, rootX: PAD, rootY, itemX };
  }, [centerData, expanded, data]);

  const rootLabel = centerData?.center?.label;
  const dx = COL_GAP * 0.45;

  return (
    <div className="relative overflow-auto rounded-xl"
      style={{
        height: MIN_H,
        background: 'radial-gradient(1100px 520px at 26% 42%, #16213a 0%, #0b1120 55%, #070b14 100%)',
      }}
    >
      <div className="relative" style={{ width: geom.width, height: geom.height, minWidth: '100%' }}>
        {/* Connecteurs */}
        <svg width={geom.width} height={geom.height}
          className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <defs>
            <filter id="mind-glow" x="-120%" y="-120%" width="340%" height="340%">
              <feGaussianBlur stdDeviation="2.2" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {centerData && geom.branches.map((b, i) => {
            const x1 = geom.rootX + ROOT.w;
            const y1 = geom.rootY + ROOT.h / 2;
            const x2 = b.x;
            const y2 = b.y + CAT.h / 2;
            return (
              <motion.path
                key={`r-${b.cat.key}`}
                d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={b.isOpen ? 'rgba(96,165,250,0.85)' : 'rgba(148,163,184,0.68)'}
                strokeWidth={b.isOpen ? 2.2 : 1.8}
                initial={{ opacity: reduce ? 1 : 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: reduce ? 0 : 0.4, delay: reduce ? 0 : i * 0.05 }}
              />
            );
          })}
          {centerData && geom.branches.flatMap((b) => b.leaves.map((leaf) => {
            const color = leaf.kind === 'item' ? itemColor(leaf.item) : 'rgba(148,163,184,0.6)';
            const x1 = b.x + CAT.w;
            const y1 = b.y + CAT.h / 2;
            const x2 = leaf.x;
            const y2 = leaf.y + ITEM.h / 2;
            return (
              <motion.path
                key={`${b.cat.key}-${leaf.kind}-${leaf.kind === 'item' ? `${leaf.item.kind}-${leaf.item.id}` : leaf.total}`}
                d={`M ${x1} ${y1} C ${x1 + dx * 0.7} ${y1}, ${x2 - dx * 0.7} ${y2}, ${x2} ${y2}`}
                fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round"
                initial={{ opacity: 0 }}
                animate={{ opacity: leaf.kind === 'item' ? 0.9 : 0.55 }}
                transition={{ duration: reduce ? 0 : 0.4 }}
              />
            );
          }))}
        </svg>

        {/* Racine */}
        <button
          type="button"
          onClick={onPickCenter}
          title="Choisir un centre"
          className="absolute flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-left text-slate-100 backdrop-blur transition hover:border-primary/50"
          style={{ left: geom.rootX, top: geom.rootY, width: ROOT.w, height: ROOT.h }}
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/25 text-sm font-bold text-slate-100">
            {rootLabel ? initials(rootLabel) : '…'}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{rootLabel || 'Centre'}</span>
            <span className="block truncate text-xs text-slate-400">
              {centerData ? centerSub(centerType, centerData.center.sub) : 'Chargement…'}
            </span>
          </span>
        </button>

        {/* Branches (catégories) */}
        {centerData && geom.branches.map((b) => {
          const Icon = CATEGORY_ICONS[b.cat.key] || Ticket;
          const isOpen = b.isOpen;
          const st = b.entry?.status;
          return (
            <button
              key={b.cat.key}
              type="button"
              onClick={() => toggle(b.cat)}
              aria-expanded={isOpen}
              className="absolute flex items-center justify-between gap-3 rounded-xl border px-3 text-left backdrop-blur transition"
              style={{
                left: b.x, top: b.y, width: CAT.w, height: CAT.h,
                borderColor: isOpen ? 'rgba(96,165,250,0.7)' : 'rgba(255,255,255,0.10)',
                background: isOpen ? 'rgba(96,165,250,0.15)' : 'rgba(255,255,255,0.055)',
              }}
            >
              <span className="flex min-w-0 items-center gap-2 text-sm text-slate-200">
                <Icon size={16} className="shrink-0" style={{ color: isOpen ? '#60a5fa' : undefined }} />
                <span className="truncate">{b.cat.label}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
                  style={{ background: 'rgba(255,255,255,0.10)', color: isOpen ? '#93c5fd' : '#cbd5e1' }}>
                  {st === 'loading' ? <Loader2 size={11} className="animate-spin" /> : b.total}
                </span>
                <ChevronRight size={14}
                  className="transition-transform" style={{ transform: isOpen ? 'rotate(90deg)' : 'none', opacity: 0.6 }} />
              </span>
            </button>
          );
        })}

        {/* Feuilles (éléments) */}
        {centerData && geom.branches.flatMap((b) => b.leaves.map((leaf) => {
          if (leaf.kind === 'more') {
            return (
              <button
                key={`${b.cat.key}-more`}
                type="button"
                onClick={() => onMore(leaf.cat.key)}
                title={`Voir les ${leaf.total} éléments`}
                className="absolute flex items-center gap-2 rounded-xl border border-dashed border-white/25 px-3 text-left text-slate-300 backdrop-blur transition hover:border-primary/50 hover:text-slate-100"
                style={{ left: leaf.x, top: leaf.y, width: ITEM.w, height: ITEM.h }}
              >
                <span className="truncate text-sm">+ {leaf.total - leaf.shown} autres…</span>
              </button>
            );
          }
          const item = leaf.item;
          const Icon = KIND_ICONS[item.kind] || User;
          const color = itemColor(item);
          return (
            <motion.button
              key={`${b.cat.key}-${item.kind}-${item.id}`}
              type="button"
              onClick={() => onItem(item)}
              title={item.recenter && (item.kind === 'lieu' || item.kind === 'technicien')
                ? `Explorer « ${item.label} » (clic)` : 'Voir le détail et les sauts'}
              initial={{ opacity: reduce ? 1 : 0, x: reduce ? 0 : -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: reduce ? 0 : 0.3 }}
              className="absolute flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-left backdrop-blur transition hover:border-white/25 hover:bg-white/10"
              style={{ left: leaf.x, top: leaf.y, width: ITEM.w, height: ITEM.h }}
            >
              <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: color }} />
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-100">
                  <Icon size={13} className="shrink-0 opacity-70" />
                  <span className="truncate">{item.ref || item.label}</span>
                  {item.priority && (
                    <span className="shrink-0 rounded px-1 text-[10px] font-bold"
                      style={{ background: `${color}26`, color }}>{item.priority}</span>
                  )}
                </span>
                <span className="truncate text-[11px] text-slate-400">
                  {item.ref ? item.label : (item.meta || (item.count != null ? `${item.count} ticket(s)` : ''))}
                </span>
              </span>
            </motion.button>
          );
        }))}

        {/* Branches en erreur */}
        {centerData && geom.branches.filter((b) => b.entry?.status === 'error').map((b) => (
          <button
            key={`${b.cat.key}-err`}
            type="button"
            onClick={() => { setData((d) => ({ ...d, [b.cat.key]: undefined })); ensure(b.cat.key); }}
            className="absolute flex items-center gap-2 rounded-xl border border-red-400/40 bg-red-500/10 px-3 text-sm text-red-300 backdrop-blur"
            style={{ left: b.x, top: b.y + CAT.h + ITEM.gapY, width: CAT.w }}
          >
            <RotateCcw size={13} /> Réessayer
          </button>
        ))}

        {/* États */}
        {loading && (
          <div className="absolute inset-x-0 top-1/2 flex items-center justify-center gap-2 text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin" /> Chargement du centre…
          </div>
        )}
        {!loading && error}
        {!loading && !error && empty}
        {centerData && !expanded.size && (
          <p className="absolute text-sm text-slate-400"
            style={{ left: PAD + ROOT.w + COL_GAP, top: geom.rootY + ROOT.h + 40 }}>
            Dépliez une branche pour dérouler ses éléments →
          </p>
        )}
      </div>
    </div>
  );
}
