import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { ResponsiveGridLayout, useContainerWidth, verticalCompactor } from 'react-grid-layout';
import { motion, AnimatePresence } from 'framer-motion';
import { GripVertical, X, Plus } from 'lucide-react';
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

export default memo(function DashboardGrid({
  layout = [],
  widgets = [],
  isEditing = false,
  onLayoutChange,
  onRemoveWidget,
  onWidgetDrop,
  renderWidget,
}) {
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropPosition, setDropPosition] = useState(null);

  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;

  const baseLayout = useMemo(() => normalizeLayout(layout, widgets), [layout, widgets]);
  const layouts = useMemo(() => ({ lg: baseLayout }), [baseLayout]);

  const breakpointRef = useRef('lg');
  const handleBreakpointChange = useCallback((newBreakpoint) => {
    breakpointRef.current = newBreakpoint;
  }, []);

  // Throttle onLayoutChange via requestAnimationFrame
  const rafRef = useRef(null);
  const handleLayoutChange = useCallback(
    (newLayout) => {
      if (!isEditing) return;
      if (breakpointRef.current !== 'lg') return;
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        onLayoutChange?.(stripLayout(newLayout), widgetsRef.current);
      });
    },
    [isEditing, onLayoutChange],
  );

  const dragConfig = useMemo(
    () => ({ enabled: isEditing, handle: '.drag-handle', threshold: 8 }),
    [isEditing],
  );
  const resizeConfig = useMemo(
    () => ({ enabled: isEditing, handles: ['se', 's', 'e'] }),
    [isEditing],
  );

  // ── Drop zone handlers ──────────────────────────────────────────────────────
  const handleDragOver = useCallback((e) => {
    if (!isEditing || !onWidgetDrop) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);

    // Calculer la position grid du drop
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const colWidth = (width - MARGIN[0] * (COLS.lg - 1)) / COLS.lg;
    const gridX = Math.max(0, Math.min(COLS.lg - 1, Math.floor(x / (colWidth + MARGIN[0]))));
    const gridY = Math.max(0, Math.floor(y / (ROW_HEIGHT + MARGIN[1])));
    setDropPosition({ x: gridX, y: gridY });
  }, [isEditing, onWidgetDrop, width]);

  const handleDragLeave = useCallback((e) => {
    if (!isEditing) return;
    // Ne fermer que si on sort vraiment du conteneur
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragOver(false);
      setDropPosition(null);
    }
  }, [isEditing]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
    setDropPosition(null);
    if (!isEditing || !onWidgetDrop) return;

    const widgetType = e.dataTransfer.getData('application/x-widget-type')
      || e.dataTransfer.getData('text/plain');
    if (!widgetType) return;

    // Calculer la position grid du drop
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const colWidth = (width - MARGIN[0] * (COLS.lg - 1)) / COLS.lg;
    const meta = getWidgetMeta(widgetType);
    const floor = sizeFloor(widgetType);
    const w = Math.min(floor.maxW, Math.max(floor.minW, meta?.defaultW || 4));
    const h = Math.min(floor.maxH, Math.max(floor.minH, meta?.defaultH || 3));
    const gridX = Math.max(0, Math.min(COLS.lg - w, Math.floor(x / (colWidth + MARGIN[0]))));
    const gridY = Math.max(0, Math.floor(y / (ROW_HEIGHT + MARGIN[1])));

    onWidgetDrop(widgetType, { x: gridX, y: gridY, w, h });
  }, [isEditing, onWidgetDrop, width]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <div
        ref={containerRef}
        className={`dashboard-grid${isEditing ? ' dashboard-grid--editing' : ''} relative`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drop zone overlay */}
        <AnimatePresence>
          {isDragOver && isEditing && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 z-40 rounded-xl border-2 border-dashed border-primary bg-primary/5 pointer-events-none flex items-center justify-center"
            >
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 text-primary text-sm font-semibold backdrop-blur-sm">
                <Plus className="w-4 h-4" />
                Déposer le widget ici
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {mounted && width > 0 && widgets.length > 0 && (
          <ResponsiveGridLayout
            width={width}
            layouts={layouts}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            rowHeight={ROW_HEIGHT}
            margin={MARGIN}
            containerPadding={[0, 0]}
            compactor={verticalCompactor}
            dragConfig={dragConfig}
            resizeConfig={resizeConfig}
            isBounded
            useCSSTransforms
            onLayoutChange={handleLayoutChange}
            onBreakpointChange={handleBreakpointChange}
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
