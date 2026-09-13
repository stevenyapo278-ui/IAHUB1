import { memo, useCallback, useMemo, useRef } from 'react';
import { ResponsiveGridLayout, useContainerWidth, verticalCompactor, noCompactor } from 'react-grid-layout';
import { motion } from 'framer-motion';
import { GripVertical, X } from 'lucide-react';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { getWidgetMeta } from './widgetCatalog';

const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480 };
const COLS = { lg: 12, md: 10, sm: 6, xs: 4 };
const MARGIN = [12, 12];
const ROW_HEIGHT = 90;

/* Taille min/max par catégorie de widget — empêche les widgets trop petits ou géants */
const SIZE_CONSTRAINTS = {
  KPIs:       { minW: 2, minH: 2, maxW: 4, maxH: 3 },
  Graphiques: { minW: 3, minH: 3, maxW: 8, maxH: 6 },
  Tableaux:   { minW: 4, minH: 3, maxW: 8, maxH: 8 },
  Données:    { minW: 3, minH: 2, maxW: 6, maxH: 5 },
};
const DEFAULT_CONSTRAINTS = { minW: 3, minH: 2, maxW: 6, maxH: 4 };

function sizeFloor(widgetType) {
  const category = getWidgetMeta(widgetType)?.category;
  return SIZE_CONSTRAINTS[category] || DEFAULT_CONSTRAINTS;
}

/* Normalise un layout servi par l'API : coerce, dédoublonne, aligne sur les
   widgets réellement présents et génère une entrée pour les orphelins. */
export function normalizeLayout(layout, widgets) {
  const byWidgetId = new Map(widgets.map((w) => [w.id, w]));
  const seen = new Set();
  const result = [];

  for (const item of Array.isArray(layout) ? layout : []) {
    const i = String(item?.i ?? '');
    if (!i || !byWidgetId.has(i) || seen.has(i)) continue;
    seen.add(i);
    const floor = sizeFloor(byWidgetId.get(i).widgetType);
    result.push({
      i,
      x: Math.max(0, Math.round(Number(item.x) || 0)),
      y: Math.max(0, Math.round(Number(item.y) || 0)),
      w: Math.min(floor.maxW, Math.max(floor.minW, Math.round(Number(item.w) || 4))),
      h: Math.min(floor.maxH, Math.max(floor.minH, Math.round(Number(item.h) || 3))),
      minW: floor.minW,
      minH: floor.minH,
      maxW: floor.maxW,
      maxH: floor.maxH,
    });
  }

  // Widgets sans entrée de layout → ajoutés en bas, la compaction verticale
  // les repack ensuite sans chevauchement.
  let cursorY = result.reduce((max, l) => Math.max(max, l.y + l.h), 0);
  for (const w of widgets) {
    if (seen.has(w.id)) continue;
    const meta = getWidgetMeta(w.widgetType);
    const floor = sizeFloor(w.widgetType);
    const defaultW = Math.min(meta?.defaultW || 4, floor.maxW);
    result.push({
      i: w.id,
      x: 0,
      y: cursorY,
      w: Math.max(floor.minW, defaultW),
      h: Math.min(floor.maxH, Math.max(floor.minH, meta?.defaultH || 3)),
      minW: floor.minW,
      minH: floor.minH,
      maxW: floor.maxW,
      maxH: floor.maxH,
    });
    cursorY += meta?.defaultH || 3;
  }

  return result;
}

/* On ne persiste que la géométrie pure — minW/minH sont dérivés du catalogue. */
function stripLayout(layout) {
  return (layout || []).map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
}

/** Vérifie si deux rectangles se chevauchent */
function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Après un drag, restaure les widgets déplacés involontairement à leur position
 * d'origine. Seul le widget glissé conserve sa nouvelle position.
 * Compaction verticale légère pour résoudre les chevauchements restants.
 */
function restoreDisplaced(originalLayout, newLayout, draggedId) {
  const origMap = new Map(originalLayout.map((l) => [l.i, l]));
  const newMap = new Map(newLayout.map((l) => [l.i, { ...l }]));
  const dragged = newMap.get(draggedId);
  if (!dragged) return newLayout;

  // Restaurer tous les widgets non-guissés à leur position d'origine
  for (const [id, orig] of origMap) {
    if (id === draggedId) continue;
    const curr = newMap.get(id);
    if (curr) {
      curr.x = orig.x;
      curr.y = orig.y;
    }
  }

  // Compaction verticale légère : repack du haut vers le bas sans chevauchement
  const cols = COLS.lg;
  const placed = [];
  const sorted = [...newMap.values()].sort((a, b) => a.y - b.y || a.x - b.x);

  for (const item of sorted) {
    if (item.i === draggedId) {
      // Le widget glissé garde sa position finale (potentiellement décalée par RGL)
      placed.push(item);
      continue;
    }
    // Pour chaque widget non-glissé, trouver la première position libre en bas
    let testY = item.y;
    let found = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const test = { ...item, y: testY };
      const collision = placed.some((p) => overlaps(test, p));
      if (!collision) {
        item.y = testY;
        placed.push(item);
        found = true;
        break;
      }
      testY++;
    }
    if (!found) placed.push(item);
  }

  return placed.map(({ minW, minH, maxW, maxH, ...rest }) => rest);
}

