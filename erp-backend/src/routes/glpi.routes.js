const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { syncGlpiTickets, fullReimportFromGlpi } = require('../utils/glpiSync');

const router = express.Router();
router.use(authenticate);

// Liste les instances GLPI configurées
router.get('/instances', requirePermission('glpi.manage', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const configs = await prisma.apiConfig.findMany({
    where: { serviceName: { in: ['glpi', 'glpi_dev'] } },
    select: { serviceName: true, baseUrl: true, isActive: true, extra: true },
  });

  const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });

  res.json({
    instances: configs.map((c) => ({
      id: c.serviceName,
      label: c.serviceName === 'glpi' ? 'GLPI Production' : 'GLPI Développement',
      baseUrl: c.baseUrl,
      isActive: c.isActive,
      isConfigured: !!(c.baseUrl && c.extra?.appToken),
    })),
    activeInstance: settings?.activeGlpiInstance || 'glpi',
  });
});

// Sync standard (incrémental)
router.post('/sync', requirePermission('glpi.manage', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  try {
    const result = await syncGlpiTickets();
    if (!result) {
      return res.status(422).json({ error: 'GLPI non configuré ou inactif' });
    }
    return res.json(result);
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Erreur de synchronisation GLPI' });
  }
});

// Réimport complet depuis GLPI (supprime les tickets GLPI-syncés de l'ERP, puis réimporte)
// body.dateFrom : YYYY-MM-DD (optionnel)
// body.dateTo   : YYYY-MM-DD (optionnel)
router.post(
  '/reimport',
  requirePermission('glpi.manage', ['ADMIN', 'TECHNICIAN']),
  [
    body('dateFrom').optional({ nullable: true }).isISO8601().withMessage('Format YYYY-MM-DD requis'),
    body('dateTo').optional({ nullable: true }).isISO8601().withMessage('Format YYYY-MM-DD requis'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { dateFrom, dateTo } = req.body;
      const result = await fullReimportFromGlpi({ dateFrom, dateTo });
      if (!result) {
        return res.status(422).json({ error: 'GLPI non configuré ou inactif' });
      }
      return res.json(result);
    } catch (err) {
      return res.status(502).json({ error: err.message || 'Erreur de réimport GLPI' });
    }
  }
);

module.exports = router;
