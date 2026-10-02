// ═══════════════════════════════════════════════════════════════════════════════
// Registre des emails de notification modifiables
// (Paramètres > Notifications > « Contenu des emails »).
//
// Chaque entrée décrit UN email éditable :
// - defaultSubject : sujet par défaut sous forme de template {placeholders}.
//   null = sujet dynamique calculé par emailSender (ex. [Transfert] / [Escalade])
//   → la surcharge reste possible, mais il n'y a pas de « défaut » statique à afficher.
// - defaultMessage : bloc HTML par défaut (paragraphe d'intro après la salutation).
//   null = contenu dynamique géré par le builder (condition transfert/escalade).
// - placeholders : liste des variables disponibles ; emailSender fournit leurs valeurs
//   à chaque envoi (ctx), emailTemplateSamples fournit des valeurs d'échantillon
//   pour l'aperçu UI et les emails de test.
//
// IMPORTANT : les valeurs par défaut AFFICHÉES ici sont un miroir des chaînes codées en
// dur dans emailSender.js (les builders restent la source exécutée en production quand
// il n'y a pas de surcharge). Le test emailTemplate.test.js verrouille cette cohérence.
// ═══════════════════════════════════════════════════════════════════════════════

const EMAIL_TEMPLATE_REGISTRY = {
  known_incident: {
    label: 'Incident déjà connu',
    category: 'Automatiques (pipeline email)',
    description: "Notification envoyée au demandeur quand son email correspond à un incident existant (le demandeur est rattaché au ticket existant).",
    toggleKey: 'emailKnownIncidentEnabled',
    placeholders: ['{ticketId}', '{subject}', '{toName}', '{impactedCount}'],
    defaultSubject: '[Ticket #{ticketId}] {subject}',
    defaultMessage: `<p style="margin:0 0 12px">Votre demande a bien été prise en compte.</p>
<p style="margin:0 0 12px">Un incident déjà identifié est actuellement en cours d'investigation par nos équipes :</p>`,
  },
  assignment: {
    label: 'Assignation technicien',
    category: 'Automatiques (pipeline email)',
    description: "Email envoyé au technicien quand l'IA lui attribue automatiquement un ticket.",
    toggleKey: 'emailAssignmentEnabled',
    placeholders: ['{ticketId}', '{subject}', '{toName}', '{priority}', '{category}', '{teamName}'],
    defaultSubject: '[Ticket #{ticketId}] Nouvelle assignation — {subject}',
    defaultMessage: `<p style="margin:0 0 12px">Un nouveau ticket vient de vous être <strong>assigné automatiquement</strong> par notre système d'analyse IA.</p>`,
  },
  sla_breach: {
    label: 'Dépassement SLA',
    category: 'Automatiques (schedulers)',
    description: 'Alerte envoyée au technicien assigné quand le SLA de réponse est dépassé.',
    toggleKey: 'emailSlaBreachEnabled',
    placeholders: ['{ticketId}', '{subject}', '{toName}', '{priority}'],
    defaultSubject: '[SLA] Dépassement — Ticket #{ticketId} : {subject}',
    defaultMessage: `<p style="margin:0 0 12px">Le ticket <strong>#{ticketId} — {subject}</strong> a dépassé son délai de réponse SLA.</p>`,
  },
  due_date: {
    label: "Dépassement d'échéance",
    category: 'Automatiques (schedulers)',
    description: "Alerte envoyée au technicien assigné quand la date d'échéance manuelle est dépassée.",
    toggleKey: 'emailDueDateBreachEnabled',
    placeholders: ['{ticketId}', '{subject}', '{toName}', '{priority}'],
    defaultSubject: '[Échéance] Dépassement — Ticket #{ticketId} : {subject}',
    defaultMessage: `<p style="margin:0 0 12px">Le ticket <strong>#{ticketId} — {subject}</strong> a dépassé son <strong>échéance manuelle</strong>.</p>`,
  },
  status_change: {
    label: 'Changement de statut',
    category: 'Manuelles (actions utilisateur)',
    description: 'Notification envoyée au demandeur à chaque changement de statut du ticket.',
    toggleKey: 'emailStatusChangeEnabled',
    placeholders: ['{ticketId}', '{subject}', '{toName}', '{statusLabel}', '{priority}', '{category}'],
    defaultSubject: '[Ticket #{ticketId}] {statusLabel} — {subject}',
    defaultMessage: `<p style="margin:0 0 12px">Le statut de votre demande a changé :</p>`,
  },
  resolved: {
    label: 'Résolution (différé 10 min)',
    category: 'Manuelles (actions utilisateur)',
    description: 'Email de résolution envoyé au demandeur 10 minutes après le passage en "Résolu" (laisse un délai de correction).',
    toggleKey: 'emailResolvedEnabled',
    placeholders: ['{ticketId}', '{subject}', '{toName}', '{priority}', '{category}', '{assignedToName}'],
    defaultSubject: '[Ticket #{ticketId}] Résolu — {subject}',
    defaultMessage: `<p style="margin:0 0 12px">Votre demande a été <strong style="color:#2563eb">résolue</strong> par notre équipe support.</p>`,
  },
  escalation: {
    label: 'Escalade — équipes internes',
    category: 'Manuelles (actions utilisateur)',
    description: "Notification envoyée aux admins/techniciens quand un ticket est transféré à une autre équipe ou escaladé.",
    toggleKey: 'emailEscalationEnabled',
    placeholders: ['{ticketId}', '{subject}', '{toName}', '{priority}', '{reason}', '{targetTeam}'],
    defaultSubject: null, // dynamique : [Transfert] ou [Escalade] selon targetTeamName
    defaultMessage: null, // dynamique : ligne « transféré » ou « escaladé » selon targetTeamName
    subjectExamples: ['[Transfert] Ticket #123 : Titre du ticket', '[Escalade] Ticket #123 : Titre du ticket'],
  },
  escalation_requester: {
    label: 'Escalade — demandeur',
    category: 'Manuelles (actions utilisateur)',
    description: 'Notification envoyée au demandeur quand sa demande est transmise à une équipe ou escaladée.',
    toggleKey: 'emailEscalationEnabled',
    placeholders: ['{ticketId}', '{subject}', '{toName}', '{priority}', '{reason}', '{targetTeam}'],
    defaultSubject: null, // dynamique : transmise (avec équipe) ou escaladée
    defaultMessage: null, // dynamique : même condition sur targetTeamName
    subjectExamples: ["[Ticket #123] Votre demande a été transmise à l'équipe Support", '[Ticket #123] Votre demande a été escaladée'],
  },
  major_incident_resolved: {
    label: 'Résolution incident majeur',
    category: 'Manuelles (actions utilisateur)',
    description: 'Notification envoyée aux emails des sites impactés quand un incident majeur est résolu.',
    toggleKey: 'emailMajorIncidentResolvedEnabled',
    placeholders: ['{ticketId}', '{subject}'],
    defaultSubject: '[Ticket #{ticketId}] {subject}',
    defaultMessage: `<p style="margin:0 0 12px">L'incident <strong>#{ticketId} — {subject}</strong> a été résolu.</p>
<p style="margin:0 0 12px">Le service est maintenant rétabli. Merci de votre patience.</p>`,
  },
  approval: {
    label: 'Approbation ticket',
    category: 'Manuelles (actions utilisateur)',
    description: 'Notification envoyée au demandeur quand son ticket est approuvé par la Hotline.',
    toggleKey: 'emailApprovalEnabled',
    placeholders: ['{ticketId}', '{subject}', '{toName}', '{priority}', '{category}', '{assignedToName}'],
    defaultSubject: '[Ticket #{ticketId}] Prise en compte — {subject}',
    defaultMessage: `<p style="margin:0 0 12px">Nous vous confirmons que votre demande a bien été <strong style="color:#16a34a">prise en compte</strong> et votre ticket est validé par notre équipe support.</p>`,
  },
  needs_human_review: {
    label: 'Révision humaine',
    category: 'Automatiques (pipeline email)',
    description: "Email envoyé quand un email entrant nécessite une révision humaine (confiance IA faible, spam ambigu, etc.).",
    toggleKey: 'needsHumanReviewNotificationEnabled',
    placeholders: ['{subject}', '{category}', '{priority}', '{reason}'],
    defaultSubject: '[Révision requise] {subject}',
    defaultMessage: `<p style="margin:0 0 12px">Un email entrant nécessite une <strong style="color:#f59e0b">révision humaine</strong>. L'IA n'a pas pu traiter automatiquement ce message.</p>`,
  },
};

// Remplace les {placeholders} connus par leurs valeurs ; les placeholders inconnus sont
// laissés tels quels (jamais de crash, même si un champ manque dans le ctx).
function renderTemplate(str, ctx = {}) {
  if (typeof str !== 'string' || !str) return str;
  return str.replace(/\{(\w+)\}/g, (match, name) => (
    ctx[name] !== undefined && ctx[name] !== null ? String(ctx[name]) : match
  ));
}

module.exports = { EMAIL_TEMPLATE_REGISTRY, renderTemplate };
