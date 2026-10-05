// Géométrie de l'éventail de l'explorateur (3 niveaux).
// Bézier cubique avec décalage en arc + opacité dégressive en bout d'éventail.
// Aucune dépendance React : testable isolément, positions recalculées par la
// page à chaque redimensionnement (ResizeObserver) ou changement de sélection.

export const FAN_MAX = 8; // plafond d'affichage (au-delà : nœud « + N autres »)
export const LIST_MAX = 50;

// Couleurs par priorité (rouge P1, ambre P2, bleu P3/P4) et par nature d'objet
export const PRIORITY_COLORS = {
  P1: '#f87171',
  P2: '#fbbf24',
  P3: '#60a5fa',
  P4: '#94a3b8',
};

export const KIND_COLORS = {
  lieu: '#38bdf8',
  technicien: '#a78bfa',
  asset: '#34d399',
  ticket: '#60a5fa',
  probleme: '#fb7185',
  categorie: '#f59e0b',
  equipe: '#2dd4bf',
  demandeur: '#e879f9',
  skill: '#facc15',
  expediteur: '#4ade80',
  origine: '#22d3ee',
  type: '#94a3b8',
};

export function itemColor(item) {
  if (!item) return KIND_COLORS.ticket;
  if (item.kind === 'ticket' && item.priority) return PRIORITY_COLORS[item.priority] || KIND_COLORS.ticket;
  return KIND_COLORS[item.kind] || KIND_COLORS.ticket;
}

/**
 * Courbe reliant l'origine (carte sélectionnée) à l'élément i d'un éventail
 * de n éléments. Le point d'arrivée décrit un léger arc vertical.
 */
export function fanPath(x0, y0, i, n, opts = {}) {
  const { spread = 46, reach = 260, arc = 40 } = opts;
  const y1 = y0 + (i - (n - 1) / 2) * spread;
  const x1 = x0 + reach + Math.sin((n <= 1 ? 0.5 : i / (n - 1)) * Math.PI) * arc;
  const dx = (x1 - x0) * 0.55;
  return { d: `M${x0},${y0} C${x0 + dx},${y0} ${x1 - dx},${y1} ${x1},${y1}`, x1, y1 };
}

/** Fondu en bout d'éventail : 1 - i / (n + 2) (le dernier reste lisible). */
export function itemFade(i, n) {
  return 1 - i / (n + 2);
}

/**
 * Layout complet de l'éventail dans un conteneur de (stageW × stageH).
 * - spread : espacement vertical, réduit si l'éventail déborde ;
 * - reach  : alourdi selon la place disponible, jamais trop près du bord ;
 * - l'ensemble est recentré verticalement autour de y0 puis clampé.
 */
export function fanLayout(x0, y0, n, stageW, stageH, opts = {}) {
  // Spread ≥ hauteur de carte + 8px : les cartes ne se chevauchent jamais.
  const { maxSpread = 76, minSpread = 68, cardW = 236, arc = 40 } = opts;
  // La carte ne doit jamais toucher le bord droit : marge 10 (départ carte) +
  // 16 (padding) + arc sinusoïdal du point d'arrivée.
  const reach = Math.max(140, Math.min(opts.reach || 260, stageW - x0 - cardW - arc - 26));
  const spread = n <= 1
    ? 0
    : Math.max(minSpread, Math.min(maxSpread, (stageH - 56) / (n - 1)));

  const raw = Array.from({ length: n }, (_, i) => fanPath(x0, y0, i, n, { spread, reach, arc }));

  // Clamp vertical : l'ensemble (hauteur n×spread) reste dans le conteneur
  const half = (n - 1) * spread / 2;
  let shift = 0;
  const top = y0 - half;
  const bottom = y0 + half;
  if (top < 28) shift = 28 - top;
  else if (bottom > stageH - 28) shift = (stageH - 28) - bottom;

  return raw.map((p) => {
    const y1 = p.y1 + shift;
    const x1 = p.x1;
    const dx = (x1 - x0) * 0.55;
    return { x1, y1, d: `M${x0},${y0} C${x0 + dx},${y0} ${x1 - dx},${y1} ${x1},${y1}` };
  });
}

/** Courbe simple centre → catégorie ( retour simple, léger galbe ). */
export function linkPath(x0, y0, x1, y1) {
  const dx = (x1 - x0) * 0.55;
  return `M${x0},${y0} C${x0 + dx},${y0} ${x1 - dx},${y1} ${x1},${y1}`;
}
