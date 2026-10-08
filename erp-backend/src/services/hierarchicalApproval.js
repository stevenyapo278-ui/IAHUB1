const prisma = require('../prismaClient');
const { sendEmail, buildEmailLayout, buildActionLink } = require('./emailSender');
const { getSystemSettings, resolveFrontendUrl } = require('./systemSettings');
const { logEvent } = require('./ticketEvent');
const { emitTicketUpdated } = require('../utils/socket');

// ── Validation hiérarchique conditionnelle des demandes ─────────────────────
// Déclenchée par une condition posée sur le formulaire (bloc « Validation
// supérieure » de l'éditeur). Le demandeur saisit l'e-mail de son supérieur
// (et les copies) dans deux champs injectés par FormRequest.jsx ; le supérieur
// reçoit un lien public (token opaque, page /approvals/:token) pour approuver
// ou refuser sans compte sur la plateforme.

// Clés de réponses injectées côté front quand la validation est active
const MANAGER_KEY = 'VALIDATION - E-MAIL DU SUPERIEUR HIERARCHIQUE';
const CC_KEY = 'VALIDATION - COPIE (CC)';

const PRIORITY_LABELS = { P1: 'Critique', P2: 'Haute', P3: 'Moyenne', P4: 'Basse' };

function stripHtml(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// E-mail de demande de validation au supérieur : récapitulatif de la demande +
// lien unique pour répondre. Les personnes en copie (saisies par le demandeur)
// sont mises en CC. Envoi best effort — un souci de boîte mail ne fait jamais
// échouer une soumission déjà enregistrée (le lien reste consultable via la DB).
async function sendManagerApprovalEmail({ ticket, approval, requesterName }) {
  const settings = await getSystemSettings();
  const frontendUrl = resolveFrontendUrl(settings);
  const decisionUrl = `${frontendUrl}/approvals/${approval.token}`;
  const subject = `[VALIDATION REQUISE] Ticket #${ticket.id} — ${ticket.title}`;
  const summary = stripHtml(ticket.content).slice(0, 600);
  const ccNote = approval.cc && approval.cc.length
    ? `<p style="color:#6b7280;font-size:12px;margin-top:16px">En copie : ${approval.cc.join(', ')}</p>` : '';
  const children = `
    <p>Bonjour,</p>
    <p><strong>${requesterName || 'Un demandeur'}</strong> a soumis une demande qui nécessite votre
    validation hiérarchique avant traitement&nbsp;:</p>
    <table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px">
      <tr><td style="padding:6px 10px;background:#f9fafb;border:1px solid #e5e7eb">Ticket</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb"><strong>#${ticket.id}</strong></td></tr>
      <tr><td style="padding:6px 10px;background:#f9fafb;border:1px solid #e5e7eb">Objet</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb">${ticket.title}</td></tr>
      <tr><td style="padding:6px 10px;background:#f9fafb;border:1px solid #e5e7eb">Priorité</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb">${PRIORITY_LABELS[ticket.priority] || ticket.priority}</td></tr>
    </table>
    <p style="color:#4b5563;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px">${summary}</p>
    ${buildActionLink(decisionUrl, 'Examiner la demande et répondre')}
    <p style="color:#6b7280;font-size:12px">En ouvrant ce lien, vous pourrez approuver ou refuser la
    demande et laisser un commentaire. Aucun compte n'est requis.</p>
    ${ccNote}
  `;
  const bodyHtml = buildEmailLayout({
    headerTitle: 'Validation hiérarchique requise',
    headerSubtitle: `Ticket #${ticket.id}`,
    children,
  });
  return sendEmail({ to: approval.managerEmail, cc: approval.cc || [], subject, bodyHtml, saveAsMessage: false });
}

// Décision prise depuis la page publique /approvals/:token.
// - APPROVED : même état que la validation du Centre de Validation ;
// - REJECTED : rejet + clôture (comme POST /tickets/:id/reject, commentaire obligatoire).
// Met à jour le ticket ET l'enregistrement TicketApproval, journalise, ajoute un
// suivi public visible par le demandeur, notifie le demandeur + les copiés.
async function decideApproval({ record, decision, comment, actorEmail }) {
  const approved = decision === 'APPROVED';
  const ticketId = record.ticketId;
  const commentText = String(comment || '').trim() || null;
  if (!approved && !commentText) {
    const err = new Error('Une raison de refus est obligatoire.');
    err.status = 400;
    throw err;
  }

  const ticket = await prisma.ticket.update({
    where: { id: ticketId },
    data: approved ? {
      approvalStatus: 'APPROVED',
      approvedById: null, // le supérieur est externe : pas d'utilisateur interne
      approvedAt: new Date(),
      approvalNote: commentText,
    } : {
      approvalStatus: 'REJECTED',
      status: 'CLOSED',
      closedAt: new Date(),
      closeSuggested: false,
      closeSuggestedAt: null,
      closeSuggestionConfidence: null,
      approvedById: null,
      approvedAt: new Date(),
      approvalNote: commentText,
    },
    include: { requester: { select: { email: true, fullName: true } } },
  });

  // Le SLA ne démarre qu'à l'approbation : échéances calculées depuis approvedAt
  // (et purgées en cas de refus, le ticket étant de toute façon clôturé).
  const { applySla } = require('./slaService');
  await applySla(ticket).catch((err) =>
    console.error(`[hierarchicalApproval] Calcul SLA du ticket ${ticketId} échoué:`, err.message)
  );

  await prisma.ticketApproval.update({
    where: { id: record.id },
    data: {
      status: decision,
      decidedAt: new Date(),
      decidedBy: actorEmail || record.managerEmail,
      decisionComment: commentText,
    },
  });

  await logEvent(ticketId, approved ? 'APPROVED' : 'REJECTED', actorEmail || record.managerEmail, {
    via: 'validation-hierarchique',
    ...(commentText ? { comment: commentText } : {}),
  }).catch(() => {});

  const followupContent = approved
    ? `✅ Validation hiérarchique accordée par ${actorEmail || record.managerEmail}${commentText ? ` : ${commentText}` : ''}`
    : `❌ Validation hiérarchique refusée par ${actorEmail || record.managerEmail} : ${commentText}`;
  await prisma.followup.create({
    data: { ticketId, authorId: null, source: 'system', content: followupContent },
  }).catch(() => {});

  emitTicketUpdated(ticket, { approvalStatus: decision });

  // Notification de la décision au demandeur (copie : supérieur + personnes en CC)
  const requesterEmail = ticket.requester?.email;
  if (requesterEmail) {
    const decisionLabel = approved ? 'validée' : 'refusée';
    const ccList = [record.managerEmail, ...(record.cc || [])]
      .filter((addr) => addr && addr.toLowerCase() !== requesterEmail.toLowerCase());
    const subject = `Votre demande est ${decisionLabel} — Ticket #${ticketId} ${ticket.title}`;
    const children = `
      <p>Bonjour,</p>
      <p>Votre demande <strong>#${ticketId} — ${ticket.title}</strong> a été
      <strong style="color:${approved ? '#16a34a' : '#dc2626'}">${decisionLabel}</strong>
      par votre supérieur hiérarchique (${actorEmail || record.managerEmail}).</p>
      ${commentText ? `<p style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px"><strong>Commentaire :</strong> ${commentText}</p>` : ''}
      <p style="color:#6b7280;font-size:12px">${approved
        ? 'Votre demande est maintenant prise en charge par nos équipes.'
        : 'Aucun traitement ne sera effectué ; vous pouvez corriger et resoumettre si besoin.'}</p>
    `;
    const bodyHtml = buildEmailLayout({
      headerTitle: approved ? 'Demande validée' : 'Demande refusée',
      headerSubtitle: `Ticket #${ticketId}`,
      children,
    });
    sendEmail({ to: requesterEmail, cc: ccList, subject, bodyHtml, saveAsMessage: false })
      .catch((err) => console.error(`[hierarchicalApproval] Échec email décision (ticket ${ticketId}):`, err.message));
  }

  return ticket;
}

module.exports = { MANAGER_KEY, CC_KEY, sendManagerApprovalEmail, decideApproval };
