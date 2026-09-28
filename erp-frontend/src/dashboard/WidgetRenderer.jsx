import { Suspense } from 'react';

import KpiWidget from './widgets/KpiWidget';
import AreaTrendWidget from './widgets/AreaTrendWidget';
import PieWidget from './widgets/PieWidget';
import BarWidget from './widgets/BarWidget';
import RadarWidget from './widgets/RadarWidget';
import TicketFlowWidget from './widgets/TicketFlowWidget';
import FunnelWidget from './widgets/FunnelWidget';
import GaugeWidget from './widgets/GaugeWidget';
import HeatmapWidget from './widgets/HeatmapWidget';
import TeamWorkloadWidget from './widgets/TeamWorkloadWidget';
import TechTableWidget from './widgets/TechTableWidget';
import RecentTicketsWidget from './widgets/RecentTicketsWidget';
import SlaStatusWidget from './widgets/SlaStatusWidget';
import TeamBreakdownWidget from './widgets/TeamBreakdownWidget';
import WorkloadTeamsWidget from './widgets/WorkloadTeamsWidget';
import AiPipelineWidget from './widgets/AiPipelineWidget';
import QuickAccessWidget from './widgets/QuickAccessWidget';
import IntegrationsWidget from './widgets/IntegrationsWidget';
import { getWidgetMeta, SCOPE_SELECTABLE } from './widgetCatalog';

// Périmètres disponibles — le choix est persisté dans widget.config.scope
const SCOPES = [
  { key: 'all', label: 'Tous' },
  { key: 'open', label: 'Ouverts' },
  { key: 'closed', label: 'Fermés' },
];

function Skeleton() {
  return (
    <div className="animate-pulse rounded-xl bg-surface-container p-6 space-y-4">
      <div className="h-4 bg-surface-container-high rounded w-1/3" />
      <div className="h-8 bg-surface-container-high rounded w-1/2" />
      <div className="h-20 bg-surface-container-high rounded" />
    </div>
  );
}

/* Sous-titre de précision : ce que le chiffre mesure réellement. */
function subtitleFor(widgetType, periodLabel, scope) {
  const p = periodLabel || 'toutes périodes';
  switch (widgetType) {
    case 'kpi_open_tickets':
      return `Statuts ouverts · ${p}`;
    case 'kpi_total_tickets':
      return `Tous statuts actifs · ${p}`;
    case 'kpi_resolution_rate':
      return `Résolus + fermés ÷ total · ${p}`;
    case 'kpi_pending':
      return `Statut « en attente » · ${p}`;
    case 'kpi_ai_processed':
      return `Tickets marqués traités par l'IA · ${p}`;
    case 'kpi_sla_breach':
      return `SLA de résolution dépassé · ${p}`;
    case 'chart_tickets_trend':
    case 'chart_area_stacked':
    case 'chart_ticket_flow':
      return `Créés vs résolus · ${p}`;
    case 'chart_gauge':
      return `Résolus + fermés ÷ total · ${p}`;
    case 'chart_heatmap':
      return 'Tickets créés · 20 semaines glissantes';
    case 'chart_workload_teams':
      return 'Statuts ouverts · toutes périodes';
    case 'team_workload':
    case 'tech_performance':
      return `Performance des techniciens · ${p}`;
    case 'recent_tickets':
      return 'Derniers tickets mis à jour';
    case 'sla_status':
      return `Pilotage SLA · ${p}`;
    case 'ai_pipeline':
      return 'Brouillons IA, validations et revues humaines';
    case 'quick_access':
      return 'Raccourcis vers les modules';
    case 'integrations_health':
      return 'État des connecteurs';
    default: {
      const scopeLabel = scope === 'open'
        ? 'Tickets ouverts'
        : scope === 'closed'
          ? 'Tickets fermés'
          : 'Tous les statuts';
      return `${scopeLabel} · ${p}`;
    }
  }
}

