import { getWidgetMeta } from './widgetCatalog';

/* Taille min/max par catégorie de widget — empêche les widgets trop petits ou géants */
export const SIZE_CONSTRAINTS = {
  KPIs:       { minW: 2, minH: 2, maxW: 4, maxH: 3 },
  Graphiques: { minW: 3, minH: 3, maxW: 8, maxH: 6 },
  Tableaux:   { minW: 4, minH: 3, maxW: 8, maxH: 8 },
  Données:    { minW: 3, minH: 2, maxW: 6, maxH: 5 },
};
export const DEFAULT_CONSTRAINTS = { minW: 3, minH: 2, maxW: 6, maxH: 4 };

export function sizeFloor(widgetType) {
  const category = getWidgetMeta(widgetType)?.category;
  return SIZE_CONSTRAINTS[category] || DEFAULT_CONSTRAINTS;
}

/* Dimensions par défaut d'un widget, bornées par les contraintes de sa catégorie. */
export function defaultSize(widgetType) {
  const meta = getWidgetMeta(widgetType);
  const floor = sizeFloor(widgetType);
  return {
    w: Math.min(floor.maxW, Math.max(floor.minW, meta?.defaultW || 4)),
    h: Math.min(floor.maxH, Math.max(floor.minH, meta?.defaultH || 3)),
  };
}

/* La zone demandée chevauche-t-elle un widget déjà présent ? */
export function overlaps(layout, { x, y, w, h }) {
  for (const e of Array.isArray(layout) ? layout : []) {
    if (x < e.x + e.w && e.x < x + w && y < e.y + e.h && e.y < y + h) return true;
  }
  return false;
}

/* Premier emplacement libre (gauche→droite, haut→bas) — utilisé à l'ajout d'un
   widget pour NE JAMAIS déplacer les widgets déjà en place. */
export function computeDefaultPosition(widgetType, existingLayout) {
  const { w, h } = defaultSize(widgetType);
  const COLS = 12;
  const layout = Array.isArray(existingLayout) ? existingLayout : [];

  if (layout.length === 0) {
    return { x: 0, y: 0, w, h };
  }

  // Construire l'ensemble des cellules occupées
  const occupied = new Set();
  for (const { x, y, w: ew, h: eh } of layout) {
    for (let dx = 0; dx < ew; dx++) {
      for (let dy = 0; dy < eh; dy++) {
        occupied.add(`${x + dx},${y + dy}`);
      }
    }
  }

  // Plafond de recherche : 5 lignes au-delà du bas du layout existant
  const maxY = Math.max(...layout.map((l) => l.y + l.h)) + 5;

  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= COLS - w; x++) {
      let fits = true;
      for (let dx = 0; dx < w && fits; dx++) {
        for (let dy = 0; dy < h && fits; dy++) {
          if (occupied.has(`${x + dx},${y + dy}`)) fits = false;
        }
      }
      if (fits) return { x, y, w, h };
    }
  }

  // Fallback : tout en bas à gauche
  const bottomY = Math.max(...layout.map((l) => l.y + l.h));
  return { x: 0, y: bottomY, w, h };
}
