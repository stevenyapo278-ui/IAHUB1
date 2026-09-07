const express = require('express');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const { applyDefaultTemplate } = require('../services/dashboardTemplate');

const router = express.Router();
router.use(authenticate);

// GET / — Lister les dashboards de l'utilisateur (avec _count de widgets)
router.get('/', async (req, res) => {
  const where = { userId: Number(req.user.sub) };
  if (req.query.default === 'true') where.isDefault = true;

  const dashboards = await prisma.dashboard.findMany({
    where,
    include: { widgets: { orderBy: { position: 'asc' } } },
    // Le tableau de bord principal (isDefault) d'abord, puis le plus récent
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });

  return res.json(dashboards);
});

// POST / — Créer un dashboard
router.post(
  '/',
  [body('name').notEmpty().trim()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, layout, isDefault } = req.body;
    const userId = Number(req.user.sub);

    // Si isDefault=true ou c'est le premier dashboard, désactiver les autres
    if (isDefault) {
      await prisma.dashboard.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    let dashboard = await prisma.dashboard.create({
      data: {
        name: name.trim(),
        userId,
        layout: layout ?? [],
        isDefault: isDefault ?? false,
      },
    });

    return res.status(201).json(dashboard);
  }
);

// GET /:id — Récupérer un dashboard avec ses widgets
router.get('/:id', async (req, res) => {
  const dashboard = await prisma.dashboard.findUnique({
    where: { id: req.params.id },
    include: { widgets: { orderBy: { position: 'asc' } } },
  });

  if (!dashboard) return res.status(404).json({ error: 'Dashboard non trouvé' });
  if (dashboard.userId !== Number(req.user.sub)) return res.status(403).json({ error: 'Accès refusé' });

  return res.json(dashboard);
});

// PATCH /:id — Mettre à jour un dashboard
router.patch('/:id', async (req, res) => {
  const dashboard = await prisma.dashboard.findUnique({ where: { id: req.params.id } });

  if (!dashboard) return res.status(404).json({ error: 'Dashboard non trouvé' });
  if (dashboard.userId !== Number(req.user.sub)) return res.status(403).json({ error: 'Accès refusé' });

  const { name, layout, isDefault } = req.body;
  const data = {};
  if (name !== undefined) data.name = name.trim();
  if (layout !== undefined) data.layout = layout;
  if (isDefault !== undefined) {
    data.isDefault = isDefault;
    if (isDefault) {
      await prisma.dashboard.updateMany({
        where: { userId: dashboard.userId, isDefault: true, id: { not: dashboard.id } },
        data: { isDefault: false },
      });
    }
  }

  const updated = await prisma.dashboard.update({ where: { id: dashboard.id }, data });
  return res.json(updated);
});

// DELETE /:id — Supprimer un dashboard (cascade widgets)
router.delete('/:id', async (req, res) => {
  const dashboard = await prisma.dashboard.findUnique({ where: { id: req.params.id } });

  if (!dashboard) return res.status(404).json({ error: 'Dashboard non trouvé' });
  if (dashboard.userId !== Number(req.user.sub)) return res.status(403).json({ error: 'Accès refusé' });

  await prisma.dashboard.delete({ where: { id: dashboard.id } });
  return res.status(204).end();
});

// POST /:id/reset — Réinitialiser le dashboard au modèle par défaut
// (supprime tous les widgets, recrée ceux du modèle, recale le layout)
router.post('/:id/reset', async (req, res) => {
  const dashboard = await prisma.dashboard.findUnique({ where: { id: req.params.id } });

  if (!dashboard) return res.status(404).json({ error: 'Dashboard non trouvé' });
  if (dashboard.userId !== Number(req.user.sub)) return res.status(403).json({ error: 'Accès refusé' });

  const layout = await applyDefaultTemplate(dashboard.id);
  const updated = await prisma.dashboard.findUnique({
    where: { id: dashboard.id },
    include: { widgets: { orderBy: { position: 'asc' } } },
  });

  return res.json({ ...updated, layout });
});
router.post(
  '/:id/widgets',
  [body('widgetType').notEmpty().trim()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const dashboard = await prisma.dashboard.findUnique({ where: { id: req.params.id } });

    if (!dashboard) return res.status(404).json({ error: 'Dashboard non trouvé' });
    if (dashboard.userId !== Number(req.user.sub)) return res.status(403).json({ error: 'Accès refusé' });

    const { widgetType, title, config, position } = req.body;

    // Position par défaut : après le dernier widget existant
    let finalPosition = position;
    if (finalPosition === undefined) {
      const lastWidget = await prisma.dashboardWidget.findFirst({
        where: { dashboardId: dashboard.id },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      finalPosition = (lastWidget?.position ?? -1) + 1;
    }

    const widget = await prisma.dashboardWidget.create({
      data: {
        dashboardId: dashboard.id,
        widgetType: widgetType.trim(),
        title: title ?? undefined,
        config: config ?? undefined,
        position: finalPosition,
      },
    });

    return res.status(201).json(widget);
  }
);

// PATCH /:id/widgets/:widgetId — Mettre à jour un widget
router.patch('/:id/widgets/:widgetId', async (req, res) => {
  const dashboard = await prisma.dashboard.findUnique({ where: { id: req.params.id } });

  if (!dashboard) return res.status(404).json({ error: 'Dashboard non trouvé' });
  if (dashboard.userId !== Number(req.user.sub)) return res.status(403).json({ error: 'Accès refusé' });

  const widget = await prisma.dashboardWidget.findFirst({
    where: { id: req.params.widgetId, dashboardId: dashboard.id },
  });

  if (!widget) return res.status(404).json({ error: 'Widget non trouvé' });

  const { title, config, position } = req.body;
  const data = {};
  if (title !== undefined) data.title = title;
  if (config !== undefined) data.config = config;
  if (position !== undefined) data.position = position;

  const updated = await prisma.dashboardWidget.update({ where: { id: widget.id }, data });
  return res.json(updated);
});

// DELETE /:id/widgets/:widgetId — Supprimer un widget
router.delete('/:id/widgets/:widgetId', async (req, res) => {
  const dashboard = await prisma.dashboard.findUnique({ where: { id: req.params.id } });

  if (!dashboard) return res.status(404).json({ error: 'Dashboard non trouvé' });
  if (dashboard.userId !== Number(req.user.sub)) return res.status(403).json({ error: 'Accès refusé' });

  const widget = await prisma.dashboardWidget.findFirst({
    where: { id: req.params.widgetId, dashboardId: dashboard.id },
  });

  if (!widget) return res.status(404).json({ error: 'Widget non trouvé' });

  await prisma.dashboardWidget.delete({ where: { id: widget.id } });
  return res.status(204).end();
});

// POST /:id/default — Définir comme dashboard par défaut
router.post('/:id/default', async (req, res) => {
  const dashboard = await prisma.dashboard.findUnique({ where: { id: req.params.id } });

  if (!dashboard) return res.status(404).json({ error: 'Dashboard non trouvé' });
  if (dashboard.userId !== Number(req.user.sub)) return res.status(403).json({ error: 'Accès refusé' });

  await prisma.dashboard.updateMany({
    where: { userId: dashboard.userId, isDefault: true },
    data: { isDefault: false },
  });

  const updated = await prisma.dashboard.update({
    where: { id: dashboard.id },
    data: { isDefault: true },
  });

  return res.json(updated);
});

module.exports = router;
