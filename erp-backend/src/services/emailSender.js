const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const prisma = require('../prismaClient');
const { graphFetch } = require('../utils/graphClient');
const { getSystemSettings, resolveFrontendUrl } = require('./systemSettings');
const { logEvent } = require('./ticketEvent');
const { generateEmailSummary } = require('./emailSummaryGenerator');

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
async function sendEmailViaSmtp({ to, cc, subject, bodyHtml, account }) {
  const transporter = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort || 587,
    secure: account.useTls === false ? false : account.smtpPort === 465,
    auth: { user: account.username, pass: account.password },
  });
  const mailOptions = {
    from: account.emailAddress,
    to: Array.isArray(to) ? to.join(', ') : to,
    cc: cc && cc.length > 0 ? cc.join(', ') : undefined,
    subject,
    html: bodyHtml,
  };
  return transporter.sendMail(mailOptions);
}

async function sendEmail({ ticketId, to, cc = [], subject, bodyHtml, inReplyTo = null, conversationId = null, inReplyToGraphMessageId = null, saveAsMessage = true }) {
  // Priorité au compte par défaut Outlook, sinon Outlook actif, sinon SMTP
  let account = await prisma.emailAccount.findFirst({
    where: { provider: 'OUTLOOK', isActive: true, isDefault: true, refreshToken: { not: null } },
  });
  if (!account) {
    account = await prisma.emailAccount.findFirst({
      where: { provider: 'OUTLOOK', isActive: true, refreshToken: { not: null } },
    });
  }
  const isOutlook = !!account;

  if (!account) {
    account = await prisma.emailAccount.findFirst({
      where: { provider: 'IMAP_SMTP', isActive: true, isDefault: true, smtpHost: { not: null } },
    });
  }
  if (!account) {
    account = await prisma.emailAccount.findFirst({
      where: { provider: 'IMAP_SMTP', isActive: true, smtpHost: { not: null } },
    });
  }

  if (!account) throw new Error('Aucun compte email configuré pour l\'envoi (Outlook/M365 ou SMTP)');

  // Route SMTP — même garde-fou : ne jamais mettre la boîte d'envoi en copie
  if (!isOutlook) {
    const senderAddress = (account.emailAddress || account.username || '').toLowerCase().trim();
    // Même garde-fou en To qu'en Graph : ne jamais adresser la boîte d'envoi elle-même
    // (sauf si c'est le seul destinataire — l'envoi part quand même).
    const toList = (Array.isArray(to) ? to : [to]).map((a) => String(a || '').trim()).filter(Boolean);
    const toFiltered = toList.filter((addr) => addr.toLowerCase() !== senderAddress);
    const smtpTo = toFiltered.length > 0 ? toFiltered : toList;
    const ccList = (cc || []).filter((addr) => addr && String(addr).toLowerCase().trim() !== senderAddress);
    await sendEmailViaSmtp({ to: smtpTo, cc: ccList, subject, bodyHtml, account });
    if (saveAsMessage && ticketId) {
      const sender = account.emailAddress || account.username;
      // Récupérer le statut actuel du ticket pour le suivi
      const currentTicket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true } }).catch(() => null);
      const plainBody = bodyHtml.replace(/<[^>]+>/g, ' ');
      await prisma.ticketMessage.create({
        data: {
          ticketId,
          direction: 'OUTBOUND',
          sender,
          recipients: smtpTo,
          ccRecipients: ccList,
          subject,
          body: plainBody,
          bodyHtml,
          timestamp: new Date(),
          ticketStatusAtTime: currentTicket?.status || null,
        },
      });
      // Générer le résumé IA en arrière-plan
      generateEmailSummary({ body: plainBody, direction: 'OUTBOUND' })
        .then((summary) => {
          if (summary) return prisma.ticketMessage.updateMany({ where: { ticketId, direction: 'OUTBOUND', body: plainBody }, data: { summary } });
        })
        .catch(() => {});
      await logEvent(ticketId, 'EMAIL_SENT', 'SYSTEM', { to, cc: ccList, subject, method: 'SMTP' });
    }
    return;
  }

  const settings = await getSystemSettings();
  const logoAttachment = getLogoAttachmentIfReferenced(bodyHtml, settings.signatureLogoUrl);

  // Ne JAMAIS adresser la boîte d'envoi elle-même (To) : même risque que pour les CC — le mail
  // retomberait dans la boîte sondée par le pipeline email et y serait re-traité comme un
  // message entrant. Cas typique : demande envoyée directement à la boîte support, dont
  // l'adresse ressort dans la liste To du message d'origine qu'on remet dans la boucle.
  // EXCEPTION : la boîte support reste en To si c'est le SEUL destinataire (l'envoi doit
  // partir quand même, l'admin verra l'anomalie dans l'email enregistré).
  const senderAddrNorm = (account.emailAddress || account.username || '').toLowerCase().trim();
  const toListRaw = (Array.isArray(to) ? to : [to]).map((a) => String(a || '').trim()).filter(Boolean);
  const toListFiltered = toListRaw.filter((addr) => addr.toLowerCase() !== senderAddrNorm);
  const finalToList = toListFiltered.length > 0 ? toListFiltered : toListRaw;
  const toRecipients = finalToList.map((addr) => ({ emailAddress: { address: addr } }));

  // Ne JAMAIS mettre la boîte d'envoi elle-même en copie : le mail retomberait dans la
  // boîte sondée par le pipeline email et y serait re-traité comme un message entrant.
  const senderAddress = (account.emailAddress || account.username || '').toLowerCase().trim();
  const ccList = (cc || []).filter((addr) => addr && String(addr).toLowerCase().trim() !== senderAddress);
  const ccRecipientsPayload = ccList.length > 0 ? ccList.map((addr) => ({ emailAddress: { address: addr } })) : [];

  const isSimulatedId = typeof inReplyToGraphMessageId === 'string' && inReplyToGraphMessageId.startsWith('SIM-');

  const buildNewMessage = () => {
    const message = {
      subject,
      body: { contentType: 'HTML', content: bodyHtml },
      toRecipients,
      ...(ccRecipientsPayload.length > 0 ? { ccRecipients: ccRecipientsPayload } : {}),
      ...(logoAttachment ? { attachments: [logoAttachment] } : {}),
    };
    return graphFetch(account, '/me/messages', { method: 'POST', body: JSON.stringify(message) });
  };

  let draft;
  if (inReplyToGraphMessageId && !isSimulatedId) {
    try {
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
    } catch (err) {
      // Message source introuvable (purgé/rétention Outlook) → envoi en email neuf plutôt
      // que d'échouer : le destinataire reçoit quand même sa réponse, sans fil de conversation.
      if (/Erreur Graph API \(404\)/.test(err.message || '')) {
        console.warn(`[emailSender] Message source ${inReplyToGraphMessageId} introuvable (404) — envoi sans fil de conversation`);
        draft = await buildNewMessage();
      } else {
        throw err;
      }
    }
  } else {
    draft = await buildNewMessage();
  }
  await graphFetch(account, `/me/messages/${draft.id}/send`, { method: 'POST' });

  if (saveAsMessage && ticketId) {
    // Récupérer le statut actuel du ticket pour le suivi
    const currentTicket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true } }).catch(() => null);
    const plainBody = bodyHtml.replace(/<[^>]+>/g, ' ');
    await prisma.ticketMessage.create({
      data: {
        ticketId,
        direction: 'OUTBOUND',
        sender: account.emailAddress,
        recipients: finalToList,
        ccRecipients: ccList,
        subject,
        body: plainBody,
        bodyHtml,
        outlookMessageId: draft.id,
        internetMessageId: draft.internetMessageId,
        inReplyTo,
        conversationId,
        timestamp: new Date(),
        ticketStatusAtTime: currentTicket?.status || null,
      },
    });
    // Générer le résumé IA en arrière-plan
    generateEmailSummary({ body: plainBody, direction: 'OUTBOUND' })
      .then((summary) => {
        if (summary) return prisma.ticketMessage.updateMany({ where: { ticketId, direction: 'OUTBOUND', body: plainBody }, data: { summary } });
      })
      .catch(() => {});

    await logEvent(ticketId, 'EMAIL_SENT', 'SYSTEM', { to, cc, subject, method: 'OUTLOOK' });
  }

  return draft;
}

