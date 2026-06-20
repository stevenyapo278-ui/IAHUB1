const prisma = require('../prismaClient');
const { graphFetch } = require('../utils/graphClient');

// Envoie un email via Microsoft Graph et l'enregistre dans TicketMessage
async function sendEmail({ ticketId, to, cc = [], subject, bodyHtml, inReplyTo = null, conversationId = null, saveAsMessage = true }) {
  const account = await prisma.emailAccount.findFirst({
    where: { provider: 'OUTLOOK', isActive: true, isDefault: true, refreshToken: { not: null } },
  });
  if (!account) throw new Error('Aucun compte Outlook configuré et connecté');

  const message = {
    subject,
    body: { contentType: 'HTML', content: bodyHtml },
    toRecipients: Array.isArray(to)
      ? to.map((addr) => ({ emailAddress: { address: addr } }))
      : [{ emailAddress: { address: to } }],
    ...(cc && cc.length > 0 ? { ccRecipients: cc.map((addr) => ({ emailAddress: { address: addr } })) } : {}),
  };

  // On crée le message comme brouillon puis on l'envoie (au lieu de /sendMail) pour récupérer son id
  // et son internetMessageId — nécessaires pour reconnaître la réponse du destinataire (In-Reply-To) plus tard.
  const draft = await graphFetch(account, '/me/messages', { method: 'POST', body: JSON.stringify(message) });
  await graphFetch(account, `/me/messages/${draft.id}/send`, { method: 'POST' });

  if (saveAsMessage && ticketId) {
    await prisma.ticketMessage.create({
      data: {
        ticketId,
        direction: 'OUTBOUND',
        sender: account.emailAddress,
        recipients: Array.isArray(to) ? to : [to],
        ccRecipients: cc || [],
        subject,
        body: bodyHtml.replace(/<[^>]+>/g, ' '),
        bodyHtml,
        outlookMessageId: draft.id,
        internetMessageId: draft.internetMessageId,
        inReplyTo,
        conversationId,
        timestamp: new Date(),
      },
    });

    const { logEvent } = require('./ticketEvent');
    await logEvent(ticketId, 'EMAIL_SENT', 'SYSTEM', { to, cc, subject });
  }

  return draft;
}

// Génère le HTML de l'accusé de réception (fonction pure, sans envoi)
function buildAcknowledgementHtml({ toName, glpiTicketId, originalSubject, estimatedDelay = '4 heures ouvrées' }) {
  return `
<p>Bonjour ${toName || ''},</p>
<p>Nous avons bien reçu votre demande de support et un ticket a été créé automatiquement.</p>
<table style="border-collapse:collapse;margin:16px 0">
  <tr><td style="padding:4px 12px 4px 0;color:#666">Numéro de ticket</td><td><strong>#${glpiTicketId}</strong></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666">Sujet</td><td>${originalSubject}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666">Délai estimé</td><td>${estimatedDelay}</td></tr>
</table>
<p>Notre équipe va analyser votre demande et vous contactera dans les meilleurs délais.</p>
<p>Vous pouvez répondre directement à cet email pour ajouter des informations à votre ticket.</p>
<p>Cordialement,<br>Support IT</p>
`.trim();
}

// Envoie un accusé de réception automatique lors de la création d'un nouveau ticket
async function sendAcknowledgement({ ticketId, glpiTicketId, toEmail, toName, originalSubject, estimatedDelay = '4 heures ouvrées' }) {
  // On garde le sujet original de l'utilisateur (juste préfixé du numéro de ticket), pour ne pas
  // casser le fil de conversation côté client mail et rester reconnaissable pour l'utilisateur.
  const subject = `[Ticket #${glpiTicketId}] ${originalSubject}`;
  const bodyHtml = buildAcknowledgementHtml({ toName, glpiTicketId, originalSubject, estimatedDelay });
  return sendEmail({ ticketId, to: toEmail, subject, bodyHtml, saveAsMessage: true });
}

