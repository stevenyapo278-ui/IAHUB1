const {
  buildKnownIncidentNotificationHtml,
  buildAssignmentNotificationHtml,
  buildSlaBreachHtml,
  buildDueDateHtml,
  buildStatusChangeHtml,
  buildResolvedNotificationHtml,
  buildEscalationEmailHtml,
  buildRequesterEscalationEmailHtml,
  buildMajorIncidentResolvedHtml,
  buildApprovalNotificationHtml,
  buildNeedsHumanReviewNotificationHtml,
} = require('./emailSender');
const { EMAIL_TEMPLATE_REGISTRY, renderTemplate } = require('./emailTemplateRegistry');

// ═══════════════════════════════════════════════════════════════════════════════
// Échantillons des emails de notification modifiables : rendus avec des données
// fictives (ticket #999) pour l'aperçu UI (GET /api/email-templates) et les emails
// de test (POST /system-settings/test-email). Mêmes builders que l'envoi réel.
// ═══════════════════════════════════════════════════════════════════════════════

const SAMPLE_TICKET = 999;
const SAMPLE_TITLE = 'Test template email';

// Valeurs des placeholders par clé (doivent correspondre à registry.placeholders).
// emailSender construit le même type de ctx à chaque envoi réel.
function sampleTemplateCtx(key, recipientName = 'Test') {
  const toName = recipientName || 'Test';
  switch (key) {
    case 'known_incident':
      return { ticketId: SAMPLE_TICKET, subject: 'Panne réseau site Abidjan', toName, impactedCount: 12 };
    case 'assignment':
      return { ticketId: SAMPLE_TICKET, subject: SAMPLE_TITLE, toName, priority: 'P2', category: 'IT — Matériel', teamName: 'Support IT' };
    case 'sla_breach':
    case 'due_date':
      return { ticketId: SAMPLE_TICKET, subject: SAMPLE_TITLE, toName, priority: 'P2' };
    case 'status_change':
      return { ticketId: SAMPLE_TICKET, subject: SAMPLE_TITLE, toName, statusLabel: 'En cours (Attribué)', priority: 'P2', category: 'IT — Matériel' };
    case 'resolved':
    case 'approval':
      return { ticketId: SAMPLE_TICKET, subject: SAMPLE_TITLE, toName, priority: 'P2', category: 'IT — Matériel', assignedToName: 'Support IT' };
    case 'escalation':
    case 'escalation_requester':
      return { ticketId: SAMPLE_TICKET, subject: SAMPLE_TITLE, toName, priority: 'P2', reason: 'SLA de réponse dépassé', targetTeam: 'Support IT' };
    case 'major_incident_resolved':
      return { ticketId: SAMPLE_TICKET, subject: SAMPLE_TITLE };
    case 'needs_human_review':
      return { subject: 'Demande d\'accès VPN', category: 'IT — Matériel', priority: 'Moyenne', reason: 'Confiance IA insuffisante' };
    default:
      return { ticketId: SAMPLE_TICKET, subject: SAMPLE_TITLE, toName };
  }
}

// Sujets d'échantillon pour les clés dont le défaut est dynamique (defaultSubject: null).
const SAMPLE_SUBJECTS = {
  escalation: `[Transfert] Ticket #${SAMPLE_TICKET} : ${SAMPLE_TITLE}`,
  escalation_requester: `[Ticket #${SAMPLE_TICKET}] Votre demande a été transmise à l'équipe Support IT`,
};

