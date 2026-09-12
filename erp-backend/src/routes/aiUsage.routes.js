const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { getAiUsageStats } = require('../services/aiUsageTracker');

// GET /api/system/ai-usage — Statistiques de consommation IA
router.get('/', authenticate, requirePermission('automation.manage', ['ADMIN', 'SUPERADMIN']), async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 7;
    const stats = await getAiUsageStats(Math.min(days, 90));
    return res.json(stats);
  } catch (err) {
    console.error('[aiUsage.routes] Erreur stats IA:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la récupération des statistiques IA' });
  }
});

module.exports = router;