// Envoie une relance automatique pour un ticket en attente de réponse utilisateur
async function sendReminder({ ticketId, glpiTicketId, toEmail, toName, subject, reminderNumber, isPreClose = false }) {
  const emailSubject = `[Ticket #${glpiTicketId}] ${subject}`;
  const bodyHtml = isPreClose
    ? `<p>Bonjour ${toName || ''},</p>
<p>Sans réponse de votre part dans les 5 prochains jours, votre ticket <strong>#${glpiTicketId}</strong> (${subject}) sera automatiquement clôturé.</p>
<p>Si le problème est résolu, vous n'avez rien à faire. Sinon, répondez à cet email.</p>
<p>Cordialement,<br>Support IT</p>`
    : `<p>Bonjour ${toName || ''},</p>
<p>Nous revenons vers vous concernant votre ticket <strong>#${glpiTicketId}</strong> : ${subject}.</p>
<p>Votre demande est toujours en attente. Pouvez-vous nous confirmer si le problème est résolu ou s'il persiste ?</p>
<p>Répondez simplement à cet email.<br>Cordialement,<br>Support IT</p>`;

  const { logEvent } = require('./ticketEvent');
  await logEvent(ticketId, 'REMINDER_SENT', 'SYSTEM', { reminderNumber, isPreClose });

  return sendEmail({ ticketId, to: toEmail, subject: emailSubject, bodyHtml, saveAsMessage: true });
}

// Génère le HTML de la notification "incident déjà connu" (fonction pure, sans envoi)
function buildKnownIncidentNotificationHtml({ toName, glpiTicketId, originalSubject, isMajor, impactedCount }) {
  const majorNote = isMajor
    ? `<p>⚠️ Cet incident a été promu en <strong>incident majeur</strong> (${impactedCount} sites impactés). Notre équipe est mobilisée en priorité.</p>`
    : '';
  return `
<p>Bonjour ${toName || ''},</p>
<p>Votre demande a bien été prise en compte.</p>
<p>Un incident déjà identifié est actuellement en cours d'investigation par nos équipes :</p>
<table style="border-collapse:collapse;margin:16px 0">
  <tr><td style="padding:4px 12px 4px 0;color:#666">Numéro de ticket</td><td><strong>#${glpiTicketId}</strong></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666">Sujet</td><td>${originalSubject}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666">Sites impactés</td><td>${impactedCount}</td></tr>
</table>
${majorNote}
<p>Votre site a été ajouté à la liste des sites impactés. Nous vous informerons dès que le service sera rétabli.</p>
<p>Cordialement,<br>Support IT</p>
`.trim();
}

// Envoie une notification "incident déjà connu" quand un site est rattaché à un incident existant
async function sendKnownIncidentNotification({ ticketId, glpiTicketId, toEmail, toName, originalSubject, isMajor, impactedCount }) {
  const subject = `[Ticket #${glpiTicketId}] ${originalSubject}`;
  const bodyHtml = buildKnownIncidentNotificationHtml({ toName, glpiTicketId, originalSubject, isMajor, impactedCount });
  return sendEmail({ ticketId, to: toEmail, subject, bodyHtml, saveAsMessage: true });
}

// Notifie tous les sites impactés lors de la résolution d'un incident majeur
async function notifyMajorIncidentResolved({ ticketId, glpiTicketId, ticketTitle, impactedSites }) {
  const subject = `[Ticket #${glpiTicketId}] ${ticketTitle}`;
  const bodyHtml = `
<p>Bonjour,</p>
<p>L'incident <strong>#${glpiTicketId} — ${ticketTitle}</strong> a été résolu.</p>
<p>Le service est maintenant rétabli. Merci de votre patience.</p>
<p>Cordialement,<br>Support IT</p>
`.trim();

  for (const site of impactedSites) {
    if (!site.includes('@')) continue; // ignorer les noms sans email
    try {
      await sendEmail({ ticketId, to: site, subject, bodyHtml, saveAsMessage: false });
    } catch {
      // ignorer les erreurs individuelles
    }
  }
}

module.exports = {
  sendEmail,
  sendAcknowledgement,
  sendReminder,
  sendKnownIncidentNotification,
  notifyMajorIncidentResolved,
  buildAcknowledgementHtml,
  buildKnownIncidentNotificationHtml,
};