const DEFAULT_ACKNOWLEDGEMENT_MESSAGE = 'Nous avons bien reçu votre demande de support et un ticket a été créé automatiquement.';
const DEFAULT_EMAIL_SIGNATURE = '<p>Cordialement,<br>Support IT</p>';

const STATUS_LABELS = {
  NEW: 'Nouveau',
  OPEN: 'En cours (Attribué)',
  PLANNED: 'En cours (Planifié)',
  PENDING: 'En attente',
  WAITING_FOR_USER: 'En attente de votre réponse',
  SOLVED: 'Résolu',
  CLOSED: 'Fermé',
};
const STATUS_COLORS = {
  NEW: '#2563eb', OPEN: '#2563eb', PLANNED: '#7c3aed',
  PENDING: '#d97706', WAITING_FOR_USER: '#d97706',
  SOLVED: '#16a34a', CLOSED: '#6b7280',
};

// ── Helpers email ───────────────────────────────────────────────────────────
function buildStyledTable(rows) {
  const cells = rows.filter(Boolean).map((r, i) => {
    const bg = i % 2 === 1 ? 'background:#f9fafb;' : '';
    const fontWeight = r.bold ? 'font-weight:600;' : '';
    const color = r.color ? `color:${r.color};` : '';
    const extra = r.preWrap ? 'white-space:pre-wrap;vertical-align:top;' : '';
    return `<tr style="${bg}"><td style="padding:8px 12px;color:#4b5563;font-weight:600;width:180px;vertical-align:top">${r.label}</td><td style="padding:8px 12px;${fontWeight}${color}${extra}">${r.value}</td></tr>`;
  }).join('\n  ');
  return `<table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:600px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:14px;font-family:sans-serif">
  ${cells}
</table>`;
}

function buildActionLink(url, label) {
  return `<p style="margin:20px 0"><a href="${url}" style="background:#2563eb;color:#ffffff;padding:10px 20px;text-decoration:none;display:inline-block;border-radius:8px;font-weight:bold;font-size:14px;font-family:sans-serif">${label}</a></p>`;
}

function buildPriorityLabel(priority) {
  return { P1: 'Critique', P2: 'Haute', P3: 'Moyenne', P4: 'Basse' }[priority] || priority;
}

function buildPriorityColor(priority) {
  return { P1: '#dc2626', P2: '#d97706', P3: '#2563eb', P4: '#16a34a' }[priority] || '#666';
}

// Enveloppe le contenu d'un email dans le gabarit commun : conteneur centré, bandeau d'en-tête
// bleu, corps et signature. Tous les templates l'utilisent pour un rendu homogène et soigné.
function buildEmailLayout({ headerTitle, headerSubtitle, children, signature }) {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 16px">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;font-family:sans-serif">
        <tr>
          <td style="background:#2563eb;padding:20px 24px">
            <div style="color:#ffffff;font-size:18px;font-weight:bold;line-height:1.3">${headerTitle}</div>
            ${headerSubtitle ? `<div style="color:#dbeafe;font-size:14px;margin-top:4px">${headerSubtitle}</div>` : ''}
          </td>
        </tr>
        <tr>
          <td style="padding:24px 24px 0;color:#1f2937;font-size:14px;line-height:1.6">
            ${children}
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px 24px">
            ${signature || DEFAULT_EMAIL_SIGNATURE}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`.trim();
}

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

// ── Template : Accusé de réception ──────────────────────────────────────────
// Génère le HTML de l'accusé de réception (fonction pure, sans envoi).
// `customMessage` vient de SystemSettings.acknowledgementMessage (Paramètres > Automatisation > Emails) ;
// placeholders supportés : {ticketId}, {subject}, {toName}.
// `ticketLink` : lien vers le ticket dans l'application (bouton "Suivre mon ticket").
function buildAcknowledgementHtml({ toName, glpiTicketId, ticketId, originalSubject, customMessage, signature, ticketLink }) {
  const displayId = glpiTicketId || ticketId || 'N/A';
  const introMessage = (customMessage || DEFAULT_ACKNOWLEDGEMENT_MESSAGE)
    .replaceAll('{ticketId}', displayId)
    .replaceAll('{subject}', originalSubject)
    .replaceAll('{toName}', toName || '');
  return buildEmailLayout({
    headerTitle: 'Votre demande a bien été enregistrée',
    headerSubtitle: `Ticket #${displayId}`,
    signature,
    children: `
<p style="margin:0 0 12px">Bonjour ${toName || ''},</p>
<p style="margin:0 0 12px">${introMessage}</p>
${buildStyledTable([
  { label: 'Numéro de ticket', value: `<strong>#${displayId}</strong>` },
  { label: 'Sujet', value: originalSubject },
])}
<p style="margin:0 0 12px">Notre équipe va analyser votre demande et vous contactera dans les meilleurs délais.</p>
${ticketLink ? buildActionLink(ticketLink, 'Suivre mon ticket') : ''}
<p style="margin:0 0 12px">Vous pouvez aussi répondre directement à cet email pour ajouter des informations à votre ticket.</p>`,
  });
}

// Envoie un accusé de réception automatique lors de la création d'un nouveau ticket.
// cc + inReplyToGraphMessageId : pour un ticket né d'un email, l'accusé part en RÉPONSE
// dans le fil d'origine avec les personnes en copie de la demande — pas en email isolé.
async function sendAcknowledgement({ ticketId, glpiTicketId, toEmail, toName, originalSubject, cc = [], to = null, inReplyToGraphMessageId = null, conversationId = null, inReplyTo = null }) {
  const settings = await getSystemSettings();
  if (settings.emailAcknowledgementEnabled === false) return null;
  const displayId = glpiTicketId || ticketId || 'N/A';
  const subject = `[Ticket #${displayId}] ${originalSubject}`;
  const signature = await getEmailSignature();
  const frontendUrl = resolveFrontendUrl(settings);
  const ticketLink = ticketId ? `${frontendUrl}/tickets/${ticketId}` : null;
  const bodyHtml = buildAcknowledgementHtml({ toName, glpiTicketId, ticketId, originalSubject, customMessage: settings.acknowledgementMessage, signature, ticketLink });
  // `to` = liste To du message d'origine (boîtes de diffusion comprises) : on la remet dans la
  // boucle derrière le destinataire principal, sans doublon, pour une sémantique « Répondre à tous ».
  const seenTo = new Set([String(toEmail || '').toLowerCase().trim()]);
  const ackTo = [toEmail];
  for (const addr of (Array.isArray(to) ? to : [])) {
    const norm = String(addr || '').toLowerCase().trim();
    if (norm && !seenTo.has(norm)) {
      seenTo.add(norm);
      ackTo.push(addr);
    }
  }
  return sendEmail({ ticketId, to: ackTo, cc, subject, bodyHtml, saveAsMessage: true, inReplyToGraphMessageId, conversationId, inReplyTo });
}

// ── Template : Relance demandeur ─────────────────────────────────────────────
function buildReminderHtml({ toName, glpiTicketId, ticketId, subject, isPreClose, signature, ticketLink }) {
  const displayId = glpiTicketId || ticketId || 'N/A';
  const content = isPreClose
    ? `
<p style="margin:0 0 12px">Sans réponse de votre part dans les 5 prochains jours, votre ticket sera automatiquement clôturé.</p>
${buildStyledTable([
  { label: 'Numéro de ticket', value: `<strong>#${displayId}</strong>` },
  { label: 'Sujet', value: subject },
  { label: 'Action requise', value: `<strong style="color:#d97706">Répondre avant clôture automatique</strong>` },
])}
<p style="margin:0 0 12px">Si le problème est résolu, vous n'avez rien à faire. Sinon, répondez à cet email.</p>
${buildActionLink(ticketLink, 'Répondre au ticket')}`
    : `
