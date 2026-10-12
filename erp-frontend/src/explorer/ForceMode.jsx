import { useEffect, useMemo, useRef, useState } from 'react';
import { select } from 'd3-selection';
import { zoom, zoomIdentity } from 'd3-zoom';
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceRadial,
} from 'd3-force';
import { Loader2, Route, Radar, RotateCcw, X } from 'lucide-react';
import api from '../api/client';
import { KIND_COLORS } from './fanLayout';
import { KIND_LABELS, CENTER_TYPE_LABEL, STATUS_LABELS } from './labels';
import {
  RING_GUIDES, RING_LABELS, ringRadius, nodeRadius, nodeFill,
  edgePoint, bfsPath, bfsReach, linkKey, mergeNeighborhoods,
} from './forceGraph';

// ─── Mode « Cosmos » (graphe force-directed, d3-force) ───────────────────────
// 4ᵉ mode de /explorer : voisinage 1-2 sauts (/api/graph/neighborhood) mis en
// page par une simulation physique avec anneaux concentriques par kind
// (forceRadial) — zoom/pan (d3-zoom), drag de nœuds, plus court chemin BFS et
// sphère d'influence (patterns network-graph). Chunk lazy : d3 isolé de la page.
// Positions lues via l'état simData (publish à chaque tick) pour rester
// compatible React Compiler (pas de lecture de ref pendant le render).

const STAGE_H = 620;
const STAGE_MIN_W = 900;

