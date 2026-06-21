const fs = require('fs');
const path = require('path');
const prisma = require('../prismaClient');
const { graphFetch } = require('../utils/graphClient');
const { getSystemSettings } = require('./systemSettings');

const LOGO_CONTENT_ID = 'logo-signature';

// Le logo de signature est référencé en cid: dans le HTML (voir getEmailSignature) plutôt que par
// une URL http(s) — les destinataires Outlook/M365 peuvent être hors du réseau local et n'auraient
// alors aucun moyen de charger une image hébergée sur le serveur ERP. L'image est donc lue depuis
// le disque local et jointe en pièce jointe inline à l'envoi, ce qui fonctionne sans dépendance réseau.
function getLogoAttachmentIfReferenced(bodyHtml, signatureLogoUrl) {
  if (!signatureLogoUrl || !bodyHtml.includes(`cid:${LOGO_CONTENT_ID}`)) return null;
  try {
    // signatureLogoUrl est de la forme {BACKEND_URL}/uploads/signature-logo/<fichier> (voir systemsettings.routes.js)
    const filename = signatureLogoUrl.split('/uploads/signature-logo/')[1];
    if (!filename) return null;
    const filePath = path.join('uploads', 'signature-logo', filename);
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filename).slice(1).toLowerCase();
    const mimeType = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' }[ext] || 'image/png';
    return {
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: filename,
      contentType: mimeType,
      contentBytes: buffer.toString('base64'),
      isInline: true,
      contentId: LOGO_CONTENT_ID,
    };
  } catch {
    return null; // fichier introuvable (ex: supprimé manuellement) : on envoie sans logo plutôt que d'échouer l'email
  }
}