<p style="margin:0 0 12px">Nous revenons vers vous concernant votre ticket en cours :</p>
${buildStyledTable([
  { label: 'Numéro de ticket', value: `<strong>#${displayId}</strong>` },
  { label: 'Sujet', value: subject },
])}
<p style="margin:0 0 12px">Votre demande est toujours en attente. Pouvez-vous nous confirmer si le problème est résolu ou s'il persiste ?</p>
<p style="margin:0 0 12px">Répondez simplement à cet email ou cliquez sur le bouton ci-dessous :</p>
${buildActionLink(ticketLink, 'Suivre mon ticket')}`;
  return buildEmailLayout({
    headerTitle: isPreClose ? 'Clôture automatique prochaine' : 'Votre ticket est toujours en attente',
    headerSubtitle: `Ticket #${displayId}`,
    signature,
    children: `<p style="margin:0 0 12px">Bonjour ${toName || ''},</p>${content}`,
  });
}

// Envoie une relance automatique pour un ticket en attente de réponse utilisateur
async function sendReminder({ ticketId, glpiTicketId, toEmail, toName, subject, reminderNumber, isPreClose = false }) {
  const settings = await getSystemSettings();
  const displayId = glpiTicketId || ticketId || 'N/A';
  const emailSubject = `[Ticket #${displayId}] ${subject}`;
  const signature = await getEmailSignature();
  const frontendUrl = resolveFrontendUrl(settings);
  const ticketLink = `${frontendUrl}/tickets/${ticketId}`;
  const bodyHtml = buildReminderHtml({ toName, glpiTicketId, ticketId, subject, isPreClose, signature, ticketLink });

  await logEvent(ticketId, 'REMINDER_SENT', 'SYSTEM', { reminderNumber, isPreClose });

  return sendEmail({ ticketId, to: toEmail, subject: emailSubject, bodyHtml, saveAsMessage: true });
}

// ── Template : Incident déjà connu ───────────────────────────────────────────
// Génère le HTML de la notification "incident déjà connu" (fonction pure, sans envoi)
function buildKnownIncidentNotificationHtml({ toName, glpiTicketId, ticketId, originalSubject, isMajor, impactedCount, signature, ticketLink }) {
  const displayId = glpiTicketId || ticketId || 'N/A';
  const majorNote = isMajor
    ? `<p style="margin:0 0 12px;color:#d97706;font-weight:600">Cet incident a été promu en <strong>incident majeur</strong> (${impactedCount} sites impactés). Notre équipe est mobilisée en priorité.</p>`
    : '';
  return buildEmailLayout({
    headerTitle: 'Incident déjà identifié',
    headerSubtitle: `Ticket #${displayId}`,
    signature,
    children: `
<p style="margin:0 0 12px">Bonjour ${toName || ''},</p>
<p style="margin:0 0 12px">Votre demande a bien été prise en compte.</p>
<p style="margin:0 0 12px">Un incident déjà identifié est actuellement en cours d'investigation par nos équipes :</p>
${buildStyledTable([
  { label: 'Sujet', value: `<strong>${originalSubject}</strong>` },
  { label: 'Sites impactés', value: `${impactedCount}` },
])}
${majorNote}
<p style="margin:0 0 12px">Votre site a été ajouté à la liste des sites impactés. Nous vous informerons dès que le service sera rétabli.</p>
${ticketLink ? buildActionLink(ticketLink, 'Suivre mon ticket') : ''}`,
  });
}

// Envoie une notification "incident déjà connu" quand un site est rattaché à un incident existant
async function sendKnownIncidentNotification({ ticketId, glpiTicketId, toEmail, toName, originalSubject, isMajor, impactedCount }) {
  const settings = await getSystemSettings();
  if (settings.emailKnownIncidentEnabled === false) return null;
  const displayId = glpiTicketId || ticketId || 'N/A';
  const subject = `[Ticket #${displayId}] ${originalSubject}`;
  const signature = await getEmailSignature();
  const frontendUrl = resolveFrontendUrl(settings);
  const ticketLink = ticketId ? `${frontendUrl}/tickets/${ticketId}` : null;
  const bodyHtml = buildKnownIncidentNotificationHtml({ toName, glpiTicketId, ticketId, originalSubject, isMajor, impactedCount, signature, ticketLink });
  return sendEmail({ ticketId, to: toEmail, subject, bodyHtml, saveAsMessage: true });
}

// ── Template : Résolution d'incident majeur ──────────────────────────────────
function buildMajorIncidentResolvedHtml({ glpiTicketId, ticketTitle, signature }) {
  return buildEmailLayout({
    headerTitle: 'Incident majeur résolu',
    headerSubtitle: `Ticket #${glpiTicketId}`,
    signature,
    children: `
<p style="margin:0 0 12px">Bonjour,</p>
<p style="margin:0 0 12px">L'incident <strong>#${glpiTicketId} — ${ticketTitle}</strong> a été résolu.</p>
<p style="margin:0 0 12px">Le service est maintenant rétabli. Merci de votre patience.</p>`,
  });
}

// Notifie tous les sites impactés lors de la résolution d'un incident majeur
async function notifyMajorIncidentResolved({ ticketId, glpiTicketId, ticketTitle, impactedSites }) {
  const settings = await getSystemSettings();
  if (settings.emailMajorIncidentResolvedEnabled === false) return null;
  const subject = `[Ticket #${glpiTicketId}] ${ticketTitle}`;
  const signature = await getEmailSignature();
  const bodyHtml = buildMajorIncidentResolvedHtml({ glpiTicketId, ticketTitle, signature });

  for (const site of impactedSites) {
    if (!site.includes('@')) continue; // ignorer les noms sans email
    try {
      await sendEmail({ ticketId, to: site, subject, bodyHtml, saveAsMessage: false });
    } catch (err) {
      console.error(`[emailSender] Échec notification résolution incident majeur vers ${site} (ticket ${ticketId}):`, err.message);
    }
  }
}

// ── Template : Assignation technicien ────────────────────────────────────────
function buildAssignmentNotificationHtml({ technicianName, glpiTicketId, ticketId, ticketTitle, priority, category, teamName, signature, ticketLink }) {
  const priorityLabel = buildPriorityLabel(priority);
  const priorityColor = buildPriorityColor(priority);
  return buildEmailLayout({
    headerTitle: 'Nouvelle assignation',
    headerSubtitle: `Ticket #${glpiTicketId || ticketId}`,
    signature,
    children: `
<p style="margin:0 0 12px">Bonjour ${technicianName || ''},</p>
<p style="margin:0 0 12px">Un nouveau ticket vient de vous être <strong>assigné automatiquement</strong> par notre système d'analyse IA.</p>
${buildStyledTable([
  { label: 'Numéro de ticket', value: `<strong>#${glpiTicketId || ticketId}</strong>` },
  { label: 'Sujet', value: `<strong>${ticketTitle}</strong>` },
  category ? { label: 'Catégorie', value: category } : null,
  { label: 'Priorité', value: `<strong style="color:${priorityColor}">${priorityLabel}</strong>`, bold: true, color: priorityColor },
  teamName ? { label: 'Équipe', value: teamName } : null,
].filter(Boolean))}
${buildActionLink(ticketLink, 'Prendre en charge le ticket')}
<p style="margin:0 0 12px;color:#6b7280;font-size:12px">Connectez-vous à l'application pour consulter le détail et intervenir sur ce ticket.</p>`,
  });
}

// Envoie un email de notification au technicien quand un ticket lui est automatiquement assigné.
// Utilisé par glpiTicketCreator.js et emailPipeline.js après autoAssignTechnicianWithAI,
// uniquement si le réglage notifyTechnicianOnAssignment est activé.
async function sendAssignmentNotificationEmail({ ticketId, glpiTicketId, ticketTitle, priority, technicianEmail, technicianName, category, teamName }) {
  const settings = await getSystemSettings();
  if (settings.emailAssignmentEnabled === false) return null;
  const subject = `[Ticket #${glpiTicketId || ticketId}] Nouvelle assignation — ${ticketTitle}`;
  const signature = await getEmailSignature();
  const frontendUrl = resolveFrontendUrl(settings);
  const ticketLink = `${frontendUrl}/tickets/${ticketId}`;
  const bodyHtml = buildAssignmentNotificationHtml({ technicianName, glpiTicketId, ticketId, ticketTitle, priority, category, teamName, signature, ticketLink });

  return sendEmail({ ticketId, to: technicianEmail, subject, bodyHtml, saveAsMessage: false });
}

