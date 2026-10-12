// Utilitaires du mode « Cosmos » (graphe force-directed, /explorer?mode=force).
// Anneaux concentriques par kind + BFS (plus court chemin / sphère d'influence)
// + géométrie d'arête attachée au périfère des bulles. Aucune dépendance React.

import { KIND_COLORS } from './fanLayout';

// ── Anneaux concentriques (forceRadial) ─────────────────────────────────────
// 3 anneaux de profondeur autour du centre (rayon 0) : acteurs proches,
// objets métier, référentiels en périphérie. Rayons en unités graph (px).
export const KIND_RINGS = {
  technicien: 130, lieu: 130, equipe: 130, demandeur: 140,
  ticket: 240, probleme: 250, asset: 255,
  skill: 340, categorie: 345, expediteur: 350, origine: 355, type: 360,
};
export const DEFAULT_RING = 290;
export const RING_GUIDES = [130, 240, 345]; // cercles de guidage pointillés
export const RING_LABELS = [
  { r: 130, label: 'ACTEURS' },
  { r: 240, label: 'TICKETS & PROBLÈMES' },
  { r: 345, label: 'RÉFÉRENTIELS' },
];

export function ringRadius(node) {
  if (!node || node.isCenter) return 0;
  return KIND_RINGS[node.kind] ?? DEFAULT_RING;
}

// Rayon de la bulle : centre > nœud à compte (équipe, lieu…) > feuille
export function nodeRadius(node) {
  if (!node) return 6;
  if (node.isCenter) return 16;
  if (node.count != null && node.count > 0) return 9;
  return 6;
}

export function nodeFill(node) {
  if (!node) return '#60a5fa';
  if (node.isCenter) return '#38bdf8';
  return KIND_COLORS[node.kind] || '#94a3b8';
}

// ── Arête attachée au périfère de la bulle ──────────────────────────────────
// Retourne le point de départ sur le bord du nœud `a` en direction de `b`
// (pattern network-graph `_edgePoint`) : les lignes touchent le cercle, jamais
// le centre.
export function edgePoint(a, b, pad = 1.5) {
  const dx = (b.x ?? 0) - (a.x ?? 0);
  const dy = (b.y ?? 0) - (a.y ?? 0);
  const d = Math.hypot(dx, dy) || 1;
  const r = (a.r ?? 6) + pad;
  return { x: a.x + (dx / d) * r, y: a.y + (dy / d) * r };
}

// ── Graphe non orienté pour BFS ─────────────────────────────────────────────
// Les liens backend sont { source, target, rel } (clés string) ; on les
// parcourt dans les deux sens.
function adjacency(links) {
  const adj = new Map();
  const add = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(b);
  };
  for (const l of links) {
    const s = typeof l.source === 'object' ? l.source.key : l.source;
    const t = typeof l.target === 'object' ? l.target.key : l.target;
    if (!s || !t) continue;
    add(s, t);
    add(t, s);
  }
  return adj;
}

/**
 * Plus court chemin non orienté (BFS) entre deux clés de nœuds.
 * @returns {string[]|null} liste des clés [source … target], ou null si inaccessible.
 */
export function bfsPath(links, sourceKey, targetKey) {
  if (!sourceKey || !targetKey || sourceKey === targetKey) return null;
  const adj = adjacency(links);
  const prev = new Map([[sourceKey, null]]);
  const queue = [sourceKey];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === targetKey) {
      const path = [];
      for (let k = cur; k != null; k = prev.get(k)) path.unshift(k);
      return path;
    }
    for (const next of adj.get(cur) || []) {
      if (prev.has(next)) continue;
      prev.set(next, cur);
      queue.push(next);
    }
  }
  return null;
}

/**
 * Sphère d'influence : ensemble des clés accessibles en ≤ depth sauts
 * (source incluse).
 */
export function bfsReach(links, sourceKey, depth = 2) {
  const reached = new Set();
  if (!sourceKey) return reached;
  const adj = adjacency(links);
  reached.add(sourceKey);
  let frontier = [sourceKey];
  for (let d = 0; d < depth; d += 1) {
    const next = [];
    for (const cur of frontier) {
      for (const n of adj.get(cur) || []) {
        if (!reached.has(n)) {
          reached.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return reached;
}

// Clé non orientée d'un lien (source/target peut être string ou objet nœud)
export function linkKey(l) {
  const s = typeof l.source === 'object' ? l.source.key : l.source;
  const t = typeof l.target === 'object' ? l.target.key : l.target;
  return s < t ? `${s}|${t}` : `${t}|${s}`;
}

/**
 * Fusionne 1-2 réponses de /api/graph/neighborhood en un unique graphe.
 * Nœuds dédoublonnés par key (le premier gagne), liens dédoublonnés par paire.
 */
export function mergeNeighborhoods(payloads) {
  const nodes = new Map();
  const links = [];
  const seen = new Set();
  let center = null;
  for (const data of payloads) {
    if (!data) continue;
    if (!center && data.center) center = data.center;
    for (const n of data.nodes || []) {
      if (!nodes.has(n.key)) nodes.set(n.key, { ...n });
    }
    for (const l of data.links || []) {
      if (!l?.source || !l?.target) continue;
      const k = `${l.source}>${l.target}`;
      const kr = `${l.target}>${l.source}`;
      if (seen.has(k) || seen.has(kr)) continue;
      seen.add(k);
      links.push({ ...l });
    }
  }
  return { center, nodes: [...nodes.values()], links };
}
