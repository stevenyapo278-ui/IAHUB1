const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Vérifie le secret partagé utilisé par n8n pour créer des brouillons
function authenticateN8n(req, res, next) {
  const secret = req.headers['x-webhook-secret'];
  if (!secret || secret !== process.env.N8N_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Secret webhook invalide' });
  }
  next();
}

// Création d'un brouillon de réponse IA (appelé par n8n)
router.post(
  '/',
  authenticateN8n,
  [body('recipientEmail').isEmail(), body('subject').notEmpty(), body('proposedContent').notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { ticketId, recipientEmail, subject, proposedContent } = req.body;

    const draft = await prisma.aiEmailDraft.create({
      data: {
        ticketId: ticketId ? Number(ticketId) : null,
        recipientEmail,
        subject,
        proposedContent,
      },
    });

    return res.status(201).json(draft);
  }
);

router.use(authenticate);

// Liste des brouillons (filtrable par statut)
router.get('/', async (req, res) => {
  const where = {};
  if (req.query.status) where.status = req.query.status;

  const drafts = await prisma.aiEmailDraft.findMany({
    where,
    include: {
      ticket: { select: { id: true, title: true } },
      reviewedBy: { select: { id: true, fullName: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return res.json(drafts);
});

// Approuver un brouillon : déclenche l'envoi via n8n
router.post('/:id/approve', authorize('ADMIN', 'TECHNICIAN'), async (req, res) => {
  const id = Number(req.params.id);
  const { proposedContent, reviewNote } = req.body;

  const draft = await prisma.aiEmailDraft.findUnique({ where: { id } });
  if (!draft) return res.status(404).json({ error: 'Brouillon introuvable' });
  if (draft.status !== 'PENDING') return res.status(400).json({ error: 'Brouillon déjà traité' });

  const finalContent = proposedContent !== undefined ? proposedContent : draft.proposedContent;

  const sendWebhookUrl = process.env.N8N_SEND_EMAIL_WEBHOOK_URL;
  if (sendWebhookUrl) {
    try {
      await fetch(sendWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftId: draft.id,
          ticketId: draft.ticketId,
          recipientEmail: draft.recipientEmail,
          subject: draft.subject,
          content: finalContent,
        }),
      });
    } catch (err) {
      return res.status(502).json({ error: 'Impossible de joindre le workflow n8n d\'envoi' });
    }
  }

  const updated = await prisma.aiEmailDraft.update({
    where: { id },
    data: {
      status: 'APPROVED',
      proposedContent: finalContent,
      reviewedById: req.user.sub,
      reviewedAt: new Date(),
      reviewNote: reviewNote || null,
      sentAt: sendWebhookUrl ? new Date() : null,
    },
  });

  return res.json(updated);
});

// Rejeter un brouillon
router.post('/:id/reject', authorize('ADMIN', 'TECHNICIAN'), async (req, res) => {
  const id = Number(req.params.id);
  const { reviewNote } = req.body;

  const draft = await prisma.aiEmailDraft.findUnique({ where: { id } });
  if (!draft) return res.status(404).json({ error: 'Brouillon introuvable' });
  if (draft.status !== 'PENDING') return res.status(400).json({ error: 'Brouillon déjà traité' });

  const updated = await prisma.aiEmailDraft.update({
    where: { id },
    data: {
      status: 'REJECTED',
      reviewedById: req.user.sub,
      reviewedAt: new Date(),
      reviewNote: reviewNote || null,
    },
  });

  return res.json(updated);
});

module.exports = router;