// ── Template : Dépassement SLA ───────────────────────────────────────────────
function buildSlaBreachHtml({ technicianName, glpiTicketId, ticketId, ticketTitle, priority, slaResponseDueAt, signature, ticketLink }) {
  const priorityLabel = buildPriorityLabel(priority);
  const priorityColor = buildPriorityColor(priority);
  const dueAt = slaResponseDueAt
    ? new Date(slaResponseDueAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
  return buildEmailLayout({
    headerTitle: 'Dépassement du délai SLA',
    headerSubtitle: `Ticket #${glpiTicketId || ticketId}`,
    signature,
    children: `
<p style="margin:0 0 12px">Bonjour ${technicianName || ''},</p>
<p style="margin:0 0 12px">Le ticket <strong>#${glpiTicketId || ticketId} — ${ticketTitle}</strong> a dépassé son délai de réponse SLA.</p>
${buildStyledTable([
  { label: 'Numéro de ticket', value: `<strong>#${glpiTicketId || ticketId}</strong>` },
  { label: 'Sujet', value: ticketTitle },
  { label: 'Priorité', value: `<strong style="color:${priorityColor}">${priorityLabel}</strong>` },
  { label: 'Délai de réponse attendu', value: `<strong style="color:#dc2626">${dueAt}</strong>` },
])}
${buildActionLink(ticketLink, 'Prendre en charge le ticket')}
<p style="margin:0 0 12px;color:#6b7280;font-size:12px">Ce ticket doit être pris en charge rapidement — connectez-vous pour répondre au demandeur.</p>`,
  });
}

// Notifie le technicien assigné qu'un ticket a dépassé son délai de réponse SLA.
async function sendSlaBreachEmail({ ticketId, glpiTicketId, ticketTitle, priority, slaResponseDueAt, technicianEmail, technicianName }) {
  const settings = await getSystemSettings();
  if (settings.emailSlaBreachEnabled === false) return null;
  const subject = `[SLA] Dépassement — Ticket #${glpiTicketId || ticketId} : ${ticketTitle}`;
  const signature = await getEmailSignature();
  const frontendUrl = resolveFrontendUrl(settings);
  const ticketLink = `${frontendUrl}/tickets/${ticketId}`;
  const bodyHtml = buildSlaBreachHtml({ technicianName, glpiTicketId, ticketId, ticketTitle, priority, slaResponseDueAt, signature, ticketLink });

  return sendEmail({ ticketId, to: technicianEmail, subject, bodyHtml, saveAsMessage: false });
}

// ── Template : Dépassement d'échéance manuelle ───────────────────────────────
function buildDueDateHtml({ technicianName, glpiTicketId, ticketId, ticketTitle, priority, dueDate, signature, ticketLink }) {
  const priorityLabel = buildPriorityLabel(priority);
  const priorityColor = buildPriorityColor(priority);
  const dueAt = dueDate
    ? new Date(dueDate).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
  return buildEmailLayout({
    headerTitle: 'Échéance dépassée',
    headerSubtitle: `Ticket #${glpiTicketId || ticketId}`,
    signature,
    children: `
<p style="margin:0 0 12px">Bonjour ${technicianName || ''},</p>
<p style="margin:0 0 12px">Le ticket <strong>#${glpiTicketId || ticketId} — ${ticketTitle}</strong> a dépassé son <strong>échéance manuelle</strong>.</p>
${buildStyledTable([
  { label: 'Numéro de ticket', value: `<strong>#${glpiTicketId || ticketId}</strong>` },
  { label: 'Sujet', value: ticketTitle },
  { label: 'Priorité', value: `<strong style="color:${priorityColor}">${priorityLabel}</strong>` },
  { label: 'Échéance prévue', value: `<strong style="color:#dc2626">${dueAt}</strong>` },
])}
${buildActionLink(ticketLink, 'Traiter le ticket')}
<p style="margin:0 0 12px;color:#6b7280;font-size:12px">Ce ticket doit être pris en charge rapidement — connectez-vous pour le traiter.</p>`,
  });
}

// Notifie le technicien assigné qu'un ticket a dépassé son échéance manuelle (dueDate).
async function sendDueDateEmail({ ticketId, glpiTicketId, ticketTitle, priority, dueDate, technicianEmail, technicianName }) {
  const settings = await getSystemSettings();
  if (settings.emailDueDateBreachEnabled === false) return null;
  const subject = `[Échéance] Dépassement — Ticket #${glpiTicketId || ticketId} : ${ticketTitle}`;
  const signature = await getEmailSignature();
  const frontendUrl = resolveFrontendUrl(settings);
  const ticketLink = `${frontendUrl}/tickets/${ticketId}`;
  const bodyHtml = buildDueDateHtml({ technicianName, glpiTicketId, ticketId, ticketTitle, priority, dueDate, signature, ticketLink });

  return sendEmail({ ticketId, to: technicianEmail, subject, bodyHtml, saveAsMessage: false });
}

// ── Template : Changement de statut ──────────────────────────────────────────
function buildStatusChangeHtml({ recipientName, glpiTicketId, ticketId, ticketTitle, status, priority, category, signature, ticketLink }) {
  const displayId = glpiTicketId || ticketId || 'N/A';
  const priorityLabel = buildPriorityLabel(priority);
  const priorityColor = buildPriorityColor(priority);
  const statusLabel = STATUS_LABELS[status] || status;
  const statusColor = STATUS_COLORS[status] || '#2563eb';
  return buildEmailLayout({
    headerTitle: 'Changement de statut de votre demande',
    headerSubtitle: `Ticket #${displayId}`,
    signature,
    children: `
<p style="margin:0 0 12px">Bonjour ${recipientName || ''},</p>
<p style="margin:0 0 12px">Le statut de votre demande a changé :</p>
${buildStyledTable([
  { label: 'Numéro de ticket', value: `<strong>#${displayId}</strong>` },
  { label: 'Sujet', value: `<strong>${ticketTitle}</strong>` },
  { label: 'Nouveau statut', value: `<strong style="color:${statusColor}">${statusLabel}</strong>` },
  category ? { label: 'Catégorie', value: category } : null,
  { label: 'Priorité', value: `<strong style="color:${priorityColor}">${priorityLabel}</strong>` },
].filter(Boolean))}
${buildActionLink(ticketLink, 'Suivre mon ticket')}
<p style="margin:0 0 12px">Vous pouvez suivre votre demande et ajouter des informations directement dans le portail.</p>`,
  });
}

// Notifie le demandeur par email du changement de statut de son ticket (portail REQUESTER + suivi).
async function sendTicketStatusNotification({ ticketId, glpiTicketId, ticketTitle, status, priority, category, recipientEmail, recipientName }) {
  const settings = await getSystemSettings();
  if (settings.emailStatusChangeEnabled === false) return null;
  const displayId = glpiTicketId || ticketId || 'N/A';
  const statusLabel = STATUS_LABELS[status] || status;
  const subject = `[Ticket #${displayId}] ${statusLabel} — ${ticketTitle}`;
  const signature = await getEmailSignature();
  const frontendUrl = resolveFrontendUrl(settings);
  const ticketLink = `${frontendUrl}/tickets/${ticketId}`;
  const bodyHtml = buildStatusChangeHtml({ recipientName, glpiTicketId, ticketId, ticketTitle, status, priority, category, signature, ticketLink });

  return sendEmail({ ticketId, to: recipientEmail, subject, bodyHtml, saveAsMessage: false });
}

