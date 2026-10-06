const express = require('express');
const prisma = require('../prismaClient');
const { decideApproval } = require('../services/hierarchicalApproval');

// ── Validation hiérarchique — routes PUBLIQUES (sans authenticate) ───────────
// Accessibles via le lien envoyé par e-mail au supérieur hiérarchique, qui n'a
// aucun compte sur la plateforme. Sécurisées uniquement par le token opaque à
// usage unique (colonne TicketApproval.token, UUID non devinable).
// Montées dans app.js AVANT les routers /api qui appliquent authenticate.

const router = express.Router();

async function resolveRecord(token) {
  if (!token || typeof token !== 'string') return null;
  return prisma.ticketApproval.findUnique({
    where: { token },
    include: {
      ticket: {
        select: {
          id: true, title: true, content: true, status: true, priority: true,
          approvalStatus: true, createdAt: true,
          requester: { select: { fullName: true } },
        },
      },
    },
  });
}

// GET /api/approvals/:token — récapitulatif affiché par la page publique
router.get('/:token', async (req, res) => {
  try {
    const record = await resolveRecord(req.params.token);
    if (!record || !record.ticket) {
      return res.status(404).json({ error: 'Lien de validation introuvable' });
    }
    return res.json({
      token: record.token,
      status: record.status,
      managerEmail: record.managerEmail,
      cc: record.cc || [],
      decidedAt: record.decidedAt,
      decisionComment: record.decisionComment,
      ticket: {
        id: record.ticket.id,
        title: record.ticket.title,
        content: record.ticket.content,
        status: record.ticket.status,
        priority: record.ticket.priority,
        approvalStatus: record.ticket.approvalStatus,
        createdAt: record.ticket.createdAt,
        requesterName: record.ticket.requester?.fullName || null,
      },
    });
  } catch (err) {
    console.error('[approvals] get:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

async function handleDecision(req, res, decision) {
  try {
    const record = await resolveRecord(req.params.token);
    if (!record || !record.ticket) {
      return res.status(404).json({ error: 'Lien de validation introuvable' });
    }
    if (record.status !== 'PENDING') {
      // Lien déjà utilisé : on affiche l'état plutôt que d'écraser la décision.
      return res.status(409).json({
        error: 'Cette demande a déjà fait l\'objet d\'une décision.',
        status: record.status,
        decidedAt: record.decidedAt,
        decisionComment: record.decisionComment,
      });
    }
    const comment = typeof req.body?.comment === 'string' ? req.body.comment : '';
    const ticket = await decideApproval({ record, decision, comment, actorEmail: record.managerEmail });
    return res.json({
      status: decision,
      ticketId: ticket.id,
      ...(decision === 'REJECTED' ? { ticketStatus: ticket.status } : {}),
    });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error(`[approvals] ${decision}:`, err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

// POST /api/approvals/:token/approve — approuver la demande (commentaire facultatif)
router.post('/:token/approve', (req, res) => handleDecision(req, res, 'APPROVED'));

// POST /api/approvals/:token/reject — refuser (commentaire obligatoire)
router.post('/:token/reject', (req, res) => handleDecision(req, res, 'REJECTED'));

module.exports = router;
