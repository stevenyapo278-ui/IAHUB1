const express = require('express');
const { authenticate } = require('../middleware/auth');
const { getAuditLogs, getAuditLogActors, getAuditLogsExport } = require('../services/auditLogService');
const { sendLogExport } = require('../services/logReportService');

const router = express.Router();
router.use(authenticate);

// L'audit système est réservé aux administrateurs
function requireAdmin(req, res) {
  if (!req.user || !['ADMIN', 'SUPERADMIN'].includes(req.user.role)) {
    res.status(403).json({ error: 'Accès réservé aux administrateurs' });
    return false;
  }
  return true;
}

// Acteurs distincts (les plus fréquents en premier) → liste déroulante du filtre « Acteur »
router.get('/actors', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json({ actors: await getAuditLogActors() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export CSV/XLSX des actions d'audit — mêmes filtres que la liste affichée
router.get('/export', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const logs = await getAuditLogsExport(req.query);
    await sendLogExport(res, {
      format: req.query.format,
      filenamePrefix: 'audit_systeme',
      data: logs,
      kind: 'audit',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = await getAuditLogs(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