// ── Template : Escalade interne ──────────────────────────────────────────────
// Alerte un destinataire interne (équipe cible, admin, technicien sortant) qu'un ticket a été
// escaladé — c'est-à-dire TRANSFÉRÉ à une autre équipe responsable (ou signalé comme prioritaire
// quand l'escalade se fait au sein de la même équipe). Lien direct vers le ticket.
function buildEscalationEmailHtml({ recipientName, ticketId, ticketTitle, priority, reason, targetTeamName, signature, ticketLink }) {
  const priorityLabel = buildPriorityLabel(priority);
  const transferLine = targetTeamName
    ? `<p style="margin:0 0 12px">Le ticket <strong>#${ticketId} — ${ticketTitle}</strong> vient d'être <strong>transféré à l'équipe ${targetTeamName}</strong>, désormais responsable de sa prise en charge.</p>`
    : `<p style="margin:0 0 12px">Le ticket <strong>#${ticketId} — ${ticketTitle}</strong> a été <strong>escaladé</strong> : une prise en charge prioritaire est requise.</p>`;
  return buildEmailLayout({
    headerTitle: targetTeamName ? 'Ticket transféré' : 'Ticket escaladé',
    headerSubtitle: `Ticket #${ticketId}`,
    signature,
    children: `
<p style="margin:0 0 12px">Bonjour ${recipientName || ''},</p>
${transferLine}
${buildStyledTable([
  { label: 'Numéro de ticket', value: `<strong>#${ticketId}</strong>` },
  { label: 'Sujet', value: `<strong>${ticketTitle}</strong>` },
  targetTeamName ? { label: 'Équipe responsable', value: `<strong>${targetTeamName}</strong>` } : null,
  { label: 'Priorité', value: `<strong>${priorityLabel} (${priority})</strong>` },
  reason ? { label: 'Motif', value: reason } : null,
].filter(Boolean))}
${buildActionLink(ticketLink, 'Prendre en charge le ticket')}
<p style="margin:0 0 12px;color:#6b7280;font-size:12px">Connectez-vous à l'application pour consulter les détails et intervenir.</p>`,
  });
}

async function sendEscalationEmail({ ticketId, ticketTitle, priority, reason, escalationLevel, targetTeamName, recipientEmail, recipientName }) {
  const settings = await getSystemSettings();
  if (settings.emailEscalationEnabled === false) return null;
  const subject = targetTeamName
    ? `[Transfert] Ticket #${ticketId} : ${ticketTitle}`
    : `[Escalade] Ticket #${ticketId} : ${ticketTitle}`;
  const signature = await getEmailSignature();
  const frontendUrl = resolveFrontendUrl(settings);
  const ticketLink = `${frontendUrl}/tickets/${ticketId}`;
  const bodyHtml = buildEscalationEmailHtml({ recipientName, ticketId, ticketTitle, priority, reason, targetTeamName, signature, ticketLink });

  return sendEmail({ ticketId, to: recipientEmail, subject, bodyHtml, saveAsMessage: false });
}

// ── Template : Escalade demandeur ────────────────────────────────────────────
// Notifie le demandeur que sa demande a été transférée à l'équipe en charge du sujet
// (ou signalée comme prioritaire). Lien vers le portail REQUESTER pour suivre sa demande.
function buildRequesterEscalationEmailHtml({ recipientName, ticketId, ticketTitle, priority, reason, targetTeamName, signature, portalLink }) {
  const priorityLabel = buildPriorityLabel(priority);
  const transferLine = targetTeamName
    ? `<p style="margin:0 0 12px">Votre demande <strong>#${ticketId} — ${ticketTitle}</strong> a été <strong>transmise à l'équipe ${targetTeamName}</strong>, spécialisée dans ce type de demande : elle est désormais prise en charge par leurs soins.</p>`
    : `<p style="margin:0 0 12px">Votre demande <strong>#${ticketId} — ${ticketTitle}</strong> a été <strong>escaladée</strong> : elle est désormais prise en charge de façon prioritaire par nos équipes.</p>`;
  return buildEmailLayout({
    headerTitle: targetTeamName ? 'Votre demande a été transmise' : 'Votre demande a été escaladée',
    headerSubtitle: `Ticket #${ticketId}`,
    signature,
    children: `
<p style="margin:0 0 12px">Bonjour ${recipientName || ''},</p>
${transferLine}
${buildStyledTable([
  { label: 'Numéro de ticket', value: `<strong>#${ticketId}</strong>` },
  { label: 'Sujet', value: `<strong>${ticketTitle}</strong>` },
  targetTeamName ? { label: 'Équipe en charge', value: `<strong>${targetTeamName}</strong>` } : null,
  { label: 'Priorité', value: `<strong>${priorityLabel} (${priority})</strong>` },
  reason ? { label: 'Motif', value: reason } : null,
].filter(Boolean))}
${buildActionLink(portalLink, 'Suivre ma demande dans le portail')}
<p style="margin:0 0 12px;color:#6b7280;font-size:12px">Vous pouvez consulter l'état de votre demande et ajouter des informations à tout moment.</p>`,
  });
}

async function sendRequesterEscalationEmail({ ticketId, ticketTitle, priority, reason, escalationLevel, targetTeamName, recipientEmail, recipientName }) {
  const settings = await getSystemSettings();
  if (settings.emailEscalationEnabled === false) return null;
  const subject = targetTeamName
    ? `[Ticket #${ticketId}] Votre demande a été transmise à l'équipe ${targetTeamName}`
    : `[Ticket #${ticketId}] Votre demande a été escaladée`;
  const signature = await getEmailSignature();
  const frontendUrl = resolveFrontendUrl(settings);
  const portalLink = `${frontendUrl}/portal`;
  const bodyHtml = buildRequesterEscalationEmailHtml({ recipientName, ticketId, ticketTitle, priority, reason, targetTeamName, signature, portalLink });

  return sendEmail({ ticketId, to: recipientEmail, subject, bodyHtml, saveAsMessage: false });
}

// ── Template : Relance brouillon IA ──────────────────────────────────────────
// Relance un responsable (admin/technicien) qu'un brouillon AiEmailDraft attend toujours sa
// validation humaine depuis trop longtemps (Paramètres > Automatisation > Relance des brouillons).
// saveAsMessage: false car ce mail s'adresse au responsable interne, pas au demandeur d'origine
// — il ne doit pas apparaître dans le fil de conversation du ticket.
function buildDraftPendingReminderHtml({ recipientName, draftSubject, draftRecipientEmail, draftContent, minutesWaiting, approvalLink, signature }) {
  return buildEmailLayout({
    headerTitle: 'Réponse IA en attente de validation',
    signature,
    children: `
<p style="margin:0 0 12px">Bonjour ${recipientName || ''},</p>
<p style="margin:0 0 12px">Une réponse générée par l'IA attend toujours votre validation depuis <strong>${minutesWaiting} minutes</strong> :</p>
${buildStyledTable([
  { label: 'Destinataire prévu', value: draftRecipientEmail },
  { label: 'Sujet', value: draftSubject },
])}
<p style="margin:0 0 12px">Si vous êtes au bureau (réseau local), relisez et validez depuis ce lien — vous pouvez aussi y modifier le texte avant envoi :</p>
${buildActionLink(approvalLink, 'Relire et valider la réponse')}
<p style="margin:0 0 12px;color:#6b7280;font-size:12px">Ce lien est à usage unique et expire dans 24 heures.</p>
<p style="margin:0 0 12px"><strong>Si vous n'êtes pas au bureau</strong> (hors réseau local), répondez simplement à cet email avec le mot <strong>« J'approuve »</strong> pour envoyer la réponse telle quelle ci-dessous, ou <strong>« Je rejette »</strong> pour l'annuler.</p>
<blockquote style="border-left:3px solid #ccc;margin:12px 0;padding:8px 16px;color:#444">${draftContent}</blockquote>`,
  });
}

async function sendDraftPendingReminderEmail({ recipientEmail, recipientName, draftId, draftSubject, draftRecipientEmail, draftContent, minutesWaiting, approvalToken }) {
  const frontendUrl = resolveFrontendUrl(await getSystemSettings());
  const approvalLink = `${frontendUrl}/approve/${approvalToken}`;
  const subject = `[Relance] Réponse IA en attente de validation depuis ${minutesWaiting} min`;
  const bodyHtml = buildDraftPendingReminderHtml({ recipientName, draftSubject, draftRecipientEmail, draftContent, minutesWaiting, approvalLink });
  return sendEmail({ to: recipientEmail, subject, bodyHtml, saveAsMessage: false });
}