export default function ForceMode({
  centerType, centerId, pinType, pinId,
  onRecenter, onPickCenter,
}) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const simRef = useRef(null);
  const zoomBehaviorRef = useRef(null);
  const transformRef = useRef(zoomIdentity);
  const dragStateRef = useRef(null);

  const [graph, setGraph] = useState(null);
  const [status, setStatus] = useState({ loading: true, error: null });
  const [simData, setSimData] = useState({ nodes: [], links: [] });
  const [stageW, setStageW] = useState(STAGE_MIN_W);
  const [isDragging, setIsDragging] = useState(false);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [hoverKey, setHoverKey] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [pathMode, setPathMode] = useState(false);
  const [pathSel, setPathSel] = useState([]);
  const [pathPairs, setPathPairs] = useState(null);
  const [pathChain, setPathChain] = useState(null);
  const [influenceMode, setInfluenceMode] = useState(false);
  const [influenceKey, setInfluenceKey] = useState(null);
  const [influenceSet, setInfluenceSet] = useState(null);
  const [activeKinds, setActiveKinds] = useState(() => new Set());

  const reduce = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Liens bruts (clés string) dérivés du graphe — BFS + voisinage hover
  const rawLinks = graph?.links || [];

  // ── Chargement du voisinage (1 ou 2 centres si épingle) ───────────────────
  // Le composant est re-keyé par ExplorerPage à chaque changement de centre :
  // l'état initial { loading: true } suffit, pas de reset synchrone ici.
  useEffect(() => {
    let cancelled = false;
    const fetchOne = (type, id) => api
      .get(`/graph/neighborhood/${type}/${encodeURIComponent(id)}`, { params: { depth: 2 } })
      .then((r) => r.data);
    const jobs = [fetchOne(centerType, centerId)];
    if (pinType && pinId != null && !(pinType === centerType && String(pinId) === String(centerId))) {
      jobs.push(fetchOne(pinType, pinId));
    }
    Promise.all(jobs)
      .then((results) => {
        if (cancelled) return;
        setGraph(mergeNeighborhoods(results));
        setStatus({ loading: false, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setGraph(null);
        setStatus({
          loading: false,
          error: err?.response?.data?.error || 'Voisinage indisponible',
        });
      });
    return () => { cancelled = true; };
  }, [centerType, centerId, pinType, pinId]);

  // ── Taille du stage → centre des anneaux (state, lisible au render) ───────
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth || STAGE_MIN_W;
      setStageW((prev) => {
        if (Math.abs(w - prev) < 4) return prev;
        const sim = simRef.current;
        if (sim) {
          const cx = w / 2;
          sim.force('radial')?.x(cx);
          sim.force('center')?.x(cx);
          for (const n of sim.nodes()) {
            if (n.isCenter) n.fx = cx;
          }
          sim.alpha(0.25).restart();
        }
        return w;
      });
    });
    ro.observe(wrap);
    setStageW(wrap.clientWidth || STAGE_MIN_W);
    return () => ro.disconnect();
  }, []);

  // ── Simulation (recréée à chaque changement de graphe) ────────────────────
  useEffect(() => {
    if (!graph?.nodes?.length) {
      simRef.current?.stop();
      simRef.current = null;
      queueMicrotask(() => setSimData({ nodes: [], links: [] }));
      return undefined;
    }
    const cx = (wrapRef.current?.clientWidth || STAGE_MIN_W) / 2;
    const cy = STAGE_H / 2;

    const nodes = graph.nodes.map((n) => {
      const r = nodeRadius(n);
      const rr = ringRadius(n);
      // Angle déterministe stable par clé (cohérent avec le fallback de rendu)
      let h = 0;
      for (let i = 0; i < n.key.length; i += 1) h = (h * 31 + n.key.charCodeAt(i)) | 0;
      const ang = ((Math.abs(h) % 360) / 360) * Math.PI * 2;
      const node = {
        ...n,
        r,
        x: n.x ?? cx + Math.cos(ang) * (rr || 40),
        y: n.y ?? cy + Math.sin(ang) * (rr || 40),
      };
      if (node.isCenter) {
        node.fx = cx;
        node.fy = cy;
      }
      return node;
    });
    const linkObjs = graph.links.map((l) => ({ ...l }));

    const sim = forceSimulation(nodes)
      .force('link', forceLink(linkObjs)
        .id((d) => d.key)
        .distance((l) => 64 + Math.abs(ringRadius(l.source) - ringRadius(l.target)) * 0.3)
        .strength(0.35))
      .force('charge', forceManyBody().strength(-105).distanceMax(480))
      .force('collide', forceCollide((d) => d.r + 7).iterations(2))
      .force('radial', forceRadial(ringRadius, cx, cy).strength(0.88))
      .force('center', forceCenter(cx, cy).strength(0.03));

    // Publish des positions dans l'état (callback de tick = hors render)
    const publish = () => setSimData({ nodes: sim.nodes(), links: sim.links() });
    sim.on('tick', publish);
    if (reduce) {
      // Reduced motion : settle immédiat, pas d'animation de reconnaissance
      sim.stop();
      for (let i = 0; i < 320; i += 1) sim.tick();
    }
    queueMicrotask(publish);
    simRef.current = sim;
    return () => {
      sim.stop();
      if (simRef.current === sim) simRef.current = null;
    };
  }, [graph, reduce]);

  // ── Zoom / pan (d3-zoom sur le SVG, exclut les nœuds du filtre) ───────────
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const zoomBehavior = zoom()
      .scaleExtent([0.35, 2.5])
      .filter((event) => {
        if (event.type === 'wheel') return true;
        if (event.button) return false;
        // Pan uniquement depuis le fond / liens — jamais depuis une bulle
        return !(event.target?.closest?.('.fm-node'));
      })
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        setTransform({ x: event.transform.x, y: event.transform.y, k: event.transform.k });
      });
    // Pas de zoom au double-clic (conflictuel avec le clic = centrer)
    const sel = select(svg);
    sel.call(zoomBehavior).on('dblclick.zoom', null);
    zoomBehaviorRef.current = zoomBehavior;
    return () => {
      sel.on('.zoom', null);
      zoomBehaviorRef.current = null;
    };
  }, []);

  // ── Voisinage direct d'une clé (pour le hover) ────────────────────────────
  const neighborsOf = useMemo(() => {
    const adj = new Map();
    for (const l of rawLinks) {
      if (!adj.has(l.source)) adj.set(l.source, new Set());
      if (!adj.has(l.target)) adj.set(l.target, new Set());
      adj.get(l.source).add(l.target);
      adj.get(l.target).add(l.source);
    }
    return adj;
  }, [rawLinks]);

  const hoverNeighbors = hoverKey ? neighborsOf.get(hoverKey) : null;
  const { nodes: simNodes, links: simLinks } = simData;

  // Nœuds de rendu : positions de la simulation si publiées, sinon positions
  // initiales déterministes dérivées de graph.nodes (évite le flash « Aucun
  // voisin » entre le chargement des données et le premier tick de la sim).
  const cx0 = stageW / 2;
  const cy0 = STAGE_H / 2;
  const renderNodes = useMemo(() => {
    if (simNodes.length > 0) return simNodes;
    return (graph?.nodes || []).map((n) => {
      const r = nodeRadius(n);
      const rr = ringRadius(n);
      // Angle déterministe stable par clé (pas de Math.random au render)
      let h = 0;
      for (let i = 0; i < n.key.length; i += 1) h = (h * 31 + n.key.charCodeAt(i)) | 0;
      const ang = ((Math.abs(h) % 360) / 360) * Math.PI * 2;
      const node = {
        ...n,
        r,
        x: cx0 + Math.cos(ang) * (rr || 40),
        y: cy0 + Math.sin(ang) * (rr || 40),
      };
      if (node.isCenter) {
        node.fx = cx0;
        node.fy = cy0;
      }
      return node;
    });
  }, [simNodes, graph, cx0, cy0]);

  // Liens de rendu : objets d3 si publiés, sinon résolution des clés string
  // de graph.links contre renderNodes (même fallback que les nœuds).
  const renderLinks = useMemo(() => {
    if (simLinks.length > 0) return simLinks;
    const byKey = new Map(renderNodes.map((n) => [n.key, n]));
    return (graph?.links || [])
      .map((l) => {
        const s = byKey.get(l.source);
        const t = byKey.get(l.target);
        if (!s || !t) return null;
        return { source: s, target: t, rel: l.rel };
      })
      .filter(Boolean);
  }, [simLinks, graph, renderNodes]);

  // ── Dimensions des éléments selon l'état analytique ───────────────────────
  function isNodeDimmed(n) {
    if (n.isCenter) return false;
    if (influenceSet && !influenceSet.has(n.key)) return true;
    if (pathPairs && !pathChain?.some((p) => p.key === n.key)) return true;
    if (activeKinds.size && !activeKinds.has(n.kind)) return true;
    if (hoverKey && n.key !== hoverKey && !hoverNeighbors?.has(n.key)) return true;
    return false;
  }

  function isLinkDimmed(l) {
    const s = typeof l.source === 'object' ? l.source : null;
    const t = typeof l.target === 'object' ? l.target : null;
    if (!s || !t) return true;
    if (pathPairs) return !pathPairs.has(linkKey(l));
    if (influenceSet) return !(influenceSet.has(s.key) && influenceSet.has(t.key));
    if (activeKinds.size) {
      return !((activeKinds.has(s.kind) || s.isCenter) && (activeKinds.has(t.kind) || t.isCenter));
    }
    if (hoverKey) return !(s.key === hoverKey || t.key === hoverKey);
    return false;
  }

  function isLinkOnPath(l) {
    return Boolean(pathPairs?.has(linkKey(l)));
  }

  // ── Interactions ──────────────────────────────────────────────────────────
  function nodeAt(key) {
    return simRef.current?.nodes().find((n) => n.key === key) || null;
  }

  function handleNodeActivate(n) {
    if (!n) return;
    if (pathMode) {
      setPathSel((prev) => {
        const next = prev.length >= 2 ? [n.key] : [...prev, n.key];
        if (next.length === 2) {
          const chain = bfsPath(rawLinks, next[0], next[1]);
          if (!chain) {
            setPathPairs(new Set());
            setPathChain([]);
          } else {
            const pairs = new Set();
            for (let i = 0; i < chain.length - 1; i += 1) {
              const a = chain[i];
              const b = chain[i + 1];
              pairs.add(a < b ? `${a}|${b}` : `${b}|${a}`);
            }
            setPathPairs(pairs);
            setPathChain(chain.map((key) => {
              const node = nodeAt(key);
              return { key, label: node?.label || key };
            }));
          }
        } else {
          setPathPairs(null);
          setPathChain(null);
        }
        return next;
      });
      return;
    }
    if (influenceMode) {
      if (n.isCenter) return;
      const key = n.key === influenceKey ? null : n.key;
      setInfluenceKey(key);
      setInfluenceSet(key ? bfsReach(rawLinks, key, 2) : null);
      return;
    }
    if (n.isCenter) onPickCenter?.();
    else onRecenter?.(n.kind, n.id);
  }

  // Drag de nœud via pointer events (conversion écran → graphe via zoom k)
  function onNodePointerDown(e, n) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const sim = simRef.current;
    if (!sim) return;
    // Toujours muter le nœud de la simulation (pas l'objet fallback de rendu)
    const sn = nodeAt(n.key) || n;
    sn.fx = sn.x;
    sn.fy = sn.y;
    sim.alphaTarget(reduce ? 0.15 : 0.25).restart();
    setIsDragging(true);
    dragStateRef.current = {
      key: n.key,
      sx: e.clientX,
      sy: e.clientY,
      ox: sn.x,
      oy: sn.y,
      moved: false,
    };
  }

  function onNodePointerMove(e) {
    const st = dragStateRef.current;
    if (!st) return;
    const n = nodeAt(st.key);
    if (!n) return;
    const k = transformRef.current.k || 1;
    const dx = (e.clientX - st.sx) / k;
    const dy = (e.clientY - st.sy) / k;
    if (Math.abs(dx) + Math.abs(dy) > 3) st.moved = true;
    n.fx = st.ox + dx;
    n.fy = st.oy + dy;
  }

  function onNodePointerUp(e, n) {
    const st = dragStateRef.current;
    dragStateRef.current = null;
    setIsDragging(false);
    simRef.current?.alphaTarget(0);
    e.stopPropagation();
    if (!st) return;
    if (!st.moved) handleNodeActivate(n);
    // Relâché : fx/fy restent fixés (le nœud reste épinglé à sa position)
  }

  function onNodePointerEnter(e, n) {
    if (dragStateRef.current) return;
    setHoverKey(n.key);
    setTooltip({ node: n, x: e.clientX, y: e.clientY });
  }

  function onNodePointerMoveHover(e, n) {
    if (dragStateRef.current) return;
    setTooltip((t) => (t ? { node: n, x: e.clientX, y: e.clientY } : t));
  }

  function onNodePointerLeave() {
    setHoverKey(null);
    setTooltip(null);
  }

  function toggleKind(kind) {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  function clearAnalytic() {
    setPathMode(false);
    setPathSel([]);
    setPathPairs(null);
    setPathChain(null);
    setInfluenceMode(false);
    setInfluenceKey(null);
    setInfluenceSet(null);
  }

  function resetAll() {
    const sim = simRef.current;
    if (sim) {
      const cx = stageW / 2;
      for (const n of sim.nodes()) {
        if (n.isCenter) {
          n.fx = cx;
          n.fy = STAGE_H / 2;
        } else {
          n.fx = null;
          n.fy = null;
        }
      }
      sim.alpha(0.6).restart();
    }
    clearAnalytic();
    setActiveKinds(new Set());
    setHoverKey(null);
    setTooltip(null);
    if (svgRef.current && zoomBehaviorRef.current) {
      select(svgRef.current).call(zoomBehaviorRef.current.transform, zoomIdentity);
    }
  }

  function togglePathMode() {
    if (pathMode) clearAnalytic();
    else {
      clearAnalytic();
      setPathMode(true);
    }
  }

  function toggleInfluenceMode() {
    if (influenceMode) clearAnalytic();
    else {
      clearAnalytic();
      setInfluenceMode(true);
    }
  }

  // ── Dérivés pour le rendu ─────────────────────────────────────────────────
  const kindsPresent = useMemo(() => {
    const set = new Set();
    for (const n of graph?.nodes || []) {
      if (!n.isCenter) set.add(n.kind);
    }
    return [...set].sort();
  }, [graph]);

  const cx = stageW / 2;
  const cy = STAGE_H / 2;
  const vpTransform = `translate(${transform.x},${transform.y}) scale(${transform.k})`;
  const gradients = useMemo(() => {
    const colors = new Set();
    for (const n of renderNodes) colors.add(nodeFill(n));
    return [...colors];
  }, [renderNodes]);

  const analyticOn = Boolean(pathMode || influenceMode);
  const hint = pathMode
    ? 'Cliquez 2 nœuds distincts pour tracer le plus court chemin'
    : influenceMode
      ? 'Cliquez un nœud pour afficher sa sphère d\'influence (2 sauts)'
      : 'Glisser une bulle = déplacer · molette = zoom · clic = centrer';

  // ── Rendu ─────────────────────────────────────────────────────────────────
  return (
    <div
      ref={wrapRef}
      className="relative overflow-hidden rounded-xl"
      style={{
        height: STAGE_H,
        minWidth: STAGE_MIN_W,
        background: 'radial-gradient(1100px 520px at 50% 42%, #16213a 0%, #0b1120 55%, #070b14 100%)',
      }}
    >
      <style>{`
        .fm-path-link { stroke-dasharray: 7 4; animation: fm-dash 0.7s linear infinite; }
        @keyframes fm-dash { to { stroke-dashoffset: -11; } }
        @media (prefers-reduced-motion: reduce) { .fm-path-link { animation: none; } }
      `}</style>

      {status.loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-sm text-slate-400">
          <Loader2 size={16} className="animate-spin" /> Construction du réseau…
        </div>
      )}
      {!status.loading && status.error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-slate-400">
          {status.error}
        </div>
      )}
      {!status.loading && !status.error && graph && renderNodes.length <= 1 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-slate-400">
          Aucun voisin à afficher autour de ce centre.
        </div>
      )}

      {!status.loading && !status.error && renderNodes.length > 0 && (
        <svg
          ref={svgRef}
          className="absolute inset-0 h-full w-full select-none"
          role="region"
          aria-label="Graphe force-directed d'exploration"
          style={{ cursor: isDragging ? 'grabbing' : 'default' }}
        >
          <defs>
            {gradients.map((color) => (
              <radialGradient key={color} id={`fm-g-${color.slice(1)}`}>
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
                <stop offset="30%" stopColor={color} stopOpacity="1" />
                <stop offset="100%" stopColor={color} stopOpacity="0.85" />
              </radialGradient>
            ))}
            <filter id="fm-glow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="2.6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <g transform={vpTransform}>
            {/* Cercles de guidage des anneaux + étiquettes de ring */}
            <g pointerEvents="none" aria-hidden="true">
              {RING_GUIDES.map((r) => (
                <circle
                  key={r}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke="rgba(96,165,250,0.08)"
                  strokeDasharray="4 7"
                />
              ))}
              {RING_LABELS.map(({ r, label }) => (
                <text
                  key={label}
                  x={cx}
                  y={cy - r - 10}
                  textAnchor="middle"
                  fill="rgba(148,163,184,0.35)"
                  fontSize="10"
                  fontWeight="600"
                  letterSpacing="2.5"
                >
                  {label}
                </text>
              ))}
            </g>

            {/* Liens */}
            <g aria-hidden="true">
              {renderLinks.map((l, i) => {
                const s = typeof l.source === 'object' ? l.source : null;
                const t = typeof l.target === 'object' ? l.target : null;
                if (!s || !t) return null;
                const a = edgePoint(s, t);
                const b = edgePoint(t, s);
                const dimmed = isLinkDimmed(l);
                const onPath = isLinkOnPath(l);
                const hot = Boolean(hoverKey && (s.key === hoverKey || t.key === hoverKey));
                const stroke = onPath
                  ? '#f87171'
                  : hot
                    ? (s.isCenter || t.isCenter ? 'rgba(96,165,250,0.85)' : nodeFill(s.isCenter ? t : s))
                    : 'rgba(148,163,184,0.28)';
                return (
                  <line
                    key={`${s.key}>${t.key}#${i}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={stroke}
                    strokeWidth={onPath ? 2.6 : hot ? 1.8 : 1.1}
                    strokeLinecap="round"
                    opacity={dimmed ? 0.07 : onPath ? 0.95 : hot ? 0.9 : 0.55}
                    className={onPath && !reduce ? 'fm-path-link' : undefined}
                  />
                );
              })}
            </g>

            {/* Nœuds */}
            <g>
              {renderNodes.map((n) => {
                const fill = nodeFill(n);
                const dimmed = isNodeDimmed(n);
                const hovered = n.key === hoverKey;
                const onPath = pathChain?.some((p) => p.key === n.key) || false;
                const inInfluence = Boolean(influenceSet?.has(n.key));
                const selected = pathSel.includes(n.key) || influenceKey === n.key;
                const showLabel = n.isCenter || n.count != null || hovered || selected;
                return (
                  <g
                    key={n.key}
                    className="fm-node"
                    data-key={n.key}
                    transform={`translate(${n.x},${n.y})`}
                    opacity={dimmed ? 0.18 : 1}
                    style={{ cursor: 'pointer' }}
                    role="button"
                    tabIndex={0}
                    aria-label={n.label}
                    onPointerDown={(e) => onNodePointerDown(e, n)}
                    onPointerMove={(e) => { onNodePointerMove(e, n); onNodePointerMoveHover(e, n); }}
                    onPointerUp={(e) => onNodePointerUp(e, n)}
                    onPointerEnter={(e) => onNodePointerEnter(e, n)}
                    onPointerLeave={onNodePointerLeave}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleNodeActivate(n);
                      }
                    }}
                  >
                    {/* Halo / sélection */}
                    {(hovered || selected || influenceKey === n.key) && (
                      <circle
                        r={n.r + (selected ? 8 : 5)}
                        fill="none"
                        stroke={onPath ? '#f87171' : (inInfluence || influenceKey === n.key ? '#c084fc' : fill)}
                        strokeWidth={1.4}
                        opacity={0.65}
                        filter="url(#fm-glow)"
                      />
                    )}
                    {n.isCenter && (
                      <circle
                        r={n.r + 7}
                        fill="none"
                        stroke="rgba(56,189,248,0.35)"
                        strokeWidth={1}
                        strokeDasharray="3 4"
                      />
                    )}
                    <circle
                      r={n.r}
                      fill={`url(#fm-g-${fill.slice(1)})`}
                      stroke={fill}
                      strokeWidth={n.isCenter ? 2 : 1.2}
                      opacity={0.96}
                      filter={hovered ? 'url(#fm-glow)' : undefined}
                    />
                    {showLabel && (
                      <text
                        y={n.r + 13}
                        textAnchor="middle"
                        fontSize={n.isCenter ? 12 : 10}
                        fontWeight={n.isCenter || n.count != null ? 600 : 400}
                        fill={n.isCenter ? '#e2e8f0' : '#cbd5e1'}
                        stroke="#0b1120"
                        strokeWidth={3}
                        paintOrder="stroke"
                        pointerEvents="none"
                      >
                        {n.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </g>
        </svg>
      )}

      {/* Barre d'outils analytique */}
      {!status.loading && !status.error && renderNodes.length > 1 && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
          <button
            type="button"
            onClick={togglePathMode}
            aria-pressed={pathMode}
            title="Plus court chemin entre 2 nœuds"
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium backdrop-blur transition ${
              pathMode
                ? 'border-rose-400/60 bg-rose-500/15 text-rose-200'
                : 'border-white/15 bg-white/[0.06] text-slate-300 hover:bg-white/10'
            }`}
          >
            <Route size={13} /> Chemin
          </button>
          <button
            type="button"
            onClick={toggleInfluenceMode}
            aria-pressed={influenceMode}
            title="Sphère d'influence (2 sauts)"
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium backdrop-blur transition ${
              influenceMode
                ? 'border-violet-400/60 bg-violet-500/15 text-violet-200'
                : 'border-white/15 bg-white/[0.06] text-slate-300 hover:bg-white/10'
            }`}
          >
            <Radar size={13} /> Influence
          </button>
          <button
            type="button"
            onClick={resetAll}
            title="Réinitialiser la disposition et les filtres"
            className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.06] px-2.5 py-1.5 text-xs font-medium text-slate-300 backdrop-blur transition hover:bg-white/10"
          >
            <RotateCcw size={13} /> Reset
          </button>
        </div>
      )}

      {/* Bannière : résultat du plus court chemin */}
      {pathChain && (
        <div className="absolute left-1/2 top-3 z-10 flex max-w-[80%] -translate-x-1/2 items-center gap-2 rounded-xl border border-rose-400/40 bg-[#0b1120]/90 px-3 py-2 text-xs text-rose-100 shadow-xl backdrop-blur">
          {pathChain.length === 0 ? (
            <span className="text-slate-300">Aucun chemin entre ces 2 nœuds.</span>
          ) : (
            <>
              <span className="truncate">
                {pathChain.map((p) => p.label).join('  →  ')}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">
                {Math.max(0, pathChain.length - 1)}
                {' '}
                saut
                {pathChain.length - 1 > 1 ? 's' : ''}
              </span>
            </>
          )}
          <button
            type="button"
            onClick={() => { setPathSel([]); setPathPairs(null); setPathChain(null); }}
            aria-label="Effacer le chemin"
            className="shrink-0 rounded p-0.5 transition hover:bg-white/10"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Filtres par kind */}
      {!status.loading && kindsPresent.length > 1 && (
        <div className="absolute bottom-3 left-3 z-10 flex max-w-[70%] flex-wrap gap-1.5">
          {kindsPresent.map((kind) => {
            const on = activeKinds.size === 0 || activeKinds.has(kind);
            const color = KIND_COLORS[kind] || '#94a3b8';
            return (
              <button
                key={kind}
                type="button"
                onClick={() => toggleKind(kind)}
                aria-pressed={activeKinds.has(kind)}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium backdrop-blur transition ${
                  on
                    ? 'border-white/20 bg-white/[0.08] text-slate-200'
                    : 'border-white/10 bg-white/[0.03] text-slate-500 opacity-60'
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                {KIND_LABELS[kind] || kind}
              </button>
            );
          })}
        </div>
      )}

      {/* Infobulle */}
      {tooltip && (
        <div
          className="pointer-events-none fixed z-30 rounded-lg border border-white/15 bg-surface-container-lowest/95 px-2.5 py-1.5 text-xs text-slate-100 shadow-xl"
          style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}
        >
          <span className="block font-medium">{tooltip.node.label}</span>
          {tooltip.node.sub && (
            <span className="block text-[11px] text-slate-400">
              {tooltip.node.kind === tooltip.node.sub
                ? CENTER_TYPE_LABEL[tooltip.node.kind] || tooltip.node.kind
                : STATUS_LABELS[tooltip.node.sub] || tooltip.node.sub}
            </span>
          )}
          {tooltip.node.count != null && (
            <span className="block text-[11px] text-slate-400">
              {tooltip.node.count}
              {' '}
              élément(s)
            </span>
          )}
          {!analyticOn && !tooltip.node.isCenter && (
            <span className="block text-[11px] text-slate-500">Clic = centrer ici</span>
          )}
        </div>
      )}

      {/* Indice */}
      {!status.loading && !status.error && renderNodes.length > 1 && (
        <p className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 text-[11px] text-slate-500">
          {hint}
        </p>
      )}

      <span className="sr-only" aria-live="polite">
        {`${renderNodes.length} nœuds, ${renderLinks.length} liens`}
      </span>
    </div>
  );
}
