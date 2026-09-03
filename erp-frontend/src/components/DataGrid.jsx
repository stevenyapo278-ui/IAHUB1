/**
 * DataGrid — Composant réutilisable wrapper autour d'AG Grid Community.
 * Thème Katalyst-inspired avec tokens CSS du projet.
 *
 * Props :
 *   columns      – [{ field, headerName, pinned, cellRenderer, ...agGridColDef }]
 *   rowData      – Array d'objets
 *   pinnedBottomRowData – Array pour ligne(s) épinglée(s) en bas (résumé/totaux)
 *   onRowClick   – (rowData) => void
 *   rowSelection – 'single' | 'multiple' | undefined
 *   selectedIds  – number[]
 *   onSelectionChange – (ids[]) => void
 *   pagination   – boolean (default true)
 *   pageSize     – number (default 25)
 *   loading      – boolean
 *   height       – string | number (default '540px')
 *   animateRows  – boolean (default true)
 *   className    – classe CSS sur le conteneur extérieur
 *   extraGridOptions – options supplémentaires passées à AgGridReact
 */

import { useMemo, useRef, useCallback, useEffect, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { RefreshCw } from 'lucide-react';

ModuleRegistry.registerModules([AllCommunityModule]);

// ── Thème Katalyst-inspired ────────────────────────────────────────────────
const AG_GRID_THEME_ID = 'katalyst-datagrid-theme';

function ensureThemeInjected() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(AG_GRID_THEME_ID)) return;
  const style = document.createElement('style');
  style.id = AG_GRID_THEME_ID;
  style.textContent = `
    /* ── Katalyst AG Grid Theme — Premium Design System ──────────────── */
    .ag-theme-katalyst-datagrid {
      --ag-font-family: 'Plus Jakarta Sans', 'Inter', ui-sans-serif, system-ui, sans-serif;
      --ag-font-size: 13px;
      --ag-row-height: 48px;
      --ag-header-height: 44px;
      --ag-header-background-color: var(--color-surface-container-low, var(--color-surface-container-lowest, #f8fafc));
      --ag-header-foreground-color: var(--color-on-surface-variant, var(--muted-foreground, #6b7280));
      --ag-header-cell-font-weight: 600;
      --ag-header-cell-font-size: 10px;
      --ag-header-cell-letter-spacing: 0.06em;
      --ag-foreground-color: var(--color-on-surface, var(--foreground, #0f172a));
      --ag-background-color: var(--color-background, var(--background, #ffffff));
      --ag-border-color: var(--color-outline-variant, var(--border, #e5e7eb));
      --ag-row-hover-color: var(--color-surface-container-low, #f1f5f9);
      --ag-selected-row-background-color: color-mix(in srgb, var(--color-primary, #0067ff) 8%, transparent);
      --ag-range-selection-background-color: color-mix(in srgb, var(--color-primary, #0067ff) 12%, transparent);
      --ag-input-focus-border-color: var(--color-primary, #0067ff);
      --ag-input-border-color: var(--color-outline-variant, #e5e7eb);
      --ag-secondary-foreground-color: var(--color-on-surface-variant, #6b7280);
      --ag-checkbox-checked-color: var(--color-primary, #0067ff);
      --ag-icon-color: var(--color-on-surface-variant, #6b7280);
      --ag-input-focus-box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary, #0067ff) 20%, transparent);
      --ag-alpine-active-color: var(--color-primary, #0067ff);
      --ag-browser-color-scheme: light;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid var(--color-outline-variant, #e5e7eb);
      background: var(--color-background, #ffffff);
    }

    .dark .ag-theme-katalyst-datagrid {
      --ag-foreground-color: var(--color-on-surface, #f8fafc);
      --ag-background-color: var(--color-background, #0f172a);
      --ag-border-color: var(--color-outline-variant, #1e293b);
      --ag-header-background-color: var(--color-surface-container-low, #111827);
      --ag-header-foreground-color: var(--color-on-surface-variant, #94a3b8);
      --ag-row-hover-color: var(--color-surface-container-low, #1e293b);
      --ag-secondary-foreground-color: var(--color-on-surface-variant, #94a3b8);
      --ag-checkbox-checked-color: var(--color-primary, #3b82f6);
      --ag-icon-color: var(--color-on-surface-variant, #94a3b8);
      --ag-input-focus-border-color: var(--color-primary, #3b82f6);
      --ag-input-border-color: var(--color-outline-variant, #334155);
      --ag-browser-color-scheme: dark;
      border-color: var(--color-outline-variant, #1e293b);
    }

    /* Header cells — Katalyst uppercase, small, tracked */
    .ag-theme-katalyst-datagrid .ag-header {
      background: var(--ag-header-background-color);
    }
    .ag-theme-katalyst-datagrid .ag-header-cell {
      font-family: 'Plus Jakarta Sans', 'Inter', ui-sans-serif, system-ui, sans-serif;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--ag-header-foreground-color);
      border-bottom: 1px solid var(--ag-border-color);
      padding: 0 16px;
    }
    .ag-theme-katalyst-datagrid .ag-header-cell-label {
      gap: 4px;
    }

    /* Row styling — clean borders, smooth transitions */
    .ag-theme-katalyst-datagrid .ag-row {
      border-bottom: 1px solid color-mix(in srgb, var(--ag-border-color) 30%, transparent);
      transition: background-color 0.15s ease, transform 0.15s ease;
    }
    .ag-theme-katalyst-datagrid .ag-row:last-of-type {
      border-bottom: none;
    }
    .ag-theme-katalyst-datagrid .ag-row:hover {
      background-color: color-mix(in srgb, var(--color-primary, #0067ff) 4%, var(--ag-row-hover-color)) !important;
    }
    .ag-theme-katalyst-datagrid .ag-row-selected {
      background-color: var(--ag-selected-row-background-color) !important;
    }
    .ag-theme-katalyst-datagrid .ag-row-selected:hover {
      background-color: color-mix(in srgb, var(--color-primary, #0067ff) 12%, transparent) !important;
    }

    /* Cells — clean typography */
    .ag-theme-katalyst-datagrid .ag-cell {
      display: flex;
      align-items: center;
      font-size: 13px;
      color: var(--ag-foreground-color);
      padding: 0 12px;
      line-height: 1.4;
      border-right: none;
      overflow: hidden !important;
      text-overflow: ellipsis;
    }
    .ag-theme-katalyst-datagrid .ag-cell-focus {
      border: none !important;
      outline: none !important;
    }
    .ag-theme-katalyst-datagrid .ag-cell-focus:not(.ag-cell-range-selected) {
      border: none !important;
    }

    /* Pinned column dividers — subtle vertical lines */
    .ag-theme-katalyst-datagrid .ag-pinned-left-header,
    .ag-theme-katalyst-datagrid .ag-pinned-left-cols-container {
      border-right: 1px solid color-mix(in srgb, var(--ag-border-color) 40%, transparent);
    }
    .ag-theme-katalyst-datagrid .ag-pinned-right-header,
    .ag-theme-katalyst-datagrid .ag-pinned-right-cols-container {
      border-left: 1px solid color-mix(in srgb, var(--ag-border-color) 40%, transparent);
    }

    /* Sort indicators */
    .ag-theme-katalyst-datagrid .ag-sort-ascending-icon,
    .ag-theme-katalyst-datagrid .ag-sort-descending-icon,
    .ag-theme-katalyst-datagrid .ag-sort-none-icon {
      display: none;
    }
    .ag-theme-katalyst-datagrid .ag-sort-ascending-icon {
      display: inline;
    }

    /* Pagination */
    .ag-theme-katalyst-datagrid .ag-paging-panel {
      border-top: 1px solid var(--ag-border-color);
      font-size: 12px;
      color: var(--ag-secondary-foreground-color);
      padding: 8px 16px;
      background: var(--ag-header-background-color);
    }

    /* No rows overlay */
    .ag-theme-katalyst-datagrid .ag-overlay-no-rows-wrapper {
      color: var(--ag-secondary-foreground-color);
      font-size: 14px;
      font-weight: 500;
    }

    /* Column menu — premium dropdown */
    .ag-theme-katalyst-datagrid .ag-menu {
      border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.15);
      border: 1px solid var(--ag-border-color);
      overflow: hidden;
    }

    /* Row animation */
    .ag-theme-katalyst-datagrid .ag-row-animation {
      transition: background-color 0.15s ease, transform 0.15s ease;
    }

    /* Pinned bottom row (total/summary) */
    .ag-theme-katalyst-datagrid .ag-pinned-bottom-cols-container .ag-cell {
      font-weight: 700;
      background-color: color-mix(in srgb, var(--color-primary, #0067ff) 6%, transparent);
    }
    .ag-theme-katalyst-datagrid .ag-pinned-bottom-row {
      border-top: 2px solid var(--ag-border-color);
    }

    /* Checkbox styling */
    .ag-theme-katalyst-datagrid .ag-checkbox-input {
      border-radius: 4px;
      border: 1.5px solid var(--ag-border-color);
      width: 16px;
      height: 16px;
    }
    .ag-theme-katalyst-datagrid .ag-checkbox-input:checked {
      background-color: var(--ag-checkbox-checked-color);
      border-color: var(--ag-checkbox-checked-color);
    }

    /* Column resize handle */
    .ag-theme-katalyst-datagrid .ag-header-cell-resize::after {
      background-color: var(--color-primary, #0067ff);
      width: 2px;
    }
  `;
  document.head.appendChild(style);
}