// ── Template : Réinitialisation de mot de passe ──────────────────────────────
// Envoie le lien de réinitialisation à un utilisateur qui a cliqué "mot de passe oublié"
async function sendPasswordResetLinkEmail({ recipientEmail, recipientName, resetToken }) {
  const frontendUrl = resolveFrontendUrl(await getSystemSettings());
  const resetLink = `${frontendUrl}/reset-password/${resetToken}`;
  const subject = 'Réinitialisation de votre mot de passe';
  const bodyHtml = buildEmailLayout({
    headerTitle: 'Réinitialisation de votre mot de passe',
    children: `
<p style="margin:0 0 12px">Bonjour ${recipientName || ''},</p>
<p style="margin:0 0 12px">Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le lien ci-dessous pour en choisir un nouveau :</p>
${buildActionLink(resetLink, 'Choisir un nouveau mot de passe')}
<p style="margin:0 0 12px;color:#6b7280;font-size:12px">Ce lien est à usage unique et expire dans 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>`,
  });
  return sendEmail({ to: recipientEmail, subject, bodyHtml, saveAsMessage: false });
}

// ── Template : Mot de passe temporaire ───────────────────────────────────────
// Envoie le mot de passe temporaire généré par un admin lors d'une réinitialisation forcée
async function sendTemporaryPasswordEmail({ recipientEmail, recipientName, temporaryPassword }) {
  const frontendUrl = resolveFrontendUrl(await getSystemSettings());
  const subject = 'Votre mot de passe a été réinitialisé';
  const bodyHtml = buildEmailLayout({
    headerTitle: 'Votre mot de passe a été réinitialisé',
    children: `
<p style="margin:0 0 12px">Bonjour ${recipientName || ''},</p>
<p style="margin:0 0 12px">Un administrateur a réinitialisé votre mot de passe. Voici votre mot de passe temporaire :</p>
<p style="margin:16px 0;padding:12px 16px;background:#f4f4f4;font-family:monospace;font-size:16px;font-weight:bold;display:inline-block">${temporaryPassword}</p>
<p style="margin:0 0 12px"><strong>Vous devrez le changer dès votre prochaine connexion</strong> — l'application vous le demandera automatiquement.</p>
<p style="margin:0 0 12px">Connectez-vous ici : <a href="${frontendUrl}/login" style="color:#2563eb">${frontendUrl}/login</a></p>`,
  });
  return sendEmail({ to: recipientEmail, subject, bodyHtml, saveAsMessage: false });
}

// ── Template : Approbation Hotline ───────────────────────────────────────────
// Envoie une notification / relance aux membres de la Hotline pour un ticket en attente d'approbation (PENDING)
function buildHotlineApprovalReminderHtml({ recipientName, ticketId, ticketTitle, priority, category, requesterName, reminderCount, minutesWaiting, signature, ticketLink }) {
  const priorityLabel = buildPriorityLabel(priority);
  const priorityColor = buildPriorityColor(priority);
  return buildEmailLayout({
    headerTitle: 'Approbation requise',
    headerSubtitle: `Ticket #${ticketId}`,
    signature,
    children: `
<p style="margin:0 0 12px">Bonjour ${recipientName || 'l\'équipe Hotline'},</p>
<p style="margin:0 0 12px">Un ticket est actuellement <strong>en attente d'approbation Hotline</strong> avant d'être transmis pour traitement (en attente depuis ${minutesWaiting} minute${minutesWaiting > 1 ? 's' : ''}).</p>
${buildStyledTable([
  { label: 'Numéro de ticket', value: `<strong>#${ticketId}</strong>` },
  { label: 'Sujet', value: ticketTitle },
  { label: 'Demandeur', value: requesterName || 'Non spécifié' },
  category ? { label: 'Catégorie', value: category } : null,
  { label: 'Priorité', value: `<strong style="color:${priorityColor}">${priorityLabel}</strong>` },
  reminderCount > 0 ? { label: 'Relance n°', value: `<strong>${reminderCount}</strong>` } : null,
].filter(Boolean))}
${buildActionLink(ticketLink, 'Examiner et approuver le ticket')}
<p style="margin:0 0 12px">Vous pouvez corriger les champs (catégorie, priorité, technicien, etc.) avant de cliquer sur "Approuver".</p>`,
  });
}

async function sendHotlineApprovalReminderEmail({ recipientEmail, recipientName, ticketId, ticketTitle, priority, category, requesterName, reminderCount, minutesWaiting }) {
  const frontendUrl = resolveFrontendUrl(await getSystemSettings());
  const ticketLink = `${frontendUrl}/tickets/${ticketId}`;
  const subject = reminderCount > 0
    ? `[Relance #${reminderCount}] Ticket #${ticketId} en attente d'approbation Hotline depuis ${minutesWaiting} min`
    : `[Validation Hotline] Nouveau ticket #${ticketId} en attente d'approbation`;
  const signature = await getEmailSignature();
  const bodyHtml = buildHotlineApprovalReminderHtml({ recipientName, ticketId, ticketTitle, priority, category, requesterName, reminderCount, minutesWaiting, signature, ticketLink });

  return sendEmail({ to: recipientEmail, subject, bodyHtml, saveAsMessage: false });
}

// ── Notifications demandeur : Approbation & Résolution ──────────────────────

// ── Template : Approbation ticket ────────────────────────────────────────────
// Envoie un email au demandeur quand son ticket est APPROUVÉ (comme GLPI)
function buildApprovalNotificationHtml({ requesterName, ticketId, ticketTitle, status, priority, category, assignedToName, content, signature, ticketLink }) {
  const priorityLabel = { P1: 'Critique', P2: 'Haute', P3: 'Moyenne', P4: 'Basse' }[priority] || priority || 'Moyenne';
  const priorityColor = { P1: '#dc2626', P2: '#d97706', P3: '#2563eb', P4: '#16a34a' }[priority] || '#2563eb';
  return buildEmailLayout({
    headerTitle: 'Votre demande a bien été prise en compte',
    headerSubtitle: `Ticket #${ticketId}`,
    signature,
    children: `
<p style="margin:0 0 12px">Bonjour ${requesterName || ''},</p>
<p style="margin:0 0 12px">Nous vous confirmons que votre demande a bien été <strong style="color:#16a34a">prise en compte</strong> et votre ticket est validé par notre équipe support.</p>
${buildStyledTable([
  { label: 'Numéro de ticket', value: `<strong>#${ticketId}</strong>` },
  { label: 'Sujet', value: `<strong>${ticketTitle}</strong>` },
  { label: 'Statut', value: `<strong style="color:#16a34a">Approuvé & Pris en charge</strong>` },
  category ? { label: 'Catégorie', value: category } : null,
  { label: 'Priorité', value: `<strong style="color:${priorityColor}">${priorityLabel}</strong>` },
  assignedToName ? { label: 'Technicien assigné', value: `<strong>${assignedToName}</strong>` } : null,
  content ? { label: 'Description', value: `${content.substring(0, 500)}${content.length > 500 ? '…' : ''}`, preWrap: true } : null,
].filter(Boolean))}
<p style="margin:0 0 12px">Vous pouvez suivre l'avancement de votre demande et échanger avec le support directement depuis le portail.</p>
${buildActionLink(ticketLink, 'Consulter mon ticket')}`,
  });
}

// inReplyToGraphMessageId + conversationId + inReplyTo : quand le ticket provient d'un email,
// la confirmation part en RÉPONSE dans le fil Outlook d'origine (createReply) plutôt qu'en email
// isolé — les personnes en copie de la demande d'origine (cc) restent dans la boucle.
// Enveloppe le contenu d'un brouillon IA au moment de l'ENVOI dans le gabarit commun
// (bandeau « Réponse à votre demande » + signature FRAÎCHE lue en base).
//
// Contexte : les brouillons CONVERSATION_FOLLOWUP sont désormais stockés BRUTS (replyHtml de
// l'IA, sans gabarit) pour que la signature configurée dans Paramètres soit toujours celle du
// jour de l'envoi — même pour un brouillon généré avant un changement de signature.
//
// Compat : les brouillons plus anciens (ou créés via le webhook n8n) contiennent déjà le
// gabarit complet avec une signature figée. On les détecte et on les laisse tels quels pour
// ne jamais envelopper deux fois (pas de double bandeau ni de double signature).
// Heuristique de détection (sans dépendre du libellé du bandeau) :
//  - le gabarit insère la signature en cid:logo-signature → présent = déjà enveloppé ;
//  - le contenu brut de l'IA ne contient jamais la signature configurée (ni la par défaut),
//    donc leur présence = déjà enveloppé aussi.
function isDraftContentAlreadyWrapped(content, signature) {
  if (!content) return false;
  if (content.includes('cid:logo-signature')) return true;
  const plainSignature = (signature || DEFAULT_EMAIL_SIGNATURE || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (plainSignature.length > 10) {
    const plainContent = content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
    if (plainContent.includes(plainSignature)) return true;
  }
  return false;
}

// À appeler par tous les points d'envoi d'un brouillon IA (approbation locale, distante, par
// réponse email ou approbation de ticket). Retourne le HTML final à mettre dans bodyHtml.
async function wrapDraftContentForSend({ content, ticketId }) {
  if (!content) return content;
  const signature = await getEmailSignature();
  if (isDraftContentAlreadyWrapped(content, signature)) return content;
  return buildEmailLayout({
    headerTitle: 'Réponse à votre demande',
    headerSubtitle: ticketId ? `Ticket #${ticketId}` : undefined,
    children: content,
    signature,
  });
}

