const crypto = require('crypto');
const prisma = require('../prismaClient');
const { sendDraftPendingReminderEmail } = require('./emailSender');
const { getSystemSettings } = require('./systemSettings');

const APPROVAL_TOKEN_TTL_HOURS = 24; // au-delà, le lien d'approbation à distance expire et redevient inutilisable

function minutesSince(date) {
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60));
}

// Crée un token d'approbation à distance à usage unique pour un brouillon — un token distinct
// par destinataire de relance, pour pouvoir tracer/invalider indépendamment l'un de l'autre.
async function createApprovalToken(draftId) {
  const token = crypto.randomBytes(32).toString('hex');
  const created = await prisma.emailApprovalToken.create({
    data: { token, draftId, expiresAt: new Date(Date.now() + APPROVAL_TOKEN_TTL_HOURS * 60 * 60 * 1000) },
  });
  return { id: created.id, token };
}

// Parcourt les AiEmailDraft toujours PENDING et envoie une relance email aux utilisateurs
// ADMIN/TECHNICIAN ayant activé receiveDraftAlerts, dès que le délai configuré est dépassé
// depuis la création (ou depuis la dernière relance, pour ne pas spammer en boucle).
async function runDraftReminderScheduler() {
  const settings = await getSystemSettings();
  if (!settings.draftReminderEnabled) return [];

  const delayMinutes = settings.draftReminderDelayMinutes;
  if (!delayMinutes || delayMinutes <= 0) return [];

  const drafts = await prisma.aiEmailDraft.findMany({ where: { status: 'PENDING' } });
  if (drafts.length === 0) return [];

  const recipients = await prisma.user.findMany({
    where: { isActive: true, receiveDraftAlerts: true, role: { in: ['ADMIN', 'TECHNICIAN'] } },
    select: { email: true, fullName: true },
  });

  const results = [];
  for (const draft of drafts) {
    const since = minutesSince(draft.lastReminderAt || draft.createdAt);
    if (since < delayMinutes) continue;

    const minutesWaiting = minutesSince(draft.createdAt);
    let sentCount = 0;
    for (const recipient of recipients) {
      try {
        const { id: approvalTokenId, token: approvalToken } = await createApprovalToken(draft.id);
        const sentMessage = await sendDraftPendingReminderEmail({
          recipientEmail: recipient.email,
          recipientName: recipient.fullName,
          draftId: draft.id,
          draftSubject: draft.subject,
          draftRecipientEmail: draft.recipientEmail,
          draftContent: draft.proposedContent,
          minutesWaiting,
          approvalToken,
        });
        // Enregistre l'internetMessageId de CET envoi de relance pour reconnaître la réponse du
        // responsable ("j'approuve"/"je rejette") via in-reply-to, s'il répond par email au lieu
        // de cliquer le lien (cas où il est hors réseau local sans accès au lien web).
        if (sentMessage?.internetMessageId) {
          await prisma.emailApprovalToken.update({
            where: { id: approvalTokenId },
            data: { reminderInternetMessageId: sentMessage.internetMessageId },
          }).catch(() => {});
        }
        sentCount++;
      } catch (err) {
        console.error(`[draftReminderScheduler] Échec envoi relance à ${recipient.email} (brouillon ${draft.id}):`, err.message);
      }
    }

    await prisma.aiEmailDraft.update({
      where: { id: draft.id },
      data: { reminderCount: { increment: 1 }, lastReminderAt: new Date() },
    });
    results.push({ draftId: draft.id, recipientsNotified: sentCount });
  }
  return results;
}

module.exports = { runDraftReminderScheduler };