// Construction du HTML d'échantillon via le builder réel (customMessage = surcharge
// rendue, ou undefined → le builder retombe sur son propre défaut codé en dur).
function buildSampleHtml(key, { ctx, customMessage, signature, links }) {
  switch (key) {
    case 'known_incident':
      return buildKnownIncidentNotificationHtml({
        toName: ctx.toName, glpiTicketId: ctx.ticketId, ticketId: ctx.ticketId,
        originalSubject: ctx.subject, isMajor: true, impactedCount: ctx.impactedCount,
        signature, ticketLink: links.ticket, customMessage,
      });
    case 'assignment':
      return buildAssignmentNotificationHtml({
        technicianName: ctx.toName, glpiTicketId: ctx.ticketId, ticketId: ctx.ticketId,
        ticketTitle: ctx.subject, priority: ctx.priority, category: ctx.category,
        teamName: ctx.teamName, signature, ticketLink: links.ticket, customMessage,
      });
    case 'sla_breach':
      return buildSlaBreachHtml({
        technicianName: ctx.toName, glpiTicketId: ctx.ticketId, ticketId: ctx.ticketId,
        ticketTitle: ctx.subject, priority: ctx.priority,
        slaResponseDueAt: new Date(Date.now() - 3600000).toISOString(),
        signature, ticketLink: links.ticket, customMessage,
      });
    case 'due_date':
      return buildDueDateHtml({
        technicianName: ctx.toName, glpiTicketId: ctx.ticketId, ticketId: ctx.ticketId,
        ticketTitle: ctx.subject, priority: ctx.priority,
        dueDate: new Date(Date.now() - 7200000).toISOString(),
        signature, ticketLink: links.ticket, customMessage,
      });
    case 'status_change':
      return buildStatusChangeHtml({
        recipientName: ctx.toName, glpiTicketId: ctx.ticketId, ticketId: ctx.ticketId,
        ticketTitle: ctx.subject, status: 'OPEN', priority: ctx.priority, category: ctx.category,
        signature, ticketLink: links.ticket, customMessage,
      });
    case 'resolved':
      return buildResolvedNotificationHtml({
        requesterName: ctx.toName, ticketId: ctx.ticketId, ticketTitle: ctx.subject,
        priority: ctx.priority, category: ctx.category, assignedToName: ctx.assignedToName,
        content: 'Description du ticket de test.', signature, ticketLink: links.ticket, customMessage,
      });
    case 'escalation':
      return buildEscalationEmailHtml({
        recipientName: ctx.toName, ticketId: ctx.ticketId, ticketTitle: ctx.subject,
        priority: ctx.priority, reason: ctx.reason, targetTeamName: ctx.targetTeam,
        signature, ticketLink: links.ticket, customMessage,
      });
    case 'escalation_requester':
      return buildRequesterEscalationEmailHtml({
        recipientName: ctx.toName, ticketId: ctx.ticketId, ticketTitle: ctx.subject,
        priority: ctx.priority, reason: ctx.reason, targetTeamName: ctx.targetTeam,
        signature, portalLink: links.portal, customMessage,
      });
    case 'major_incident_resolved':
      return buildMajorIncidentResolvedHtml({
        glpiTicketId: ctx.ticketId, ticketTitle: ctx.subject, signature, customMessage,
      });
    case 'approval':
      return buildApprovalNotificationHtml({
        requesterName: ctx.toName, ticketId: ctx.ticketId, ticketTitle: ctx.subject,
        status: 'APPROVED', priority: ctx.priority, category: ctx.category,
        assignedToName: ctx.assignedToName, content: 'Description du ticket de test.',
        signature, ticketLink: links.ticket, customMessage,
      });
    case 'needs_human_review':
      return buildNeedsHumanReviewNotificationHtml({
        senderEmail: 'client@exemple.ci', senderName: 'Client Test', subject: ctx.subject,
        category: ctx.category, priority: ctx.priority, confidence: 0.42,
        reason: ctx.reason, aiSummary: 'Résumé du message de test.',
        signature, inboxLink: links.inbox, customMessage,
      });
    default:
      return null;
  }
}

// Rend l'échantillon complet (sujet + HTML) d'une clé, avec la surcharge éventuelle.
// override : ligne EmailTemplate brute ({ subject, message }) ou null/undefined.
async function buildTemplateSample(key, { override, signature, frontendUrl, recipientName } = {}) {
  const meta = EMAIL_TEMPLATE_REGISTRY[key];
  if (!meta) return null;
  const ctx = sampleTemplateCtx(key, recipientName);
  const links = {
    ticket: `${frontendUrl || ''}/tickets/${SAMPLE_TICKET}`,
    portal: `${frontendUrl || ''}/portal`,
    inbox: `${frontendUrl || ''}/inbox`,
  };
  const subject = override?.subject
    ? renderTemplate(override.subject, ctx)
    : (meta.defaultSubject ? renderTemplate(meta.defaultSubject, ctx) : SAMPLE_SUBJECTS[key]);
  const customMessage = override?.message ? renderTemplate(override.message, ctx) : undefined;
  const html = buildSampleHtml(key, { ctx, customMessage, signature, links });
  return { subject, html };
}

module.exports = { buildTemplateSample, sampleTemplateCtx, SAMPLE_SUBJECTS };
