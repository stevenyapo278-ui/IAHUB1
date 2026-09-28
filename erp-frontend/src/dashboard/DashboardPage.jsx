import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { LayoutDashboard, RotateCcw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import ConfirmDialog from '../components/ConfirmDialog';
import api from '../api/client';
import {
  useDashboards,
  useDashboardStats,
  useActivityTrend,
  useRecentActivity,
  useTechnicianPerformance,
  useSlaAnalytics,
  useIntegrations,
  usePendingApprovals,
  usePendingAiDrafts,
  useNeedsReview,
  useReplySuggestions,
  useTicketHeatmap,
  useWorkloadByTeam,
} from './useDashboard';
import DashboardGrid from './DashboardGrid';
import DashboardToolbar from './DashboardToolbar';
import { StatCardSkeleton } from '../components/Skeleton';
import WidgetPicker from './WidgetPicker';
import WidgetRenderer from './WidgetRenderer';
import { getWidgetMeta, SCOPE_SELECTABLE } from './widgetCatalog';
import { LAYOUT_PRESETS, applyPreset, autoDistribute } from './layoutPresets';
import { computeDefaultPosition, overlaps } from './gridLayout';

const PERIOD_MAP = { '7d': 7, '30d': 30, '90d': 90, '180d': 180 };
// Libellés de période pour les sous-titres (précision) des widgets
const PERIOD_LABELS = {
  '7d': '7 derniers jours',
  '30d': '30 derniers jours',
  '90d': '90 derniers jours',
  '180d': '180 derniers jours',
};

/* Clé localStorage du dernier dashboard actif, par utilisateur */
const lastDashboardKey = (userId) => `dashboard:last-active:${userId || 'anon'}`;

function readLastDashboardId(userId) {
  try {
    return localStorage.getItem(lastDashboardKey(userId));
  } catch {
    return null;
  }
}

function writeLastDashboardId(userId, id) {
  try {
    if (id) localStorage.setItem(lastDashboardKey(userId), id);
    else localStorage.removeItem(lastDashboardKey(userId));
  } catch {
    /* quota / mode privé : ignorer */
  }
}

export default function DashboardPage() {
  const [activeDashboardId, setActiveDashboardId] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [isDraggingFromPicker, setIsDraggingFromPicker] = useState(false);
  const [activePeriod, setActivePeriod] = useState('30d');
  const [reportLoading, setReportLoading] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Confirmations via ConfirmDialog (modale standard de la plateforme)
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { id, name } | null
  const [deleting, setDeleting] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const layoutSaveTimeout = useRef(null);

  const { user } = useAuth();
  const days = PERIOD_MAP[activePeriod] || 30;

  // SWR hooks
  const { dashboards, isLoading: isLoadingDashboards, mutate: mutateDashboards } = useDashboards();

  // Active dashboard data — déclaré AVANT les hooks de stats : les scopes
  // demandés (sélecteur par widget) dépendent des widgets du dashboard actif.
  const activeDashboard = useMemo(
    () => dashboards.find((d) => d.id === activeDashboardId) || null,
    [dashboards, activeDashboardId],
  );
  const currentWidgets = activeDashboard?.widgets || [];
  const currentLayout = activeDashboard?.layout || [];

  const periodLabel = PERIOD_LABELS[activePeriod] || 'toutes périodes';

  // Périmètres réellement utilisés par les widgets (config.scope) : les fetchs
  // open/closed ne sont émis que s'ils servent à au moins un widget sélectionnable.
  const neededScopes = useMemo(() => {
    const scopes = new Set();
    for (const w of currentWidgets) {
      const scope = SCOPE_SELECTABLE.has(w.widgetType) ? w.config?.scope : null;
      if (scope === 'open' || scope === 'closed') scopes.add(scope);
    }
    return scopes;
  }, [currentWidgets]);

  const { stats, isLoading: isLoadingStats, error: errorStats } = useDashboardStats(days, 'all', true);
  const { stats: statsOpen } = useDashboardStats(days, 'open', neededScopes.has('open'));
  const { stats: statsClosed } = useDashboardStats(days, 'closed', neededScopes.has('closed'));
  const { trend, isLoading: isLoadingTrend, error: errorTrend } = useActivityTrend(days);
  const { activity } = useRecentActivity();
  const { techPerformance } = useTechnicianPerformance(days);
  const { slaAnalytics } = useSlaAnalytics(days);
  const { integrations } = useIntegrations();
  const { pendingApprovals } = usePendingApprovals();
  const { pendingAiDrafts } = usePendingAiDrafts();
  const { needsReview } = useNeedsReview();
  const { replySuggestions } = useReplySuggestions();
  const { heatmap } = useTicketHeatmap(20);
  const { workloadByTeam } = useWorkloadByTeam();

  // On mount: pick a dashboard
  useEffect(() => {
    if (isLoadingDashboards) return;

    if (dashboards.length === 0) {
      // Create a default dashboard
      api
        .post('/dashboards', { name: 'Mon Dashboard' })
        .then(({ data }) => {
          mutateDashboards();
          setActiveDashboardId(data.id);
        })
        .catch(() => {});
    } else if (!activeDashboardId) {
      // Dernier dashboard actif (localStorage) > principal (isDefault) > premier
      const lastId = readLastDashboardId(user?.id);
      const stillExists = lastId && dashboards.some((d) => d.id === lastId);
      const fallback = dashboards.find((d) => d.isDefault) || dashboards[0];
      setActiveDashboardId(stillExists ? lastId : fallback.id);
    }
  }, [dashboards, isLoadingDashboards, activeDashboardId, user?.id, mutateDashboards]);

  // Layout servi par l'API (référence pour détecter les vrais changements)
  const servedLayoutKey = useMemo(() => JSON.stringify(currentLayout), [currentLayout]);
  const servedLayoutRef = useRef(servedLayoutKey);
  servedLayoutRef.current = servedLayoutKey;

  // Dernier layout commité par la grille (pending save)
  const pendingLayoutRef = useRef(null);

  // Miroir du dernier layout connu côté client. Le cache SWR (`currentLayout`)
  // peut rester périmé entre un flush et son refetch — les ajouts/suppressions
  // construisent leur PATCH dessus pour ne JAMAIS réécrire d'anciennes positions.
  const latestLayoutRef = useRef(null);

  // Changement de dashboard / nouveau dashboard : on repart du cache serveur
  useEffect(() => {
    latestLayoutRef.current = null;
  }, [activeDashboardId]);

  const flushLayoutSave = useCallback(() => {
    if (layoutSaveTimeout.current) {
      clearTimeout(layoutSaveTimeout.current);
      layoutSaveTimeout.current = null;
    }
    if (!activeDashboardId || !pendingLayoutRef.current) return;
    const layoutToSave = pendingLayoutRef.current;
    pendingLayoutRef.current = null;
    api.patch(`/dashboards/${activeDashboardId}`, { layout: layoutToSave }).catch(() => {});
  }, [activeDashboardId]);

  // Layout change handler (debounced save, no-op skipped)
  const handleLayoutChange = useCallback(
    (newLayout) => {
      if (!activeDashboardId) return;

      // Miroir toujours à jour du layout tel que la grille l'affiche
      latestLayoutRef.current = newLayout;

      // Ignore les re-compactions identiques au layout servi : sans ce garde,
      // chaque re-render du serveur relance une sauvegarde (layout instable).
      const key = JSON.stringify(newLayout);
      if (key === servedLayoutRef.current && pendingLayoutRef.current === null) return;

      pendingLayoutRef.current = newLayout;
      servedLayoutRef.current = key;

      if (layoutSaveTimeout.current) {
        clearTimeout(layoutSaveTimeout.current);
      }
      layoutSaveTimeout.current = setTimeout(flushLayoutSave, 800);
    },
    [activeDashboardId, flushLayoutSave],
  );

  // Ref pour lire l'id actif dans le cleanup sans re-souscrire l'effet —
  // déclaré AVANT l'effet de flush qui le référence.
  const activeDashboardIdRef = useRef(activeDashboardId);
  activeDashboardIdRef.current = activeDashboardId;

  // Mémorise le dernier dashboard actif (retrouvé après rechargement)
  useEffect(() => {
    if (activeDashboardId) writeLastDashboardId(user?.id, activeDashboardId);
  }, [activeDashboardId, user?.id]);

  // Mémorise le dernier dashboard actif (retrouvé après rechargement)
  useEffect(() => {
    if (activeDashboardId) writeLastDashboardId(user?.id, activeDashboardId);
  }, [activeDashboardId, user?.id]);

  // Flush du layout pending au démontage (fermeture d'onglet, navigation)
  useEffect(() => {
    return () => {
      if (layoutSaveTimeout.current) clearTimeout(layoutSaveTimeout.current);
      if (pendingLayoutRef.current && activeDashboardIdRef.current) {
        api
          .patch(`/dashboards/${activeDashboardIdRef.current}`, { layout: pendingLayoutRef.current })
          .catch(() => {});
        pendingLayoutRef.current = null;
      }
    };
  }, []);

  // Réinitialiser isDragging quand le drag native se termine (drop ou cancel)
  useEffect(() => {
    const handleDragEnd = () => setIsDraggingFromPicker(false);
    document.addEventListener('dragend', handleDragEnd);
    return () => document.removeEventListener('dragend', handleDragEnd);
  }, []);

  // Add widget
  const handleAddWidget = useCallback(
    async (widgetType, position) => {
      if (!activeDashboardId) return;

      try {
        // Base la plus fraîche côté client : miroir du layout affiché (couvre le
        // debounce 800 ms ET la fenêtre flush→refetch où le cache SWR est périmé).
        const base = latestLayoutRef.current ?? currentLayout;
        // Purge des entrées orphelines (widget supprimé dont le layout garde la trace)
        const liveLayout = base.filter((l) =>
          currentWidgets.some((w) => w.id === l.i),
        );

        // Position demandée uniquement si elle ne chevauche rien ; sinon repli
        // sur le premier emplacement libre. Les widgets déjà en place ne bougent jamais.
        const pos = position && !overlaps(liveLayout, position)
          ? position
          : computeDefaultPosition(widgetType, liveLayout);

        // 1. Créer le widget (source de vérité pour l'id généré)
        const { data: newWidget } = await api.post(`/dashboards/${activeDashboardId}/widgets`, {
          widgetType,
        });

        // 2. Écriture atomique : on annule le flush en attente, notre PATCH
        //    contient déjà le layout complet + la nouvelle entrée.
        if (layoutSaveTimeout.current) {
          clearTimeout(layoutSaveTimeout.current);
          layoutSaveTimeout.current = null;
        }
        pendingLayoutRef.current = null;

        const newLayout = [...liveLayout, { i: newWidget.id, ...pos }];
        await api.patch(`/dashboards/${activeDashboardId}`, { layout: newLayout });
        latestLayoutRef.current = newLayout;

        await mutateDashboards();
        setShowPicker(false);
      } catch {
        // silently fail
      }
    },
    [activeDashboardId, currentLayout, currentWidgets, mutateDashboards],
  );

  // Drop handler: called when a widget is dropped from the picker onto the grid
  const handleWidgetDrop = useCallback(
    (widgetType, position) => {
      setIsDraggingFromPicker(false);
      handleAddWidget(widgetType, position);
    },
    [handleAddWidget],
  );

  // Sélecteur de périmètre par widget (Tous | Ouverts | Fermés) —
  // choix persisté dans widget.config.scope (aucune migration nécessaire)
  const handleScopeChange = useCallback(
    async (widget, scope) => {
      if (!activeDashboardId) return;
      try {
        await api.patch(`/dashboards/${activeDashboardId}/widgets/${widget.id}`, {
          config: { ...(widget.config || {}), scope },
        });
        await mutateDashboards();
      } catch {
        // silently fail
      }
    },
    [activeDashboardId, mutateDashboards],
  );

  // Remove widget
  const handleRemoveWidget = useCallback(
    async (widgetId) => {
      if (!activeDashboardId) return;

      try {
        await api.delete(`/dashboards/${activeDashboardId}/widgets/${widgetId}`);

        // Base fraîche (cf. handleAddWidget) : purge l'entrée du layout + les
        // entrées orphelines restantes, sans réécrire d'anciennes positions
        const kept = currentWidgets.filter((w) => w.id !== widgetId);
        const keptIds = new Set(kept.map((w) => w.id));
        const newLayout = (latestLayoutRef.current ?? currentLayout).filter((l) => keptIds.has(l.i));
        if (layoutSaveTimeout.current) {
          clearTimeout(layoutSaveTimeout.current);
          layoutSaveTimeout.current = null;
        }
        pendingLayoutRef.current = null;
        await api.patch(`/dashboards/${activeDashboardId}`, { layout: newLayout });
        latestLayoutRef.current = newLayout;

        await mutateDashboards();
      } catch {
        // silently fail
      }
    },
    [activeDashboardId, currentLayout, currentWidgets, mutateDashboards],
  );

  // Create new dashboard
  const handleCreateDashboard = useCallback(async () => {
    try {
      const { data } = await api.post('/dashboards', { name: 'Mon Dashboard' });
      mutateDashboards();
      setActiveDashboardId(data.id);
      setIsEditing(false);
    } catch {
      // silently fail
    }
  }, [mutateDashboards]);

  // Application du modèle par défaut (sans confirmation) — utilisé par le
  // reset ET par le CTA de l'état vide. Invalide toute sauvegarde de layout
  // en attente qui pourrait écraser l'opération.
  const applyTemplate = useCallback(async () => {
    if (!activeDashboardId) return;
    pendingLayoutRef.current = null;
    latestLayoutRef.current = null;
    if (layoutSaveTimeout.current) {
      clearTimeout(layoutSaveTimeout.current);
      layoutSaveTimeout.current = null;
    }
    await api.post(`/dashboards/${activeDashboardId}/reset`);
    await mutateDashboards();
  }, [activeDashboardId, mutateDashboards]);

  // Reset dashboard: supprime les widgets actuels et applique le modèle par défaut
  // (confirmation via ConfirmDialog, voir plus bas)
  const handleResetDashboard = useCallback(() => {
    if (!activeDashboardId) return;
    setResetConfirmOpen(true);
  }, [activeDashboardId]);

  const handleResetConfirm = useCallback(async () => {
    setResetting(true);
    try {
      await applyTemplate();
      setResetConfirmOpen(false);
    } catch {
      // silently fail — la modale reste ouverte pour réessayer
    } finally {
      setResetting(false);
    }
  }, [applyTemplate]);

  // Download report
  const handleDownloadReport = useCallback(async () => {
    setReportLoading(true);
    try {
      const periodLabel = activePeriod === '7d' ? '7_jours'
        : activePeriod === '90d' ? '3_mois'
        : activePeriod === '180d' ? '6_mois'
        : '30_jours';

      const res = await api.get(`/dashboard/report?days=${days}&format=pdf`, {
        responseType: 'blob',
      });

      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Rapport_${periodLabel}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      // silently fail
    } finally {
      setReportLoading(false);
    }
  }, [activePeriod, days]);

  // ── Preset layout / Auto-distribute ──────────────────────────────────────
  // Sauvegarde immédiate + re-fetch pour que la grille se mette à jour visuellement.
  const saveLayoutImmediate = useCallback(
    async (newLayout) => {
      if (!activeDashboardId) return;
      pendingLayoutRef.current = null;
      latestLayoutRef.current = newLayout;
      if (layoutSaveTimeout.current) {
        clearTimeout(layoutSaveTimeout.current);
        layoutSaveTimeout.current = null;
      }
      try {
        await api.patch(`/dashboards/${activeDashboardId}`, { layout: newLayout });
        await mutateDashboards();
      } catch { /* silently fail */ }
    },
    [activeDashboardId, mutateDashboards],
  );

  const handleApplyPreset = useCallback(
    (presetKey) => {
      const preset = LAYOUT_PRESETS[presetKey];
      if (!preset || !currentWidgets.length) return;

      const layoutMap = new Map((currentLayout || []).map(l => [l.i, l]));
      const enriched = currentWidgets.map(w => ({
        ...w,
        _x: layoutMap.get(w.id)?.x ?? 0,
        _y: layoutMap.get(w.id)?.y ?? 0,
      }));

      const newLayout = applyPreset(enriched, preset, 12);
      if (!newLayout.length) return;
      saveLayoutImmediate(newLayout);
      toast.success(`Disposition appliquée : ${preset.label}`);
    },
    [currentWidgets, currentLayout, saveLayoutImmediate],
  );

  const handleAutoDistribute = useCallback(() => {
    if (!currentLayout?.length) return;

    const layoutWithConstraints = currentLayout.map(item => {
      const widget = currentWidgets.find(w => w.id === item.i);
      const category = widget ? getWidgetMeta(widget.widgetType)?.category : null;
      const floor = category === 'KPIs' ? { minW: 2, minH: 2 }
        : category === 'Graphiques' ? { minW: 3, minH: 3 }
        : category === 'Tableaux' ? { minW: 4, minH: 3 }
        : { minW: 3, minH: 2 };
      return {
        ...item,
        w: Math.max(floor.minW, item.w),
        h: Math.max(floor.minH, item.h),
      };
    });

    const newLayout = autoDistribute(layoutWithConstraints, 12);
    if (!newLayout.length) return;
    saveLayoutImmediate(newLayout);
    toast.success('Widgets répartis automatiquement');
  }, [currentLayout, currentWidgets, saveLayoutImmediate]);

  // Renommer un dashboard
  const handleRenameDashboard = useCallback(
    async (dashboardId, newName) => {
      try {
        await api.patch(`/dashboards/${dashboardId}`, { name: newName });
        mutateDashboards();
      } catch {
        // silently fail
      }
    },
    [mutateDashboards],
  );

  // Supprimer un dashboard — bascule sur un autre si c'était l'actif
  // (la confirmation passe par ConfirmDialog : handleDeleteConfirm)
  const handleDeleteDashboard = useCallback(
    (dashboardId) => {
      const target = dashboards.find((d) => d.id === dashboardId);
      setDeleteConfirm({ id: dashboardId, name: target?.name || 'ce tableau de bord' });
    },
    [dashboards],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirm) return;
    const { id: dashboardId } = deleteConfirm;
    setDeleting(true);
    try {
      await api.delete(`/dashboards/${dashboardId}`);

      // Si on supprime l'actif : basculer sur un autre (principal d'abord)
      if (dashboardId === activeDashboardId) {
        const remaining = dashboards.filter((d) => d.id !== dashboardId);
        const next = remaining.find((d) => d.isDefault) || remaining[0] || null;
        setActiveDashboardId(next?.id || null);
        writeLastDashboardId(user?.id, next?.id || null);
      }

      mutateDashboards();
      setDeleteConfirm(null);
    } catch {
      // silently fail — la modale reste ouverte pour réessayer
    } finally {
      setDeleting(false);
    }
  }, [deleteConfirm, dashboards, activeDashboardId, mutateDashboards, user?.id]);

  // Switch dashboard: flush pending save + reset editing
  const handleSelectDashboard = useCallback(
    (id) => {
      if (id === activeDashboardId) return;
      flushLayoutSave();
      setActiveDashboardId(id);
      setIsEditing(false);
    },
    [activeDashboardId, flushLayoutSave],
  );

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 pb-8 space-y-5 min-h-screen">
      {/* Toolbar */}
      <DashboardToolbar
        dashboards={dashboards}
        activeDashboardId={activeDashboardId}
        onSelectDashboard={handleSelectDashboard}
        onCreateDashboard={handleCreateDashboard}
        onRenameDashboard={handleRenameDashboard}
        onDeleteDashboard={handleDeleteDashboard}
        isEditing={isEditing}
        onToggleEdit={() => {
          // En quittant le mode édition : sauvegarde immédiate du layout pending
          setIsEditing((prev) => {
            if (prev) flushLayoutSave();
            return !prev;
          });
        }}
        onAddWidget={() => setShowPicker(true)}
        onApplyPreset={handleApplyPreset}
        onAutoDistribute={handleAutoDistribute}
        onReset={handleResetDashboard}
        resetting={resetting}
        activePeriod={activePeriod}
        onPeriodChange={setActivePeriod}
        onDownloadReport={handleDownloadReport}
        reportLoading={reportLoading}
      />

      {/* Loading state — squelette de grille pour éviter tout saut de mise en page */}
      {(isLoadingStats || isLoadingTrend) && !stats && (
        <div className="space-y-4" role="status" aria-label="Chargement du dashboard">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }, (_, i) => (
              <StatCardSkeleton key={i} />
            ))}
          </div>
          <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl p-lg animate-pulse space-y-3">
            <div className="h-3 w-40 rounded-lg bg-surface-container-high/60" />
            <div className="h-8 w-24 rounded-lg bg-surface-container-high/60" />
            <div className="h-32 w-full rounded-lg bg-surface-container-high/40" />
          </div>
          <span className="sr-only">Chargement des statistiques…</span>
        </div>
      )}

      {/* Error state */}
      {(errorStats || errorTrend) && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-sm font-semibold text-center">
          Erreur de chargement du dashboard
        </div>
      )}

      {/* Widget Grid */}
      {stats && (
        <DashboardGrid
          layout={currentLayout}
          widgets={currentWidgets}
          isEditing={isEditing}
          onLayoutChange={handleLayoutChange}
          onRemoveWidget={handleRemoveWidget}
          onWidgetDrop={isEditing ? handleWidgetDrop : null}
          renderWidget={(widget) => (
            <WidgetRenderer
              widget={widget}
              allData={{
                stats,
                statsOpen,
                statsClosed,
                trend,
                activity,
                techPerformance,
                slaAnalytics,
                integrations,
                pendingApprovals,
                pendingAiDrafts,
                needsReview,
                replySuggestions,
                heatmap,
                workloadByTeam,
                period: activePeriod,
                periodLabel,
                onScopeChange: handleScopeChange,
              }}
            />
          )}
        />
      )}

      {/* Empty state */}
      {stats && currentWidgets.length === 0 && !isEditing && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center justify-center py-20 text-center"
        >
          <LayoutDashboard className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="text-sm font-semibold text-on-surface-variant">Dashboard vide</p>
          <p className="text-xs text-muted-foreground mt-1 mb-5">
            Ajoutez des widgets un à un en mode édition, ou restaurez le tableau de bord par défaut.
          </p>
          <button
            type="button"
            onClick={() => {
              setResetting(true);
              applyTemplate()
                .catch(() => {})
                .finally(() => setResetting(false));
            }}
            disabled={resetting}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold shadow-sm shadow-primary/20 hover:shadow-md transition-all disabled:opacity-50"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${resetting ? 'animate-spin' : ''}`} />
            {resetting ? 'Restauration…' : 'Restaurer le tableau de bord par défaut'}
          </button>
        </motion.div>
      )}

      {/* Widget Picker */}
      <WidgetPicker
        open={showPicker}
        onClose={() => { setShowPicker(false); setIsDraggingFromPicker(false); }}
        onSelect={handleAddWidget}
        isDragging={isDraggingFromPicker}
        existingWidgets={currentWidgets.map((w) => w.widgetType)}
      />

      {/* Confirmation — suppression d'un tableau de bord */}
      <ConfirmDialog
        open={!!deleteConfirm}
        title="Supprimer le tableau de bord ?"
        message={`« ${deleteConfirm?.name || ''} » et tous ses widgets seront définitivement supprimés. Cette action est irréversible.`}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        danger
        loading={deleting}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteConfirm(null)}
      />

      {/* Confirmation — réinitialisation au modèle par défaut */}
      <ConfirmDialog
        open={resetConfirmOpen}
        title="Réinitialiser le tableau de bord ?"
        message={`Les widgets actuels de « ${activeDashboard?.name || ''} » seront remplacés par le tableau de bord par défaut.`}
        confirmLabel="Réinitialiser"
        cancelLabel="Annuler"
        danger
        loading={resetting}
        onConfirm={handleResetConfirm}
        onCancel={() => setResetConfirmOpen(false)}
      />
    </div>
  );
}
