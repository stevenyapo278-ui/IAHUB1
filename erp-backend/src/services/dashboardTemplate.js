// Modèle de tableau de bord par défaut — utilisé à la création d'un dashboard
// et par le bouton « Réinitialiser ». Toutes les entrées correspondent à des
// types du catalogue frontend (erp-frontend/src/dashboard/widgetCatalog.js).

const prisma = require('../prismaClient');

/* Géométrie sur 12 colonnes (grille lg). La compaction verticale côté
   frontend repack de toute façon les éléments sans chevauchement. */
const DEFAULT_TEMPLATE = [
  // Rangée 1 — KPIs
  { widgetType: 'kpi_open_tickets',    x: 0, y: 0, w: 3, h: 2 },
  { widgetType: 'kpi_sla_breach',      x: 3, y: 0, w: 3, h: 2 },
  { widgetType: 'kpi_pending',         x: 6, y: 0, w: 3, h: 2 },
  { widgetType: 'kpi_resolution_rate', x: 9, y: 0, w: 3, h: 2 },

  // Rangée 2 — Tendance + catégories
  { widgetType: 'chart_tickets_trend', x: 0, y: 2, w: 8, h: 4 },
  { widgetType: 'chart_by_category',   x: 8, y: 2, w: 4, h: 4 },

  // Rangée 3 — Priorités + SLA + pipeline IA
  { widgetType: 'chart_by_priority',   x: 0, y: 6, w: 4, h: 4 },
  { widgetType: 'sla_status',          x: 4, y: 6, w: 4, h: 4 },
  { widgetType: 'ai_pipeline',         x: 8, y: 6, w: 4, h: 4 },

  // Rangée 4 — Équipes et techniciens
  { widgetType: 'tech_performance',    x: 0, y: 10, w: 6, h: 4 },
  { widgetType: 'team_breakdown',      x: 6, y: 10, w: 6, h: 4 },

  // Rangée 5 — Activité récente + intégrations
  { widgetType: 'recent_tickets',      x: 0, y: 14, w: 8, h: 4 },
  { widgetType: 'integrations_health', x: 8, y: 14, w: 4, h: 4 },
];

/**
 * Remplace tous les widgets d'un dashboard par le modèle par défaut
 * et retourne le layout correspondant (à persister sur dashboard.layout).
 * Les ids des widgets créés servent de clés de layout (`i`).
 */
async function applyDefaultTemplate(dashboardId) {
  return prisma.$transaction(async (tx) => {
    await tx.dashboardWidget.deleteMany({ where: { dashboardId } });

    const layout = [];
    let position = 0;
    for (const entry of DEFAULT_TEMPLATE) {
      const widget = await tx.dashboardWidget.create({
        data: { dashboardId, widgetType: entry.widgetType, position: position++ },
      });
      layout.push({ i: widget.id, x: entry.x, y: entry.y, w: entry.w, h: entry.h });
    }

    await tx.dashboard.update({ where: { id: dashboardId }, data: { layout } });
    return layout;
  });
}

module.exports = { DEFAULT_TEMPLATE, applyDefaultTemplate };