// Envoi UNIFIÉ d'un brouillon IA approuvé — utilisé par tous les chemins d'approbation
// (locale depuis /email-drafts, approbation de ticket, lien public, réponse email) pour un
// comportement homogène :
//  - contenu enveloppé À L'ENVOI dans le gabarit commun avec la signature FRAÎCHE (jour) ;
//  - placeholder #EN_ATTENTE remplacé par le vrai numéro (sujet + corps) ;
//  - réponse dans le fil Outlook d'origine (inReplyToGraphMessageId du brouillon, sinon
//    en secours le dernier message entrant du ticket) ;
//  - CC = personnes en copie de la demande d'origine : celui fourni par l'appelant, sinon
//    celui stocké sur le brouillon, sinon celui du dernier message entrant. Le destinataire
//    principal et la boîte support (expéditeur) ne sont jamais dupliqués (géré par sendEmail).
async function sendAiDraftEmail({
  ticketId,
  draft = null,
  to,
  cc = null,
  subject = null,
  content = null,
  inReplyToGraphMessageId = null,
  conversationId = null,
  inReplyTo = null,
}) {
  const effectiveTicketId = ticketId || draft?.ticketId || null;
  const displayId = effectiveTicketId || 'N/A';
  const finalContent = (content !== null && content !== undefined ? content : draft?.proposedContent || '')
    .replaceAll('#EN_ATTENTE', `#${displayId}`);
  const finalSubject = (subject !== null && subject !== undefined ? subject : draft?.subject || '')
    .replaceAll('#EN_ATTENTE', `#${displayId}`);

  let replyId = inReplyToGraphMessageId || draft?.inReplyToGraphMessageId || null;
  let convId = conversationId || draft?.outlookConversationId || null;
  let replyHeader = inReplyTo || null;
  // CC effectif : explicite (même vide = choix de l'appelant) → brouillon.
  // ⚠️ Le repli sur le message entrant est TOUJOURS évalué ci-dessous (fusion), car les CC
  // pertinents sont ceux de la DEMANDE D'ORIGINE, pas ceux du dernier email du fil (un
  // brouillon de relance stocke les CC du message de relance, souvent vide).
  let effectiveCc = Array.isArray(cc) ? cc : (Array.isArray(draft?.ccRecipients) ? draft.ccRecipients : []);
  // Destinataires « To » additionnels : la liste To du message d'origine (celle du brouillon
  // si elle a été capturée, sinon celle du premier message entrant) — c'est là que vivent les
  // adresses des BOÎTES DE DIFFUSION par lesquelles la demande est arrivée. Une réponse « Répondre
  // à tous » doit remettre le groupe dans la boucle, sinon le canal (ex. hotline@…) ne voit
  // jamais la réponse. Le destinataire principal reste `to` (l'expéditeur d'origine).
  let extraTo = Array.isArray(draft?.recipients) ? draft.recipients : null;

  const needFirstInbound = !!effectiveTicketId && (!replyId || !extraTo);
  const lastInbound = needFirstInbound || !!effectiveTicketId
    ? await prisma.ticketMessage.findFirst({
        where: { ticketId: effectiveTicketId, direction: 'INBOUND', outlookMessageId: { not: null } },
        orderBy: { timestamp: 'desc' },
        select: { outlookMessageId: true, ccRecipients: true, recipients: true, conversationId: true, internetMessageId: true },
      })
    : null;
  // Premier message entrant = la demande d'origine : source de vérité des CC et de la liste To
  // (boîtes de diffusion comprises) — le dernier message entrant ne porte que le fil récent.
  const firstInbound = effectiveTicketId
    ? await prisma.ticketMessage.findFirst({
        where: { ticketId: effectiveTicketId, direction: 'INBOUND', outlookMessageId: { not: null } },
        orderBy: { timestamp: 'asc' },
        select: { outlookMessageId: true, ccRecipients: true, recipients: true, conversationId: true, internetMessageId: true },
      })
    : null;

  if (!replyId && lastInbound) {
    replyId = lastInbound.outlookMessageId || null;
    convId = convId || lastInbound.conversationId || null;
    replyHeader = replyHeader || lastInbound.internetMessageId || null;
  }

  // Fusion des CC : CC explicites/brouillon + CC de la demande d'origine (sans doublons).
  // Le destinataire principal et la boîte support sont exclus plus bas (toNorm + filtre sendEmail).
  const ccMerge = (list) => (list || [])
    .map((a) => String(a || '').toLowerCase().trim())
    .filter(Boolean);
  const toNorm = ccMerge(Array.isArray(to) ? to : [to]);
  const seen = new Set(toNorm);
  const mergedCc = [];
  for (const addr of [...ccMerge(effectiveCc), ...ccMerge(firstInbound?.ccRecipients), ...ccMerge(lastInbound?.ccRecipients)]) {
    if (!seen.has(addr)) {
      seen.add(addr);
      mergedCc.push(addr);
    }
  }
  effectiveCc = mergedCc;

  // Fusion des To additionnels : To du brouillon (si capturé) + To de la demande d'origine,
  // en excluant tout ce qui est déjà destinataire principal ou CC (le groupe peut arriver
  // dans les deux selon la façon dont le demandeur a adressé son mail).
  const extraToMerged = [];
  for (const addr of [...ccMerge(extraTo), ...ccMerge(firstInbound?.recipients)]) {
    if (!addr || seen.has(addr)) continue;
    seen.add(addr);
    extraToMerged.push(addr);
  }
  const finalTo = Array.isArray(to) ? [...to, ...extraToMerged] : [to, ...extraToMerged];

  return sendEmail({
    ticketId: effectiveTicketId,
    to: finalTo,
    cc: effectiveCc,
    subject: finalSubject,
    bodyHtml: await wrapDraftContentForSend({ content: finalContent, ticketId: effectiveTicketId }),
    saveAsMessage: true,
    inReplyToGraphMessageId: replyId,
    conversationId: convId,
    inReplyTo: replyHeader,
  });
}

