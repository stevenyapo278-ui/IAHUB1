const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { syncGlpiTickets } = require('../utils/glpiSync');

const router = express.Router();
router.use(authenticate);

// Synchronise les tickets GLPI vers l'ERP (import/mise à jour par glpiTicketId)
router.post('/sync', authorize('ADMIN', 'TECHNICIAN'), async (req, res) => {
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

module.exports = router;
