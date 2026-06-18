const prisma = require('../prismaClient');
const { graphFetch } = require('../utils/graphClient');

// Envoie un email via Microsoft Graph et l'enregistre dans TicketMessage
async function sendEmail({ ticketId, to, subject, bodyHtml, inReplyTo = null, conversationId = null, saveAsMessage = true }) {
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
  };

  const result = await graphFetch(account, '/me/sendMail', {
    method: 'POST',
    body: JSON.stringify({ message, saveToSentItems: true }),
  });

  if (saveAsMessage && ticketId) {
    await prisma.ticketMessage.create({
      data: {
        ticketId,
        direction: 'OUTBOUND',
        sender: account.emailAddress,
        recipients: Array.isArray(to) ? to : [to],
        subject,
        body: bodyHtml.replace(/<[^>]+>/g, ' '),
        bodyHtml,
        inReplyTo,
        conversationId,
        timestamp: new Date(),
      },
    });

    const { logEvent } = require('./ticketEvent');
    await logEvent(ticketId, 'EMAIL_SENT', 'SYSTEM', { to, subject });
  }

  return result;
}

// Envoie un accusé de réception automatique lors de la création d'un nouveau ticket
async function sendAcknowledgement({ ticketId, glpiTicketId, toEmail, toName, originalSubject, estimatedDelay = '4 heures ouvrées' }) {
  const subject = `[Ticket #${glpiTicketId}] Votre demande a bien été reçue`;
  const bodyHtml = `
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

  return sendEmail({ ticketId, to: toEmail, subject, bodyHtml, saveAsMessage: true });
}

// Envoie une relance automatique pour un ticket en attente de réponse utilisateur
async function sendReminder({ ticketId, glpiTicketId, toEmail, toName, subject, reminderNumber, isPreClose = false }) {
  const emailSubject = `[Ticket #${glpiTicketId}] ${isPreClose ? 'Pré-clôture de votre demande' : 'Relance - Votre demande'}`;
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

// Envoie une notification "incident déjà connu" quand un site est rattaché à un incident existant
async function sendKnownIncidentNotification({ ticketId, glpiTicketId, toEmail, toName, originalSubject, isMajor, impactedCount }) {
  const subject = `[Ticket #${glpiTicketId}] Incident en cours de traitement`;
  const majorNote = isMajor
    ? `<p>⚠️ Cet incident a été promu en <strong>incident majeur</strong> (${impactedCount} sites impactés). Notre équipe est mobilisée en priorité.</p>`
    : '';
  const bodyHtml = `
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

  return sendEmail({ ticketId, to: toEmail, subject, bodyHtml, saveAsMessage: true });
}

// Notifie tous les sites impactés lors de la résolution d'un incident majeur
async function notifyMajorIncidentResolved({ ticketId, glpiTicketId, ticketTitle, impactedSites }) {
  const subject = `[Ticket #${glpiTicketId}] Incident résolu`;
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

module.exports = { sendEmail, sendAcknowledgement, sendReminder, sendKnownIncidentNotification, notifyMajorIncidentResolved };
