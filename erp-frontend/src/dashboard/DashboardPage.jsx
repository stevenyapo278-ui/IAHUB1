import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
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
  useTicketHeatmap,
} from './useDashboard';
import DashboardGrid from './DashboardGrid';
import DashboardToolbar from './DashboardToolbar';
import WidgetPicker from './WidgetPicker';
import WidgetRenderer from './WidgetRenderer';
import { getWidgetMeta } from './widgetCatalog';

const PERIOD_MAP = { '7d': 7, '30d': 30, '90d': 90, '180d': 180 };

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

function computeDefaultPosition(widgetType, existingLayout) {
  const meta = getWidgetMeta(widgetType);
  const w = meta?.defaultW || 4;
  const h = meta?.defaultH || 3;

  if (existingLayout.length === 0) {
    return { x: 0, y: 0, w, h };
  }

  const maxY = Math.max(...existingLayout.map((l) => l.y + l.h));
  return { x: 0, y: maxY, w, h };
}

export default function DashboardPage() {
  const [activeDashboardId, setActiveDashboardId] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
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
  const { stats, isLoading: isLoadingStats, error: errorStats } = useDashboardStats(days);
  const { trend, isLoading: isLoadingTrend, error: errorTrend } = useActivityTrend(days);
  const { activity } = useRecentActivity();
  const { techPerformance } = useTechnicianPerformance(days);
  const { slaAnalytics } = useSlaAnalytics(days);
  const { integrations } = useIntegrations();
  const { pendingApprovals } = usePendingApprovals();
  const { pendingAiDrafts } = usePendingAiDrafts();
  const { needsReview } = useNeedsReview();
  const { heatmap } = useTicketHeatmap(20);

  // Active dashboard data
  const activeDashboard = useMemo(
    () => dashboards.find((d) => d.id === activeDashboardId) || null,
    [dashboards, activeDashboardId],
  );
  const currentWidgets = activeDashboard?.widgets || [];
  const currentLayout = activeDashboard?.layout || [];

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

  // Add widget
  const handleAddWidget = useCallback(
    async (widgetType) => {
      if (!activeDashboardId) return;

      try {
        // 1. Créer le widget (source de vérité pour l'id généré)
        const { data: newWidget } = await api.post(`/dashboards/${activeDashboardId}/widgets`, {
          widgetType,
        });

        // 2. Position calculée contre le layout actuel + purge des entrées
        //    orphelines (widget supprimé dont le layout garde la trace)
        const liveLayout = currentLayout.filter((l) =>
          currentWidgets.some((w) => w.id === l.i),
        );
        const pos = computeDefaultPosition(widgetType, liveLayout);
        const layoutEntry = { i: newWidget.id, ...pos };

        await api.patch(`/dashboards/${activeDashboardId}`, {
          layout: [...liveLayout, layoutEntry],
        });

        mutateDashboards();
        setShowPicker(false);
      } catch {
        // silently fail
      }
    },
    [activeDashboardId, currentLayout, currentWidgets, mutateDashboards],
  );

  // Remove widget
  const handleRemoveWidget = useCallback(
    async (widgetId) => {
      if (!activeDashboardId) return;

      try {
        await api.delete(`/dashboards/${activeDashboardId}/widgets/${widgetId}`);

        // Purge l'entrée du layout + les entrées orphelines restantes
        const kept = currentWidgets.filter((w) => w.id !== widgetId);
        const keptIds = new Set(kept.map((w) => w.id));
        const newLayout = currentLayout.filter((l) => keptIds.has(l.i));
        await api.patch(`/dashboards/${activeDashboardId}`, { layout: newLayout });

        mutateDashboards();
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
        onReset={handleResetDashboard}
        resetting={resetting}
        activePeriod={activePeriod}
        onPeriodChange={setActivePeriod}
        onDownloadReport={handleDownloadReport}
        reportLoading={reportLoading}
      />

      {/* Loading state */}
      {(isLoadingStats || isLoadingTrend) && !stats && (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
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
          renderWidget={(widget) => (
            <WidgetRenderer
              widget={widget}
              allData={{
                stats,
                trend,
                activity,
                techPerformance,
                slaAnalytics,
                integrations,
                pendingApprovals,
                pendingAiDrafts,
                needsReview,
                heatmap,
                period: activePeriod,
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
        onClose={() => setShowPicker(false)}
        onSelect={handleAddWidget}
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
