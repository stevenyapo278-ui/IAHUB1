const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { sendEmail } = require('../services/emailSender');

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
router.post('/:id/approve', requirePermission('emaildrafts.manage', ['ADMIN', 'TECHNICIAN']), [body('recipientEmail').optional().isEmail()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const id = Number(req.params.id);
  const { proposedContent, reviewNote, recipientEmail, ccRecipients } = req.body;

  const draft = await prisma.aiEmailDraft.findUnique({ where: { id } });
  if (!draft) return res.status(404).json({ error: 'Brouillon introuvable' });
  if (draft.status !== 'PENDING') return res.status(400).json({ error: 'Brouillon déjà traité' });

  const finalContent = proposedContent !== undefined ? proposedContent : draft.proposedContent;
  const finalRecipient = recipientEmail !== undefined ? recipientEmail : draft.recipientEmail;
  const finalCc = Array.isArray(ccRecipients) ? ccRecipients : draft.ccRecipients;

  try {
    await sendEmail({
      ticketId: draft.ticketId,
      to: finalRecipient,
      cc: finalCc,
      subject: draft.subject,
      bodyHtml: finalContent,
      saveAsMessage: true,
    });
  } catch (err) {
    return res.status(502).json({ error: `Envoi échoué : ${err.message}` });
  }

  const updated = await prisma.aiEmailDraft.update({
    where: { id },
    data: {
      status: 'APPROVED',
      proposedContent: finalContent,
      recipientEmail: finalRecipient,
      ccRecipients: finalCc,
      reviewedById: req.user.sub,
      reviewedAt: new Date(),
      reviewNote: reviewNote || null,
      sentAt: new Date(),
    },
  });

  return res.json(updated);
});

// Rejeter un brouillon
router.post('/:id/reject', requirePermission('emaildrafts.manage', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
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

// Restaure un brouillon rejeté en PENDING, pour pouvoir l'éditer et l'approuver à nouveau
// (ex: rejeté par erreur, ou contexte ayant changé depuis le rejet).
router.post('/:id/restore', requirePermission('emaildrafts.manage', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const id = Number(req.params.id);

  const draft = await prisma.aiEmailDraft.findUnique({ where: { id } });
  if (!draft) return res.status(404).json({ error: 'Brouillon introuvable' });
  if (draft.status !== 'REJECTED') return res.status(400).json({ error: 'Seul un brouillon rejeté peut être restauré' });

  const updated = await prisma.aiEmailDraft.update({
    where: { id },
    data: {
      status: 'PENDING',
      reviewedById: null,
      reviewedAt: null,
      reviewNote: null,
      sentAt: null,
    },
  });

  return res.json(updated);
});

module.exports = router;
