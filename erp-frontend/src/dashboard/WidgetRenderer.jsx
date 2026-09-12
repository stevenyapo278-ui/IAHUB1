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

function Skeleton() {
  return (
    <div className="animate-pulse rounded-xl bg-surface-container p-6 space-y-4">
      <div className="h-4 bg-surface-container-high rounded w-1/3" />
      <div className="h-8 bg-surface-container-high rounded w-1/2" />
      <div className="h-20 bg-surface-container-high rounded" />
    </div>
  );
}

function resolveWidget(widget, allData) {
  const { widgetType } = widget;
  const { stats, trend, activity, techPerformance, slaAnalytics, integrations, pendingApprovals, pendingAiDrafts, needsReview, heatmap, workloadByTeam } = allData;

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
      const totalTickets = stats?.totalTickets || 0;
      const resolvedTickets = stats?.resolvedTickets || stats?.closedTickets || 0;
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
      return <AiPipelineWidget pendingAiDrafts={pendingAiDrafts} needsReview={needsReview} pendingApprovals={pendingApprovals} stats={stats} config={widget.config} />;

    case 'quick_access':
      return <QuickAccessWidget config={widget.config} />;

    case 'integrations_health':
      return <IntegrationsWidget integrations={integrations} config={widget.config} />;

    default:
      return <div className="text-sm text-on-surface-variant p-4">Widget inconnu : {widgetType}</div>;
  }
}

export default function WidgetRenderer({ widget, allData }) {
  return (
    <Suspense fallback={<Skeleton />}>
      {resolveWidget(widget, allData)}
    </Suspense>
  );
}