// Envoie un email via Microsoft Graph et l'enregistre dans TicketMessage.
// inReplyToGraphMessageId (id Outlook du dernier message reçu, cf. TicketMessage.outlookMessageId) :
// si fourni, on répond via /createReply au lieu de créer un message de zéro — sans ça, Outlook
// affiche la réponse comme un email totalement séparé du fil de conversation de l'utilisateur,
// au lieu de s'enchaîner avec "RE:" au même endroit que les échanges précédents.
async function sendEmail({ ticketId, to, cc = [], subject, bodyHtml, inReplyTo = null, conversationId = null, inReplyToGraphMessageId = null, saveAsMessage = true }) {
  const account = await prisma.emailAccount.findFirst({
    where: { provider: 'OUTLOOK', isActive: true, isDefault: true, refreshToken: { not: null } },
  });
  if (!account) throw new Error('Aucun compte Outlook configuré et connecté');

  const settings = await getSystemSettings();
  const logoAttachment = getLogoAttachmentIfReferenced(bodyHtml, settings.signatureLogoUrl);

  const toRecipients = Array.isArray(to)
    ? to.map((addr) => ({ emailAddress: { address: addr } }))
    : [{ emailAddress: { address: to } }];
  const ccRecipientsPayload = cc && cc.length > 0 ? cc.map((addr) => ({ emailAddress: { address: addr } })) : [];

  let draft;
  if (inReplyToGraphMessageId) {
    draft = await graphFetch(account, `/me/messages/${inReplyToGraphMessageId}/createReply`, { method: 'POST', body: JSON.stringify({}) });
    await graphFetch(account, `/me/messages/${draft.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        subject,
        body: { contentType: 'HTML', content: bodyHtml },
        toRecipients,
        ccRecipients: ccRecipientsPayload,
        ...(logoAttachment ? { attachments: [logoAttachment] } : {}),
      }),
    });
  } else {
    const message = {
      subject,
      body: { contentType: 'HTML', content: bodyHtml },
      toRecipients,
      ...(ccRecipientsPayload.length > 0 ? { ccRecipients: ccRecipientsPayload } : {}),
      ...(logoAttachment ? { attachments: [logoAttachment] } : {}),
    };
    // On crée le message comme brouillon puis on l'envoie (au lieu de /sendMail) pour récupérer son id
    // et son internetMessageId — nécessaires pour reconnaître la réponse du destinataire (In-Reply-To) plus tard.
    draft = await graphFetch(account, '/me/messages', { method: 'POST', body: JSON.stringify(message) });
  }
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

const DEFAULT_ACKNOWLEDGEMENT_MESSAGE = 'Nous avons bien reçu votre demande de support et un ticket a été créé automatiquement.';
const DEFAULT_EMAIL_SIGNATURE = '<p>Cordialement,<br>Support IT</p>';

// Récupère la signature configurée (Paramètres > Automatisation), avec le logo uploadé ajouté
// dessous s'il existe, et l'espace toujours du corps du message via une marge dédiée.
async function getEmailSignature() {
  const settings = await getSystemSettings();
  const base = settings.emailSignature || DEFAULT_EMAIL_SIGNATURE;
  const logoHtml = settings.signatureLogoUrl
    ? `<p style="margin-top:8px"><img src="cid:${LOGO_CONTENT_ID}" alt="Logo" style="height:${settings.signatureLogoHeight || 60}px"></p>`
    : '';
  return `<div style="margin-top:24px">${base}${logoHtml}</div>`;
}

// Génère le HTML de l'accusé de réception (fonction pure, sans envoi).
// `customMessage` vient de SystemSettings.acknowledgementMessage (Paramètres > Automatisation > Emails) ;
// placeholders supportés : {ticketId}, {subject}, {toName}.
function buildAcknowledgementHtml({ toName, glpiTicketId, originalSubject, customMessage, signature }) {
  const introMessage = (customMessage || DEFAULT_ACKNOWLEDGEMENT_MESSAGE)
    .replaceAll('{ticketId}', glpiTicketId)
    .replaceAll('{subject}', originalSubject)
    .replaceAll('{toName}', toName || '');
  return `
<p>Bonjour ${toName || ''},</p>
<p>${introMessage}</p>
<table style="border-collapse:collapse;margin:16px 0">
  <tr><td style="padding:4px 12px 4px 0;color:#666">Numéro de ticket</td><td><strong>#${glpiTicketId}</strong></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666">Sujet</td><td>${originalSubject}</td></tr>
</table>
<p>Notre équipe va analyser votre demande et vous contactera dans les meilleurs délais.</p>
<p>Vous pouvez répondre directement à cet email pour ajouter des informations à votre ticket.</p>
${signature || DEFAULT_EMAIL_SIGNATURE}
`.trim();
}

// Envoie un accusé de réception automatique lors de la création d'un nouveau ticket
async function sendAcknowledgement({ ticketId, glpiTicketId, toEmail, toName, originalSubject }) {
  // On garde le sujet original de l'utilisateur (juste préfixé du numéro de ticket), pour ne pas
  // casser le fil de conversation côté client mail et rester reconnaissable pour l'utilisateur.
  const subject = `[Ticket #${glpiTicketId}] ${originalSubject}`;
  const settings = await getSystemSettings();
  const signature = await getEmailSignature();
  const bodyHtml = buildAcknowledgementHtml({ toName, glpiTicketId, originalSubject, customMessage: settings.acknowledgementMessage, signature });
  return sendEmail({ ticketId, to: toEmail, subject, bodyHtml, saveAsMessage: true });
}

// Envoie une relance automatique pour un ticket en attente de réponse utilisateur
async function sendReminder({ ticketId, glpiTicketId, toEmail, toName, subject, reminderNumber, isPreClose = false }) {
  const emailSubject = `[Ticket #${glpiTicketId}] ${subject}`;
  const signature = await getEmailSignature();
  const bodyHtml = isPreClose
    ? `<p>Bonjour ${toName || ''},</p>
<p>Sans réponse de votre part dans les 5 prochains jours, votre ticket <strong>#${glpiTicketId}</strong> (${subject}) sera automatiquement clôturé.</p>
<p>Si le problème est résolu, vous n'avez rien à faire. Sinon, répondez à cet email.</p>
${signature}`
    : `<p>Bonjour ${toName || ''},</p>
<p>Nous revenons vers vous concernant votre ticket <strong>#${glpiTicketId}</strong> : ${subject}.</p>
<p>Votre demande est toujours en attente. Pouvez-vous nous confirmer si le problème est résolu ou s'il persiste ?</p>
<p>Répondez simplement à cet email.</p>
${signature}`;

  const { logEvent } = require('./ticketEvent');
  await logEvent(ticketId, 'REMINDER_SENT', 'SYSTEM', { reminderNumber, isPreClose });

  return sendEmail({ ticketId, to: toEmail, subject: emailSubject, bodyHtml, saveAsMessage: true });
}

// Génère le HTML de la notification "incident déjà connu" (fonction pure, sans envoi)
function buildKnownIncidentNotificationHtml({ toName, glpiTicketId, originalSubject, isMajor, impactedCount, signature }) {
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
${signature || DEFAULT_EMAIL_SIGNATURE}
`.trim();
}

// Envoie une notification "incident déjà connu" quand un site est rattaché à un incident existant
async function sendKnownIncidentNotification({ ticketId, glpiTicketId, toEmail, toName, originalSubject, isMajor, impactedCount }) {
  const subject = `[Ticket #${glpiTicketId}] ${originalSubject}`;
  const signature = await getEmailSignature();
  const bodyHtml = buildKnownIncidentNotificationHtml({ toName, glpiTicketId, originalSubject, isMajor, impactedCount, signature });
  return sendEmail({ ticketId, to: toEmail, subject, bodyHtml, saveAsMessage: true });
}

// Notifie tous les sites impactés lors de la résolution d'un incident majeur
async function notifyMajorIncidentResolved({ ticketId, glpiTicketId, ticketTitle, impactedSites }) {
  const subject = `[Ticket #${glpiTicketId}] ${ticketTitle}`;
  const signature = await getEmailSignature();
  const bodyHtml = `
<p>Bonjour,</p>
<p>L'incident <strong>#${glpiTicketId} — ${ticketTitle}</strong> a été résolu.</p>
<p>Le service est maintenant rétabli. Merci de votre patience.</p>
${signature}
`.trim();

  for (const site of impactedSites) {
    if (!site.includes('@')) continue; // ignorer les noms sans email
    try {
      await sendEmail({ ticketId, to: site, subject, bodyHtml, saveAsMessage: false });
    } catch (err) {
      console.error(`[emailSender] Échec notification résolution incident majeur vers ${site} (ticket ${ticketId}):`, err.message);
    }
  }
}

// Relance un responsable (admin/technicien) qu'un brouillon AiEmailDraft attend toujours sa
// validation humaine depuis trop longtemps (Paramètres > Automatisation > Relance des brouillons).
// saveAsMessage: false car ce mail s'adresse au responsable interne, pas au demandeur d'origine
// — il ne doit pas apparaître dans le fil de conversation du ticket.
async function sendDraftPendingReminderEmail({ recipientEmail, recipientName, draftId, draftSubject, draftRecipientEmail, draftContent, minutesWaiting, approvalToken }) {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const approvalLink = `${frontendUrl}/approve/${approvalToken}`;
  const subject = `[Relance] Réponse IA en attente de validation depuis ${minutesWaiting} min`;
  const bodyHtml = `
<p>Bonjour ${recipientName || ''},</p>
<p>Une réponse générée par l'IA attend toujours votre validation depuis <strong>${minutesWaiting} minutes</strong> :</p>
<table style="border-collapse:collapse;margin:16px 0">
  <tr><td style="padding:4px 12px 4px 0;color:#666">Destinataire prévu</td><td>${draftRecipientEmail}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666">Sujet</td><td>${draftSubject}</td></tr>
</table>
<p>Si vous êtes au bureau (réseau local), relisez et validez depuis ce lien — vous pouvez aussi y modifier le texte avant envoi :</p>
<p style="margin:20px 0">
  <a href="${approvalLink}" style="background:#0b1c30;color:#fff;padding:10px 20px;text-decoration:none;display:inline-block">Relire et valider la réponse</a>
</p>
<p style="color:#888;font-size:12px">Ce lien est à usage unique et expire dans 24 heures.</p>
<p><strong>Si vous n'êtes pas au bureau</strong> (hors réseau local), répondez simplement à cet email avec le mot <strong>« J'approuve »</strong> pour envoyer la réponse telle quelle ci-dessous, ou <strong>« Je rejette »</strong> pour l'annuler.</p>
<blockquote style="border-left:3px solid #ccc;margin:12px 0;padding:8px 16px;color:#444">${draftContent}</blockquote>
<p>Cordialement,<br>Support IT</p>
`.trim();
  return sendEmail({ to: recipientEmail, subject, bodyHtml, saveAsMessage: false });
}

// Envoie le lien de réinitialisation à un utilisateur qui a cliqué "mot de passe oublié"
async function sendPasswordResetLinkEmail({ recipientEmail, recipientName, resetToken }) {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const resetLink = `${frontendUrl}/reset-password/${resetToken}`;
  const subject = 'Réinitialisation de votre mot de passe';
  const bodyHtml = `
<p>Bonjour ${recipientName || ''},</p>
<p>Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le lien ci-dessous pour en choisir un nouveau :</p>
<p style="margin:20px 0">
  <a href="${resetLink}" style="background:#0b1c30;color:#fff;padding:10px 20px;text-decoration:none;display:inline-block">Choisir un nouveau mot de passe</a>
</p>
<p style="color:#888;font-size:12px">Ce lien est à usage unique et expire dans 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
<p>Cordialement,<br>Support IT</p>
`.trim();
  return sendEmail({ to: recipientEmail, subject, bodyHtml, saveAsMessage: false });
}

// Envoie le mot de passe temporaire généré par un admin lors d'une réinitialisation forcée
async function sendTemporaryPasswordEmail({ recipientEmail, recipientName, temporaryPassword }) {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const subject = 'Votre mot de passe a été réinitialisé';
  const bodyHtml = `
<p>Bonjour ${recipientName || ''},</p>
<p>Un administrateur a réinitialisé votre mot de passe. Voici votre mot de passe temporaire :</p>
<p style="margin:16px 0;padding:12px 16px;background:#f4f4f4;font-family:monospace;font-size:16px;font-weight:bold;display:inline-block">${temporaryPassword}</p>
<p><strong>Vous devrez le changer dès votre prochaine connexion</strong> — l'application vous le demandera automatiquement.</p>
<p>Connectez-vous ici : <a href="${frontendUrl}/login">${frontendUrl}/login</a></p>
<p>Cordialement,<br>Support IT</p>
`.trim();
  return sendEmail({ to: recipientEmail, subject, bodyHtml, saveAsMessage: false });
}

module.exports = {
  sendEmail,
  sendAcknowledgement,
  sendReminder,
  sendKnownIncidentNotification,
  notifyMajorIncidentResolved,
  sendDraftPendingReminderEmail,
  sendPasswordResetLinkEmail,
  sendTemporaryPasswordEmail,
  buildAcknowledgementHtml,
  buildKnownIncidentNotificationHtml,
  getEmailSignature,
};