// ── Hook for row entrance animation ────────────────────────────────────────
function useRowAnimation() {
  const isInitialRender = useState(true)[0];
  const ref = useRef(null);
  const onFirstDataRendered = useCallback(() => {
    if (isInitialRender) return;
    const el = ref.current;
    if (el) {
      el.classList.add('ag-rows-in');
      window.setTimeout(() => el.classList.remove('ag-rows-in'), 1000);
    }
  }, [isInitialRender]);
  return { ref, onFirstDataRendered };
}

// ── Composant principal ─────────────────────────────────────────────────
export default function DataGrid({
  columns = [],
  rowData = [],
  pinnedBottomRowData,
  onRowClick,
  rowSelection,
  selectedIds,
  onSelectionChange,
  pagination = true,
  pageSize = 25,
  paginationPageSizeSelector = [10, 25, 50, 100],
  loading = false,
  animateRows = true,
  headerHeight = 40,
  rowHeight = 48,
  suppressRowClickSelection = false,
  extraGridOptions = {},
  className = '',
  noRowsText = 'Aucune donnée',
  getRowId,
  height = '540px',
}) {
  const gridRef = useRef(null);
  const { ref: containerRef, onFirstDataRendered } = useRowAnimation();

  useEffect(() => {
    ensureThemeInjected();
  }, []);

  // Gérer la sélection externe
  useEffect(() => {
    if (!gridRef.current || !selectedIds || !onSelectionChange) return;
    const api = gridRef.current.api;
    if (!api) return;
    api.forEachNode((node) => {
      const shouldSelect = selectedIds.includes(node.data?.id);
      if (node.isSelected() !== shouldSelect) {
        node.setSelected(shouldSelect, false);
      }
    });
  }, [selectedIds, onSelectionChange]);

  const onSelectionChanged = useCallback(() => {
    if (!onSelectionChange || !gridRef.current?.api) return;
    const selectedNodes = gridRef.current.api.getSelectedNodes();
    const ids = selectedNodes.map((n) => n.data?.id).filter(Boolean);
    onSelectionChange(ids);
  }, [onSelectionChange]);

  const onRowClicked = useCallback((event) => {
    if (onRowClick && event.data) {
      onRowClick(event.data);
    }
  }, [onRowClick]);

  const defaultGetRowId = useCallback((params) => {
    return String(params.data?.id ?? params.data?.ID ?? Math.random());
  }, []);

  const noRowsOverlayComponent = useCallback(() => (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/60">
      <span className="text-sm">{noRowsText}</span>
    </div>
  ), [noRowsText]);

  const defaultColDef = useMemo(() => ({
    sortable: true,
    resizable: true,
    filter: false,
  }), []);

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-sm rounded-xl">
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface shadow-lg border border-border/30">
            <RefreshCw className="w-4 h-4 animate-spin text-primary" />
            <span className="text-xs font-semibold text-muted-foreground">Chargement...</span>
          </div>
        </div>
      )}
      <div
        className="ag-theme-katalyst-datagrid"
        style={{ width: '100%', height }}
      >
        <AgGridReact
          ref={gridRef}
          columnDefs={columns}
          rowData={rowData}
          defaultColDef={defaultColDef}
          onRowClicked={onRowClicked}
          rowSelection={rowSelection}
          onSelectionChanged={onSelectionChanged}
          suppressRowClickSelection={suppressRowClickSelection || !!rowSelection}
          pagination={pagination}
          paginationPageSize={pageSize}
          paginationPageSizeSelector={paginationPageSizeSelector}
          animateRows={animateRows}
          headerHeight={headerHeight}
          rowHeight={rowHeight}
          overlayNoRowsTemplate="custom"
          noRowsOverlayComponent={noRowsOverlayComponent}
          getRowId={getRowId || defaultGetRowId}
          suppressCellFocus={true}
          enableCellTextSelection={true}
          onFirstDataRendered={onFirstDataRendered}
          pinnedBottomRowData={pinnedBottomRowData}
          {...extraGridOptions}
        />
      </div>
    </div>
  );
}

