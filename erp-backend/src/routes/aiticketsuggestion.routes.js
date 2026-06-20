const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();

// Vérifie le secret partagé utilisé par n8n pour créer des suggestions
function authenticateN8n(req, res, next) {
  const secret = req.headers['x-webhook-secret'];
  if (!secret || secret !== process.env.N8N_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Secret webhook invalide' });
  }
  next();
}

// Création d'une suggestion d'action IA pour un ticket (appelé par n8n)
router.post(
  '/',
  authenticateN8n,
  [body('ticketId').isInt(), body('suggestion').notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { ticketId, suggestion, reason } = req.body;

    const ticket = await prisma.ticket.findUnique({ where: { id: Number(ticketId) } });
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

    const created = await prisma.aiTicketSuggestion.create({
      data: { ticketId: Number(ticketId), suggestion, reason: reason || null },
    });

    return res.status(201).json(created);
  }
);

router.use(authenticate);

// Supprimer une suggestion (technicien l'a traitée/ignorée)
router.delete('/:id', requirePermission('tickets.assign', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  try {
    await prisma.aiTicketSuggestion.delete({ where: { id: Number(req.params.id) } });
    return res.status(204).send();
  } catch (err) {
    return res.status(404).json({ error: 'Suggestion introuvable' });
  }
});

module.exports = router;
