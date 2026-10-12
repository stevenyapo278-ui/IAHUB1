import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResponsiveGridLayout, useContainerWidth, verticalCompactor } from 'react-grid-layout';
import { motion, AnimatePresence } from 'framer-motion';
import { GripVertical, X, Plus } from 'lucide-react';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { getWidgetMeta } from './widgetCatalog';
import { sizeFloor, defaultSize, overlaps, computeDefaultPosition } from './gridLayout';

const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480 };
const COLS = { lg: 12, md: 10, sm: 6, xs: 4 };
const MARGIN = [12, 12];
const ROW_HEIGHT = 90;

/* Même règle que `getBreakpointFromWidth` de react-grid-layout : plus grand
   seuil strictement inférieur à la largeur, sinon le plus petit (xs).
   Sert à connaître le breakpoint AVANT le premier render de la grille. */
function breakpointFromWidth(width) {
  const sorted = Object.keys(BREAKPOINTS).sort((a, b) => BREAKPOINTS[a] - BREAKPOINTS[b]);
  let matching = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (width > BREAKPOINTS[sorted[i]]) matching = sorted[i];
  }
  return matching;
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
  onBreakpointChange,
  renderWidget,
}) {
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropPosition, setDropPosition] = useState(null);

  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;

  const baseLayout = useMemo(() => normalizeLayout(layout, widgets), [layout, widgets]);
  const layouts = useMemo(() => ({ lg: baseLayout }), [baseLayout]);

  // Le layout persisté n'existe qu'en 12 colonnes (breakpoint lg) : en dessous,
  // react-grid-layout DÉRIVE une mise en page non persistée. On recalcule le
  // breakpoint depuis la largeur mesurée (même règle que RGL) et on le remonte
  // pour que la page sache si la réorganisation est possible.
  const currentBreakpoint = breakpointFromWidth(width);
  const lastReportedBpRef = useRef(null);
  const onBreakpointChangePropRef = useRef(onBreakpointChange);
  onBreakpointChangePropRef.current = onBreakpointChange;

  useEffect(() => {
    if (!mounted || !(width > 0)) return;
    if (lastReportedBpRef.current === currentBreakpoint) return;
    lastReportedBpRef.current = currentBreakpoint;
    onBreakpointChangePropRef.current?.(currentBreakpoint);
  }, [mounted, width, currentBreakpoint]);

  // La réorganisation (drag / resize / drop) n'est possible que sur le layout
  // source de vérité : 12 colonnes, conteneur > 1200px.
  const canRearrange = isEditing && currentBreakpoint === 'lg';

  // Throttle onLayoutChange via requestAnimationFrame
  const rafRef = useRef(null);
  const handleLayoutChange = useCallback(
    (newLayout) => {
      if (!canRearrange) return;
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        onLayoutChange?.(stripLayout(newLayout), widgetsRef.current);
      });
    },
    [canRearrange, onLayoutChange],
  );

  const dragConfig = useMemo(
    () => ({ enabled: canRearrange, handle: '.drag-handle', threshold: 8 }),
    [canRearrange],
  );
  const resizeConfig = useMemo(
    () => ({ enabled: canRearrange, handles: ['se', 's', 'e'] }),
    [canRearrange],
  );

  // Colonnes de la grille réellement affichée : 12 sur lg, 10/6/4 en dessous.
  const activeCols = COLS[currentBreakpoint] || COLS.lg;

  // ── Drop zone handlers ──────────────────────────────────────────────────────
  const handleDragOver = useCallback((e) => {
    if (!canRearrange || !onWidgetDrop) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);

    // Calculer la position grid du drop
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const colWidth = (width - MARGIN[0] * (activeCols - 1)) / activeCols;
    const gridX = Math.max(0, Math.min(activeCols - 1, Math.floor(x / (colWidth + MARGIN[0]))));
    const gridY = Math.max(0, Math.floor(y / (ROW_HEIGHT + MARGIN[1])));
    setDropPosition({ x: gridX, y: gridY });
  }, [canRearrange, onWidgetDrop, width, activeCols]);

  const handleDragLeave = useCallback((e) => {
    if (!canRearrange) return;
    // Ne fermer que si on sort vraiment du conteneur
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragOver(false);
      setDropPosition(null);
    }
  }, [canRearrange]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
    setDropPosition(null);
    if (!canRearrange || !onWidgetDrop) return;

    const widgetType = e.dataTransfer.getData('application/x-widget-type')
      || e.dataTransfer.getData('text/plain');
    if (!widgetType) return;

    // Calculer la position grid du drop
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const colWidth = (width - MARGIN[0] * (activeCols - 1)) / activeCols;
    const { w, h } = defaultSize(widgetType);
    const gridX = Math.max(0, Math.min(activeCols - w, Math.floor(x / (colWidth + MARGIN[0]))));
    const gridY = Math.max(0, Math.floor(y / (ROW_HEIGHT + MARGIN[1])));
    const requested = { x: gridX, y: gridY, w, h };

    // Jamais de chevauchement : en zone déjà prise, on retombe sur le premier
    // emplacement libre. Sans ce garde, react-grid-layout résout la collision en
    // DÉPLAÇANT les widgets déjà en place.
    const position = overlaps(baseLayout, requested)
      ? computeDefaultPosition(widgetType, baseLayout)
      : requested;

    onWidgetDrop(widgetType, position);
  }, [canRearrange, onWidgetDrop, width, activeCols, baseLayout]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <div
        ref={containerRef}
        className={`dashboard-grid${isEditing ? ' dashboard-grid--editing' : ''}${
          isEditing && !canRearrange ? ' dashboard-grid--locked' : ''
        } relative`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drop zone overlay */}
        <AnimatePresence>
          {isDragOver && canRearrange && (
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
          >
            {widgets.map((widget) => (
              <div
                key={widget.id}
                className="dashboard-widget bg-surface rounded-xl border border-outline-variant/30 shadow-sm"
              >
                {isEditing && (
                  <div
                    className="drag-handle"
                    title={canRearrange ? 'Glisser pour déplacer' : 'Déplacement disponible à partir de 1200 px de large'}
                  >
                    <GripVertical className={`w-4 h-4 shrink-0 ${canRearrange ? 'opacity-60' : 'opacity-30'}`} />
                    {/* Le titre du widget est dans le header de WidgetRenderer */}
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