// ── Cell Renderers réutilisables ────────────────────────────────────────

/** Badge renderer — affiche un badge coloré. */
export function BadgeRenderer({ bg, text, label, border }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap ${bg || ''} ${text || ''} ${border || ''}`}>
      {label}
    </span>
  );
}

/** Avatar + name renderer — photo ou initiale + nom + email. */
export function AvatarNameRenderer({ data }) {
  if (!data) return null;
  const initials = (data.name || data.fullName || '?').charAt(0).toUpperCase();
  return (
    <div className="flex h-full items-center gap-2.5">
      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
        {data.avatar ? (
          <img src={data.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
        ) : initials}
      </span>
      <div className="leading-tight min-w-0">
        <div className="font-medium text-foreground truncate text-sm">{data.name || data.fullName}</div>
        {data.email && <div className="text-xs text-muted-foreground truncate">{data.email}</div>}
      </div>
    </div>
  );
}

/** Date renderer */
export function DateRenderer({ value }) {
  if (!value) return <span className="text-muted-foreground/40">—</span>;
  const d = new Date(value);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return <span className="text-sm font-medium text-muted-foreground tabular-nums">{dd}-{mm}-{yyyy}</span>;
}

/** DateTime renderer */
export function DateTimeRenderer({ value }) {
  if (!value) return <span className="text-muted-foreground/40">—</span>;
  const d = new Date(value);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return <span className="text-sm font-medium text-muted-foreground tabular-nums">{dd}-{mm}-{yyyy} {hh}:{min}</span>;
}

/** Actions renderer — boutons d'action stylisés comme Katalyst */
export function ActionsRenderer({ actions = [] }) {
  const btnCls = "inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground";
  return (
    <div className="flex h-full items-center gap-1">
      {actions.map((action, i) => {
        const Icon = action.icon;
        return (
          <button
            key={i}
            type="button"
            aria-label={action.title}
            className={btnCls}
            onClick={(e) => {
              e.stopPropagation();
              action.onClick(action.data);
            }}
          >
            {Icon && <Icon className="h-4 w-4" />}
          </button>
        );
      })}
    </div>
  );
}
