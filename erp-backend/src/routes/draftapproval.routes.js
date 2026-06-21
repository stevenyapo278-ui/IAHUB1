const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { sendEmail } = require('../services/emailSender');
const { getSystemSettings } = require('../services/systemSettings');

const router = express.Router();

// Routes PUBLIQUES (pas d'authenticate) : accessibles via le lien envoyé par email de relance,
// pour qu'un responsable hors du réseau local puisse agir sans se logger. Sécurisées uniquement
// par le token opaque à usage unique (cf. EmailApprovalToken), pas par une session.
async function resolveValidToken(token) {
  const approvalToken = await prisma.emailApprovalToken.findUnique({
    where: { token },
    include: { draft: { include: { ticket: { select: { id: true, title: true } } } } },
  });
  if (!approvalToken) return { error: 'Lien invalide.' };
  if (approvalToken.usedAt) return { error: 'Ce lien a déjà été utilisé.' };
  if (approvalToken.expiresAt < new Date()) return { error: 'Ce lien a expiré.' };
  if (approvalToken.draft.status !== 'PENDING') return { error: 'Ce brouillon a déjà été traité.' };
  return { approvalToken };
}

// Récupère le contenu du brouillon pour affichage/édition dans la page publique
router.get('/:token', async (req, res) => {
  const { approvalToken, error } = await resolveValidToken(req.params.token);
  if (error) return res.status(410).json({ error });

  const { draft } = approvalToken;
  // signatureLogoUrl est renvoyée uniquement pour permettre à cette page publique d'afficher
  // l'aperçu du logo (cid:logo-signature, résolu seulement dans l'email réellement envoyé, jamais
  // dans un navigateur) — aucune donnée sensible, juste l'URL publique du fichier image.
  const settings = await getSystemSettings();
  return res.json({
    id: draft.id,
    ticket: draft.ticket,
    recipientEmail: draft.recipientEmail,
    ccRecipients: draft.ccRecipients,
    subject: draft.subject,
    proposedContent: draft.proposedContent,
    createdAt: draft.createdAt,
    signatureLogoUrl: settings.signatureLogoUrl || null,
  });
});

// Approuve (avec contenu éventuellement modifié) et envoie immédiatement l'email
router.post('/:token/approve', [body('recipientEmail').optional().isEmail()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { approvalToken, error } = await resolveValidToken(req.params.token);
  if (error) return res.status(410).json({ error });

  const { draft } = approvalToken;
  const { proposedContent, recipientEmail, ccRecipients } = req.body;
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

  await prisma.$transaction([
    prisma.aiEmailDraft.update({
      where: { id: draft.id },
      data: {
        status: 'APPROVED',
        proposedContent: finalContent,
        recipientEmail: finalRecipient,
        ccRecipients: finalCc,
        reviewNote: 'Approuvé à distance par email (hors réseau local)',
        reviewedAt: new Date(),
        sentAt: new Date(),
      },
    }),
    prisma.emailApprovalToken.update({ where: { id: approvalToken.id }, data: { usedAt: new Date() } }),
  ]);

  return res.json({ ok: true });
});

// Rejette le brouillon
router.post('/:token/reject', async (req, res) => {
  const { approvalToken, error } = await resolveValidToken(req.params.token);
  if (error) return res.status(410).json({ error });

  const { draft } = approvalToken;
  const { reviewNote } = req.body;

  await prisma.$transaction([
    prisma.aiEmailDraft.update({
      where: { id: draft.id },
      data: {
        status: 'REJECTED',
        reviewedAt: new Date(),
        reviewNote: reviewNote ? `Rejeté à distance par email : ${reviewNote}` : 'Rejeté à distance par email (hors réseau local)',
      },
    }),
    prisma.emailApprovalToken.update({ where: { id: approvalToken.id }, data: { usedAt: new Date() } }),
  ]);

  return res.json({ ok: true });
});

module.exports = router;