function ScopeChips({ value, onChange }) {
  return (
    <div className="flex shrink-0 rounded-lg border border-outline-variant/40 overflow-hidden">
      {SCOPES.map((s) => (
        <button
          key={s.key}
          type="button"
          title={`Périmètre : ${s.label}`}
          onClick={() => onChange(s.key)}
          className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide transition-colors ${
            value === s.key
              ? 'bg-primary text-on-primary'
              : 'bg-surface-container text-muted-foreground hover:bg-surface-container-high'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

function resolveWidget(widget, allData) {
  const { widgetType } = widget;
  const { stats, trend, activity, techPerformance, slaAnalytics, integrations, pendingApprovals, pendingAiDrafts, needsReview, replySuggestions, heatmap, workloadByTeam } = allData;

  switch (widgetType) {
    case 'kpi_open_tickets':
    case 'kpi_sla_breach':
    case 'kpi_pending':
    case 'kpi_resolution_rate':
    case 'kpi_ai_processed':
    case 'kpi_total_tickets':
      return <KpiWidget type={widgetType} stats={stats} slaAnalytics={slaAnalytics} pendingApprovals={pendingApprovals} config={widget.config} />;

    case 'chart_tickets_trend':
    case 'chart_area_stacked':
      return <AreaTrendWidget trendData={trend} config={widget.config} />;

    case 'chart_by_category':
      return <PieWidget stats={stats} type="chart_by_category" config={widget.config} />;

    case 'chart_by_status':
    case 'chart_donut':
      return <PieWidget stats={stats} type={widgetType} config={widget.config} />;

    case 'chart_by_priority':
      return <BarWidget stats={stats} type="chart_by_priority" config={widget.config} />;

    case 'chart_bar_grouped':
      return <BarWidget stats={stats} type="chart_bar_grouped" config={widget.config} />;

    case 'chart_ticket_flow':
      return <TicketFlowWidget trendData={trend} config={widget.config} />;

    case 'chart_radar_teams':
      return <RadarWidget stats={stats} config={widget.config} />;

    case 'chart_status_funnel':
      return <FunnelWidget stats={stats} config={widget.config} />;

    case 'chart_gauge': {
      // /dashboard/stats renvoie `total` et `resolved` (les anciens champs
      // totalTickets/resolvedTickets n'ont jamais existé → jauge toujours à 0)
      const totalTickets = stats?.total || 0;
      const resolvedTickets = stats?.resolved || 0;
      const resolutionRate = totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 0;
      return <GaugeWidget value={resolutionRate} label="Résolution" config={widget.config} />;
    }

    case 'chart_heatmap':
      return <HeatmapWidget heatmap={heatmap} config={widget.config} />;

    case 'chart_workload_teams':
      return <WorkloadTeamsWidget workloadByTeam={workloadByTeam} config={widget.config} />;

    case 'team_workload':
      return <TeamWorkloadWidget techPerformance={techPerformance} config={widget.config} />;

    case 'tech_performance':
      return <TechTableWidget techPerformance={techPerformance} config={widget.config} />;

    case 'recent_tickets':
      return <RecentTicketsWidget activity={activity} config={widget.config} />;

    case 'sla_status':
      return <SlaStatusWidget slaAnalytics={slaAnalytics} config={widget.config} />;

    case 'team_breakdown':
      return <TeamBreakdownWidget stats={stats} config={widget.config} />;

    case 'ai_pipeline':
      return <AiPipelineWidget pendingAiDrafts={pendingAiDrafts} needsReview={needsReview} pendingApprovals={pendingApprovals} replySuggestions={replySuggestions} stats={stats} config={widget.config} />;

    case 'quick_access':
      return <QuickAccessWidget config={widget.config} />;

    case 'integrations_health':
      return <IntegrationsWidget integrations={integrations} config={widget.config} />;

    default:
      return <div className="text-sm text-on-surface-variant p-4">Widget inconnu : {widgetType}</div>;
  }
}

export default function WidgetRenderer({ widget, allData }) {
  const widgetType = widget.widgetType;
  const canSelectScope = SCOPE_SELECTABLE.has(widgetType);
  // Hors widgets à sélecteur, le périmètre affiché ET appliqué reste 'all'
  const scope = canSelectScope ? (widget.config?.scope || 'all') : 'all';
  const title = widget.title || getWidgetMeta(widgetType)?.name || widgetType;
  const subtitle = subtitleFor(widgetType, allData.periodLabel, scope);

  // Données du périmètre sélectionné (les KPI et les répartitions « statuts »
  // restent toujours sur 'all')
  const scopedStats =
    scope === 'open' ? allData.statsOpen
      : scope === 'closed' ? allData.statsClosed
        : allData.stats;
  const waiting = canSelectScope && scope !== 'all' && !scopedStats;

  const scopedAllData = scopedStats && scopedStats !== allData.stats
    ? { ...allData, stats: scopedStats }
    : allData;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header de précision : titre + périmètre réel du chiffre affiché */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground truncate" title={title}>
            {title}
          </p>
          <p className="text-[10px] text-muted-foreground/70 truncate" title={subtitle}>
            {subtitle}
          </p>
        </div>
        {canSelectScope && (
          <ScopeChips value={scope} onChange={(s) => allData.onScopeChange?.(widget, s)} />
        )}
      </div>

      {waiting ? (
        <Skeleton />
      ) : (
        <div className="flex-1 min-h-0">
          <Suspense fallback={<Skeleton />}>
            {resolveWidget(widget, scopedAllData)}
          </Suspense>
        </div>
      )}
    </div>
  );
}