export default memo(function DashboardGrid({
  layout = [],
  widgets = [],
  isEditing = false,
  onLayoutChange,
  onRemoveWidget,
  renderWidget,
}) {
  // Mesure dynamique du conteneur (ResizeObserver) — obligatoire en v2 :
  // `width` est une prop requise, sans elle tout le positionnement est NaN.
  // measureBeforeMount : aucun rendu avec une largeur supposée (anti-flash).
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });

  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;

  const baseLayout = useMemo(() => normalizeLayout(layout, widgets), [layout, widgets]);

  // Un seul objet `layouts` stable par version du layout servi : la génération
  // des layouts de breakpoints reste déterministe entre les re-renders.
  const layouts = useMemo(() => ({ lg: baseLayout }), [baseLayout]);

  // ── Snap-back : restaure les widgets déplacés involontairement ────────────
  // Sauvegarde des positions originales au début du drag
  const preDragLayoutRef = useRef(null);
  const draggedIdRef = useRef(null);

  const handleDragStart = useCallback((_layout, _oldItem, newItem) => {
    // Snapshot des positions actuelles avant le drag
    preDragLayoutRef.current = baseLayout.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h }));
    draggedIdRef.current = newItem.i;
  }, [baseLayout]);

  const handleDragStop = useCallback((_layout, _oldItem, newItem, _placeholder, e) => {
    draggedIdRef.current = null;
    // Laisser onLayoutChange traiter le snap-back
  }, []);

  // Commit unique : RGL appelle onLayoutChange après drag, resize ET
  // compaction — c'est la seule source de vérité pour la persistance.
  //
  // Garde-fou breakpoints : le layout persisté est toujours celui du
  // breakpoint `lg` (12 colonnes). Une édition faite sur un viewport plus
  // étroit (md/sm/xs) est appliquée localement par la grille mais NE doit
  // pas écraser le layout canonique servi par l'API.
  const breakpointRef = useRef('lg');
  const handleBreakpointChange = useCallback((newBreakpoint) => {
    breakpointRef.current = newBreakpoint;
  }, []);

  // Throttle onLayoutChange via requestAnimationFrame : évite de déclencher
  // un re-render du parent à chaque mousemove (~60-120/s) pendant le drag.
  // Le layout interne de RGL reste à jour (son propre state), on throttle
  // uniquement la remontée vers DashboardPage pour la persistance.
  const rafRef = useRef(null);
  const handleLayoutChange = useCallback(
    (newLayout) => {
      if (!isEditing) return;
      if (breakpointRef.current !== 'lg') return;

      // Snap-back : si un drag est en cours, restaurer les widgets déplacés
      let finalLayout = newLayout;
      const preDrag = preDragLayoutRef.current;
      if (preDrag && draggedIdRef.current) {
        finalLayout = restoreDisplaced(preDrag, newLayout, draggedIdRef.current);
      }

      if (rafRef.current) return; // frame déjà en attente
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        onLayoutChange?.(stripLayout(finalLayout), widgetsRef.current);
      });
    },
    [isEditing, onLayoutChange],
  );

  // v2 : les comportements passent par des objets de configuration
  // (isDraggable/isResizable/draggableHandle/compactType n'existent plus).
  const dragConfig = useMemo(
    () => ({ enabled: isEditing, handle: '.drag-handle', threshold: 8 }),
    [isEditing],
  );
  const resizeConfig = useMemo(
    () => ({ enabled: isEditing, handles: ['se', 's', 'e'] }),
    [isEditing],
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <div
        ref={containerRef}
        className={`dashboard-grid${isEditing ? ' dashboard-grid--editing' : ''}`}
      >
        {mounted && width > 0 && widgets.length > 0 && (
          <ResponsiveGridLayout
            width={width}
            layouts={layouts}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            rowHeight={ROW_HEIGHT}
            margin={MARGIN}
            containerPadding={[0, 0]}
            compactor={isEditing ? noCompactor : verticalCompactor}
            dragConfig={dragConfig}
            resizeConfig={resizeConfig}
            preventCollision={isEditing}
            isBounded
            useCSSTransforms
            onLayoutChange={handleLayoutChange}
            onBreakpointChange={handleBreakpointChange}
            onDragStart={isEditing ? handleDragStart : undefined}
            onDragStop={isEditing ? handleDragStop : undefined}
          >
            {widgets.map((widget) => (
              <div
                key={widget.id}
                className="dashboard-widget bg-surface rounded-xl border border-outline-variant/30 shadow-sm"
              >
                {isEditing && (
                  <div className="drag-handle" title="Glisser pour déplacer">
                    <GripVertical className="w-4 h-4 shrink-0 opacity-60" />
                    <span className="drag-handle__label truncate">
                      {getWidgetMeta(widget.widgetType)?.name || widget.widgetType}
                    </span>
                    {onRemoveWidget && (
                      <button
                        type="button"
                        title="Supprimer ce widget"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveWidget(widget.id);
                        }}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
                <div className="dashboard-widget__body">
                  {renderWidget ? renderWidget(widget) : null}
                </div>
              </div>
            ))}
          </ResponsiveGridLayout>
        )}
      </div>
    </motion.div>
  );
})