async function sendApprovalNotificationEmail({ ticketId, ticketTitle, status, priority, category, assignedToName, requesterEmail, requesterName, content, cc = [], toExtra = [], inReplyToGraphMessageId = null, conversationId = null, inReplyTo = null }) {
  const settings = await getSystemSettings();
  if (settings.emailApprovalEnabled === false) return null;
  const frontendUrl = resolveFrontendUrl(settings);
  const ticketLink = `${frontendUrl}/tickets/${ticketId}`;
  const signature = await getEmailSignature();
  const subject = `[Ticket #${ticketId}] Prise en compte — ${ticketTitle}`;
  const bodyHtml = buildApprovalNotificationHtml({ requesterName, ticketId, ticketTitle, status, priority, category, assignedToName, content, signature, ticketLink });

  // Sémantique « Répondre à tous » : derrière le demandeur, on remet la liste To d'origine
  // (boîtes de diffusion comprises) — sans doublon avec le demandeur ni avec les CC.
  const seen = new Set([String(requesterEmail || '').toLowerCase().trim()]);
  const ccNorm = (cc || []).map((a) => String(a || '').toLowerCase().trim()).filter(Boolean);
  ccNorm.forEach((a) => seen.add(a));
  const approvalTo = [requesterEmail];
  for (const addr of (Array.isArray(toExtra) ? toExtra : [])) {
    const norm = String(addr || '').toLowerCase().trim();
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      approvalTo.push(addr);
    }
  }

  return sendEmail({ ticketId, to: approvalTo, cc, subject, bodyHtml, saveAsMessage: true, inReplyToGraphMessageId, conversationId, inReplyTo });
}

// ── Template : Résolution ticket ─────────────────────────────────────────────
// Envoie un email au demandeur 10 minutes après la résolution (comme GLPI)
function buildResolvedNotificationHtml({ requesterName, ticketId, ticketTitle, priority, category, assignedToName, content, signature, ticketLink }) {
  const priorityLabel = { P1: 'Critique', P2: 'Haute', P3: 'Moyenne', P4: 'Basse' }[priority] || priority;
  const priorityColor = { P1: '#dc2626', P2: '#d97706', P3: '#2563eb', P4: '#16a34a' }[priority] || '#666';
  return buildEmailLayout({
    headerTitle: 'Votre demande a été résolue',
    headerSubtitle: `Ticket #${ticketId}`,
    signature,
    children: `
<p style="margin:0 0 12px">Bonjour ${requesterName || ''},</p>
<p style="margin:0 0 12px">Votre demande a été <strong style="color:#2563eb">résolue</strong> par notre équipe support.</p>
${buildStyledTable([
  { label: 'Numéro de ticket', value: `<strong>#${ticketId}</strong>` },
  { label: 'Sujet', value: `<strong>${ticketTitle}</strong>` },
  { label: 'Statut', value: `<strong style="color:#2563eb">Résolu</strong>` },
  category ? { label: 'Catégorie', value: category } : null,
  { label: 'Priorité', value: `<strong style="color:${priorityColor}">${priorityLabel}</strong>` },
  assignedToName ? { label: 'Technicien', value: assignedToName } : null,
  content ? { label: 'Description', value: `${content.substring(0, 500)}${content.length > 500 ? '…' : ''}`, preWrap: true } : null,
].filter(Boolean))}
<p style="margin:0 0 12px">Si vous pensez que le problème n'est pas entièrement résolu, vous pouvez rouvrir le ticket depuis le portail.</p>
${buildActionLink(ticketLink, 'Voir mon ticket')}`,
  });
}

async function sendResolvedNotificationEmail({ ticketId, ticketTitle, priority, category, assignedToName, requesterEmail, requesterName, content }) {
  const settings = await getSystemSettings();
  if (settings.emailResolvedEnabled === false) return null;
  const frontendUrl = resolveFrontendUrl(settings);
  const ticketLink = `${frontendUrl}/tickets/${ticketId}`;
  const signature = await getEmailSignature();
  const subject = `[Ticket #${ticketId}] Résolu — ${ticketTitle}`;
  const bodyHtml = buildResolvedNotificationHtml({ requesterName, ticketId, ticketTitle, priority, category, assignedToName, content, signature, ticketLink });

  return sendEmail({ ticketId, to: requesterEmail, subject, bodyHtml, saveAsMessage: false });
}

// ── Template : Notification création de ticket ───────────────────────────────
function buildTicketCreationNotificationHtml({ displayId, ticketTitle, requesterName, requesterEmail, category, priority, locationName, content, signature, ticketLink }) {
  const PRIORITY_LABEL = { P1: 'Critique', P2: 'Haute', P3: 'Moyenne', P4: 'Basse' };
  return buildEmailLayout({
    headerTitle: 'Nouveau ticket créé',
    headerSubtitle: `Ticket #${displayId}`,
    signature,
    children: `
<p style="margin:0 0 12px">Bonjour,</p>
<p style="margin:0 0 12px">Un nouveau ticket vient d'être créé par un demandeur.</p>
${buildStyledTable([
  { label: 'Numéro de ticket', value: `<strong>#${displayId}</strong>` },
  { label: 'Sujet', value: `<strong>${ticketTitle}</strong>` },
  { label: 'Demandeur', value: `${requesterName || 'Inconnu'}${requesterEmail ? ` (${requesterEmail})` : ''}` },
  category ? { label: 'Catégorie', value: category } : null,
  priority ? { label: 'Priorité', value: PRIORITY_LABEL[priority] || priority } : null,
  locationName ? { label: 'Lieu', value: locationName } : null,
  content ? { label: 'Description', value: `${content.substring(0, 500)}${content.length > 500 ? '…' : ''}`, preWrap: true } : null,
].filter(Boolean))}
${buildActionLink(ticketLink, 'Voir le ticket')}`,
  });
}

// Notifie les boîtes mail configurées (SystemSettings.ticketCreationEmailRecipients) quand un
// ticket est créé par un demandeur. Désactivable via ticketCreationEmailEnabled ; best-effort :
// un échec d'envoi ne doit jamais faire échouer la création du ticket.
async function sendTicketCreationNotification(ticket) {
  try {
    const settings = await getSystemSettings();
    if (settings.ticketCreationEmailEnabled === false) return null;

    const recipients = (settings.ticketCreationEmailRecipients || []).filter(Boolean);
    if (recipients.length === 0) return null;

    const requester = ticket.requester
      ? ticket.requester
      : ticket.requesterId
        ? await prisma.user.findUnique({ where: { id: ticket.requesterId }, select: { fullName: true, email: true } })
        : null;

    const displayId = ticket.glpiTicketId || ticket.id || 'N/A';
    const subject = `[Ticket #${displayId}] ${ticket.title || 'Nouveau ticket'}`;
    const signature = await getEmailSignature();
    const frontendUrl = resolveFrontendUrl(settings);
    const ticketLink = `${frontendUrl}/tickets/${ticket.id}`;

    const content = (ticket.content || '').replace(/<[^>]+>/g, ' ').trim();

    const bodyHtml = buildTicketCreationNotificationHtml({
      displayId,
      ticketTitle: ticket.title || '',
      requesterName: requester?.fullName,
      requesterEmail: requester?.email,
      category: ticket.category,
      priority: ticket.priority,
      locationName: ticket.locationName,
      content,
      signature,
      ticketLink,
    });

    await sendEmail({ ticketId: ticket.id, to: recipients, subject, bodyHtml, saveAsMessage: false });
    return { sent: true, recipients };
  } catch (err) {
    console.error('[emailSender] Notification création ticket échouée:', err.message);
    return null;
  }
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
  sendAssignmentNotificationEmail,
  sendHotlineApprovalReminderEmail,
  sendSlaBreachEmail,
  sendDueDateEmail,
  sendEscalationEmail,
  sendRequesterEscalationEmail,
  sendTicketStatusNotification,
  sendApprovalNotificationEmail,
  sendResolvedNotificationEmail,
  sendTicketCreationNotification,
  buildEmailLayout,
  buildAcknowledgementHtml,
  buildReminderHtml,
  buildKnownIncidentNotificationHtml,
  buildMajorIncidentResolvedHtml,
  buildAssignmentNotificationHtml,
  buildSlaBreachHtml,
  buildDueDateHtml,
  buildStatusChangeHtml,
  buildEscalationEmailHtml,
  buildRequesterEscalationEmailHtml,
  buildDraftPendingReminderHtml,
  buildHotlineApprovalReminderHtml,
  buildApprovalNotificationHtml,
  buildResolvedNotificationHtml,
  buildTicketCreationNotificationHtml,
  getEmailSignature,
  wrapDraftContentForSend,
  sendAiDraftEmail,
};