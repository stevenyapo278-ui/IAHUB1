const express = require('express');
const { authenticate } = require('../middleware/auth');
const { getAuditLogs, auditLog } = require('../services/auditLogService');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  if (!req.user || !['ADMIN', 'SUPERADMIN'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  }
  try {
    const result = await getAuditLogs(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
