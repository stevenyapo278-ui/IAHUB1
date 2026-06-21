const prisma = require('../prismaClient');
const { sendEmail } = require('./emailSender');

// Mots-clés reconnus dans une réponse email au mail de relance — volontairement larges
// (variantes FR/EN courtes), car l'humain tape vite depuis son téléphone, hors bureau.
const APPROVE_KEYWORDS = ["j'approuve", 'japprouve', 'approuve', 'approuvé', 'approve', 'ok'];
const REJECT_KEYWORDS = ['je rejette', 'rejette', 'rejeté', 'reject', 'rejected', 'non'];

function detectDecision(bodyText) {
  const normalized = bodyText.toLowerCase().trim();
  // Le mot-clé doit apparaître en tout début de réponse (avant la citation du message
  // précédent que les clients mail ajoutent automatiquement), sinon "approuve" pourrait
  // apparaître par hasard plus bas dans le texte cité du brouillon lui-même.
  const firstLine = normalized.split('\n')[0];
  if (REJECT_KEYWORDS.some((k) => firstLine.includes(k))) return 'REJECTED';
  if (APPROVE_KEYWORDS.some((k) => firstLine.includes(k))) return 'APPROVED';
  return null;
}

// Si le message entrant est une réponse à un email de relance de brouillon (in-reply-to
// correspondant à un EmailApprovalToken.reminderInternetMessageId), traite la décision de
// l'humain ("j'approuve"/"je rejette") et retourne true. Retourne false si ce n'est pas le cas
// (message normal, à traiter par le pipeline standard).
async function tryHandleReminderReply({ inReplyTo, bodyPreview }) {
  if (!inReplyTo) return false;

  const approvalToken = await prisma.emailApprovalToken.findUnique({
    where: { reminderInternetMessageId: inReplyTo },
    include: { draft: true },
  });
  if (!approvalToken) return false;

  if (approvalToken.usedAt || approvalToken.draft.status !== 'PENDING') {
    return true; // déjà traité (par le lien web ou une autre relance) — on ignore silencieusement cette réponse tardive
  }

  const decision = detectDecision(bodyPreview || '');
  if (!decision) {
    console.error(`[draftReplyApproval] Réponse à la relance du brouillon ${approvalToken.draftId} non comprise (ni "j'approuve" ni "je rejette" détecté en début de message)`);
    return true;
  }

  const { draft } = approvalToken;

  if (decision === 'APPROVED') {
    try {
      await sendEmail({
        ticketId: draft.ticketId,
        to: draft.recipientEmail,
        cc: draft.ccRecipients,
        subject: draft.subject,
        bodyHtml: draft.proposedContent,
        saveAsMessage: true,
      });
    } catch (err) {
      console.error(`[draftReplyApproval] Échec envoi après approbation par réponse email (brouillon ${draft.id}):`, err.message);
      return true;
    }
    await prisma.$transaction([
      prisma.aiEmailDraft.update({
        where: { id: draft.id },
        data: { status: 'APPROVED', reviewNote: 'Approuvé par réponse email (hors réseau local)', reviewedAt: new Date(), sentAt: new Date() },
      }),
      prisma.emailApprovalToken.update({ where: { id: approvalToken.id }, data: { usedAt: new Date() } }),
    ]);
  } else {
    await prisma.$transaction([
      prisma.aiEmailDraft.update({
        where: { id: draft.id },
        data: { status: 'REJECTED', reviewNote: 'Rejeté par réponse email (hors réseau local)', reviewedAt: new Date() },
      }),
      prisma.emailApprovalToken.update({ where: { id: approvalToken.id }, data: { usedAt: new Date() } }),
    ]);
  }

  return true;
}

module.exports = { tryHandleReminderReply, detectDecision };
