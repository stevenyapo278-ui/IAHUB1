// Widget catalog for the customizable dashboard
// Each widget defines its type, display name, category, default grid size, and icon name

export const WIDGET_CATALOG = [
  // ── KPIs ──
  { type: 'kpi_open_tickets',    name: 'Tickets ouverts',        category: 'KPIs',   defaultW: 3, defaultH: 2, icon: 'Ticket',         description: 'Nombre de tickets ouverts' },
  { type: 'kpi_sla_breach',      name: 'SLA dépassés',           category: 'KPIs',   defaultW: 3, defaultH: 2, icon: 'AlertTriangle',  description: 'Tickets ayant dépassé le SLA' },
  { type: 'kpi_pending',         name: 'En attente',             category: 'KPIs',   defaultW: 3, defaultH: 2, icon: 'Clock',          description: 'Tickets en attente utilisateur' },
  { type: 'kpi_resolution_rate', name: 'Taux de résolution',     category: 'KPIs',   defaultW: 3, defaultH: 2, icon: 'CheckCircle2',   description: 'Pourcentage de tickets résolus' },
  { type: 'kpi_ai_processed',    name: 'Traités par IA',         category: 'KPIs',   defaultW: 3, defaultH: 2, icon: 'Sparkles',       description: 'Tickets traités automatiquement' },
  { type: 'kpi_total_tickets',   name: 'Total tickets',          category: 'KPIs',   defaultW: 3, defaultH: 2, icon: 'Ticket',         description: 'Nombre total de tickets' },

  // ── Charts ──
  { type: 'chart_tickets_trend',  name: 'Évolution tickets',     category: 'Graphiques', defaultW: 8, defaultH: 4, icon: 'TrendingUp',    description: 'Courbe créés vs résolus' },
  { type: 'chart_by_category',    name: 'Par catégorie',         category: 'Graphiques', defaultW: 4, defaultH: 4, icon: 'PieChart',      description: 'Répartition par catégorie' },
  { type: 'chart_by_priority',    name: 'Par priorité',          category: 'Graphiques', defaultW: 4, defaultH: 4, icon: 'BarChart3',     description: 'Répartition par priorité' },
  { type: 'chart_by_status',      name: 'Par statut',            category: 'Graphiques', defaultW: 4, defaultH: 4, icon: 'Layers',        description: 'Répartition par statut' },
  { type: 'chart_radar_teams',    name: 'Radar équipes',         category: 'Graphiques', defaultW: 5, defaultH: 4, icon: 'Radar',         description: 'Volume par équipe' },
  { type: 'chart_status_funnel',  name: 'Tunnel de traitement',  category: 'Graphiques', defaultW: 6, defaultH: 3, icon: 'ListChecks',    description: 'Entonnoir workflow' },
  { type: 'chart_area_stacked',   name: 'Aires empilées',        category: 'Graphiques', defaultW: 8, defaultH: 4, icon: 'TrendingUp',    description: 'Aires empilées multi-séries' },
  { type: 'chart_bar_grouped',    name: 'Barres groupées',       category: 'Graphiques', defaultW: 6, defaultH: 4, icon: 'BarChart3',     description: 'Barres groupées comparatives' },
  { type: 'chart_ticket_flow',    name: 'Créés vs résolus',      category: 'Graphiques', defaultW: 8, defaultH: 4, icon: 'BarChart3',     description: 'Barres groupées : créés vs résolus' },
  { type: 'chart_gauge',          name: 'Jauge',                 category: 'Graphiques', defaultW: 3, defaultH: 3, icon: 'Gauge',         description: 'Jauge circulaire' },
  { type: 'chart_donut',          name: 'Donut',                 category: 'Graphiques', defaultW: 4, defaultH: 4, icon: 'PieChart',      description: 'Donut avec légende' },
  { type: 'chart_heatmap',        name: 'Activité tickets',      category: 'Graphiques', defaultW: 8, defaultH: 4, icon: 'Grid3X3',       description: 'Heatmap jour × semaine' },

  // ── Tableaux / Listes ──
  { type: 'team_workload',        name: 'Équipe',                category: 'Tableaux',  defaultW: 6, defaultH: 4, icon: 'Users',         description: 'Charge par membre' },
  { type: 'tech_performance',     name: 'Performance techniciens', category: 'Tableaux', defaultW: 6, defaultH: 4, icon: 'Users',         description: 'Classement techniciens' },
  { type: 'recent_tickets',       name: 'Derniers tickets',       category: 'Tableaux', defaultW: 6, defaultH: 4, icon: 'Activity',      description: 'Activité récente' },
  { type: 'sla_status',           name: 'Statut SLA',             category: 'Tableaux', defaultW: 6, defaultH: 3, icon: 'Clock',         description: 'Tableau SLA par priorité' },

  // ── Données / Autres ──
  { type: 'team_breakdown',       name: 'Charge par équipe',      category: 'Données',  defaultW: 6, defaultH: 4, icon: 'Users',         description: 'Répartition par équipe' },
  { type: 'ai_pipeline',          name: 'Pipeline IA',            category: 'Données',  defaultW: 4, defaultH: 3, icon: 'Sparkles',      description: 'Stats traitement IA' },
  { type: 'quick_access',         name: 'Accès rapides',          category: 'Données',  defaultW: 3, defaultH: 2, icon: 'Zap',           description: 'Raccourcis modules' },
  { type: 'integrations_health',  name: 'Santé intégrations',     category: 'Données',  defaultW: 4, defaultH: 3, icon: 'ShieldCheck',   description: 'État des connecteurs' },
];

// Map type → component path (lazy loaded)
export const WIDGET_MAP = {
  kpi_open_tickets:    './widgets/KpiWidget',
  kpi_sla_breach:      './widgets/KpiWidget',
  kpi_pending:         './widgets/KpiWidget',
  kpi_resolution_rate: './widgets/KpiWidget',
  kpi_ai_processed:    './widgets/KpiWidget',
  kpi_total_tickets:   './widgets/KpiWidget',
  chart_tickets_trend: './widgets/AreaTrendWidget',
  chart_area_stacked:  './widgets/AreaTrendWidget',
  chart_by_category:   './widgets/PieWidget',
  chart_by_status:     './widgets/PieWidget',
  chart_donut:         './widgets/PieWidget',
  chart_by_priority:   './widgets/BarWidget',
  chart_bar_grouped:   './widgets/BarWidget',
  chart_radar_teams:   './widgets/RadarWidget',
  chart_status_funnel: './widgets/FunnelWidget',
  chart_ticket_flow:   './widgets/TicketFlowWidget',
  chart_gauge:         './widgets/GaugeWidget',
  chart_heatmap:       './widgets/HeatmapWidget',
  team_workload:       './widgets/TeamWorkloadWidget',
  tech_performance:    './widgets/TechTableWidget',
  recent_tickets:      './widgets/RecentTicketsWidget',
  sla_status:          './widgets/SlaStatusWidget',
  team_breakdown:      './widgets/TeamBreakdownWidget',
  ai_pipeline:         './widgets/AiPipelineWidget',
  quick_access:        './widgets/QuickAccessWidget',
  integrations_health: './widgets/IntegrationsWidget',
};

// Helper to get widget metadata by type
export function getWidgetMeta(type) {
  return WIDGET_CATALOG.find(w => w.type === type);
}

// Get unique categories
export function getWidgetCategories() {
  return [...new Set(WIDGET_CATALOG.map(w => w.category))];
}
