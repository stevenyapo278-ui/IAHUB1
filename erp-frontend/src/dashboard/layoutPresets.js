import { getWidgetMeta } from './widgetCatalog';

// ── Presets déclaratifs ─────────────────────────────────────────────────────
// Chaque preset définit un ordre de rules par catégorie. Les widgets sont
// placés dans l'ordre des rules, chaque rule définissant la taille cible.
// Une rule de fallback '*' attrape tout widget dont la catégorie ne matche pas.

const CATEGORY_ORDER = ['KPIs', 'Graphiques', 'Tableaux', 'Données'];

export const LAYOUT_PRESETS = {
  kpis_top: {
    label: 'Focus KPIs en haut',
    description: 'KPIs en 1ère rangée, graphiques, puis tableaux',
    rules: [
      { category: 'KPIs',       w: 3, h: 2 },
      { category: 'Graphiques', w: 6, h: 4 },
      { category: 'Tableaux',   w: 6, h: 4 },
      { category: 'Données',    w: 4, h: 3 },
      { category: '*',          w: 4, h: 3 },
    ],
  },
  charts_focus: {
    label: 'Vue graphiques',
    description: 'Graphiques en priorité, puis KPIs, tables, données',
    rules: [
      { category: 'Graphiques', w: 6, h: 4 },
      { category: 'KPIs',       w: 3, h: 2 },
      { category: 'Tableaux',   w: 6, h: 4 },
      { category: 'Données',    w: 4, h: 3 },
      { category: '*',          w: 4, h: 3 },
    ],
  },
  tables_focus: {
    label: 'Vue tableaux',
    description: 'Tableaux et listes en priorité',
    rules: [
      { category: 'Tableaux',   w: 6, h: 4 },
      { category: 'KPIs',       w: 3, h: 2 },
      { category: 'Graphiques', w: 6, h: 4 },
      { category: 'Données',    w: 4, h: 3 },
      { category: '*',          w: 4, h: 3 },
    ],
  },
  compact: {
    label: 'Layout compact',
    description: 'Taille réduite, plus de widgets visibles',
    rules: [
      { category: 'KPIs',       w: 2, h: 1 },
      { category: 'Graphiques', w: 4, h: 3 },
      { category: 'Tableaux',   w: 6, h: 3 },
      { category: 'Données',    w: 3, h: 2 },
      { category: '*',          w: 3, h: 2 },
    ],
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function sizeFloor(widgetType) {
  const meta = getWidgetMeta(widgetType);
  if (!meta) return { minW: 3, minH: 2, maxW: 6, maxH: 4 };
  const constraints = {
    KPIs:       { minW: 2, minH: 2, maxW: 4, maxH: 3 },
    Graphiques: { minW: 3, minH: 3, maxW: 8, maxH: 6 },
    Tableaux:   { minW: 4, minH: 3, maxW: 8, maxH: 8 },
    Données:    { minW: 3, minH: 2, maxW: 6, maxH: 5 },
  };
  return constraints[meta.category] || { minW: 3, minH: 2, maxW: 6, maxH: 4 };
}

function getCategory(widget) {
  return getWidgetMeta(widget.widgetType)?.category || '*';
}

// ── applyPreset ─────────────────────────────────────────────────────────────
// Génère un layout à partir des rules d'un preset et des widgets réellement
// présents. Les widgets sont triés par position actuelle (y puis x) au sein
// de chaque catégorie pour un ordre stable entre applications successives.

export function applyPreset(widgets, preset, cols = 12) {
  if (!widgets?.length || !preset?.rules?.length) return [];

  // Indexer les widgets par catégorie (stables : tri par position actuelle)
  const byCategory = new Map();
  for (const w of widgets) {
    const cat = getCategory(w);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(w);
  }
  // Trier chaque catégorie par position actuelle (y puis x)
  for (const [, list] of byCategory) {
    list.sort((a, b) => {
      // Utiliser la position actuelle si disponible (via layout entré)
      const ay = a._y ?? 0;
      const ax = a._x ?? 0;
      const by = b._y ?? 0;
      const bx = b._x ?? 0;
      return ay - by || ax - bx || a.id - b.id;
    });
  }

  // Placer les widgets rule par rule
  const placed = new Set();
  let cursorY = 0;
  let cursorX = 0;

  const layout = [];

  for (const rule of preset.rules) {
    let matching;
    if (rule.category === '*') {
      matching = [...byCategory.entries()]
        .filter(([cat]) => !CATEGORY_ORDER.includes(cat))
        .flatMap(([, list]) => list.filter(w => !placed.has(w.id)));
    } else {
      matching = (byCategory.get(rule.category) || []).filter(w => !placed.has(w.id));
    }

    if (!matching?.length) continue;

    cursorX = 0;
    let rowHeight = 0;

    for (const widget of matching) {
      const floor = sizeFloor(widget.widgetType);
      const w = clamp(rule.w, floor.minW, floor.maxW);
      const h = clamp(rule.h, floor.minH, floor.maxH);

      if (cursorX + w > cols) {
        cursorX = 0;
        cursorY += rowHeight;
        rowHeight = 0;
      }

      layout.push({ i: widget.id, x: cursorX, y: cursorY, w, h });
      placed.add(widget.id);
      cursorX += w;
      rowHeight = Math.max(rowHeight, h);
    }

    cursorY += rowHeight;
  }

  // Fallback : widgets non placés (catégorie inconnue, pas de rule '*' matched)
  for (const w of widgets) {
    if (placed.has(w.id)) continue;
    const floor = sizeFloor(w.widgetType);
    const w2 = clamp(4, floor.minW, floor.maxW);
    const h2 = clamp(3, floor.minH, floor.maxH);
    layout.push({ i: w.id, x: 0, y: cursorY, w: w2, h: h2 });
    cursorY += h2;
  }

  return layout;
}

// ── autoDistribute ──────────────────────────────────────────────────────────
// Compacte les widgets en éliminant les trous verticaux sans chevauchement.
// Algorithme d'occupation par colonne : pour chaque widget (trié y puis x),
// on le place au premier y libre sur toute sa largeur de colonnes.

export function autoDistribute(layout, cols = 12) {
  if (!layout?.length) return [];

  const colHeights = new Array(cols).fill(0);
  const sorted = [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
  const result = [];

  for (const item of sorted) {
    const x = Math.max(0, Math.min(item.x, cols - 1));
    const w = Math.min(item.w, cols - x);

    const span = colHeights.slice(x, x + w);
    const newY = span.length ? Math.max(...span) : 0;

    result.push({ ...item, x, y: newY, w });

    for (let c = x; c < x + w; c++) {
      colHeights[c] = newY + item.h;
    }
  }

  return result;
}
