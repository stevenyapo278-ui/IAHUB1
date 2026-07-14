const express = require('express');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(authenticate);
router.use(requirePermission('tickets.assign', ['ADMIN', 'TECHNICIAN', 'SUPERADMIN']));

// ── Journaliser une réassignation ────────────────────────────────────────
// Utilisé par le frontend quand un humain réassigne manuellement un ticket
router.post('/', async (req, res) => {
  const { ticketId, previousTechnicianId, newTechnicianId, reason, wasAutoAssigned } = req.body;

  if (!ticketId) return res.status(400).json({ error: 'ticketId requis' });

  try {
    const log = await prisma.reassignmentLog.create({
      data: {
        ticketId: Number(ticketId),
        previousTechnicianId: previousTechnicianId ? Number(previousTechnicianId) : null,
        newTechnicianId: newTechnicianId ? Number(newTechnicianId) : null,
        reason: reason || null,
        wasAutoAssigned: !!wasAutoAssigned,
        assignedByUserId: req.user.sub,
      },
    });
    return res.status(201).json(log);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Historique des réassignations d'un ticket ────────────────────────────
router.get('/ticket/:ticketId', async (req, res) => {
  const logs = await prisma.reassignmentLog.findMany({
    where: { ticketId: Number(req.params.ticketId) },
    orderBy: { createdAt: 'desc' },
  });
  return res.json(logs);
});

module.exports = router;
