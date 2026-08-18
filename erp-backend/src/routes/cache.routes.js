// Gestion du cache de réponses (voir services/cacheStore.js) :
//  - GET /api/cache/stats : statistiques (entrées, hits, taille approximative, détail 50 premières)
//  - POST /api/cache/clear : purge intégrale du cache
// Réservé au SUPERADMIN — la purge est non destructive (le cache se reconstruit au prochain GET).
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/permissions');
const cacheStore = require('../services/cacheStore');
const { auditLog } = require('../services/auditLogService');

const router = express.Router();
router.use(authenticate);
router.use(requireSuperAdmin);

router.get('/stats', (req, res) => {
  return res.json(cacheStore.getStats());
});

router.post('/clear', async (req, res) => {
  const removed = cacheStore.clear();
  auditLog('CACHE_CLEARED', {
    actor: req.user,
    targetType: 'Cache',
    targetId: null,
    targetLabel: 'Cache de réponses',
    metadata: { entriesRemoved: removed },
  }).catch(() => {});
  return res.json({ cleared: removed });
});

module.exports = router;