const prisma = require('../prismaClient');
const { getSystemSettings } = require('./systemSettings');
const { sendTechnicianReminderEmail } = require('./emailSender');
const { logEvent } = require('./ticketEvent');

// ── Rappels techniciens (Paramètres > Automatisation > Rappels techniciens) ──
// Dès qu'un ticket OUVERT (pas Résolu/Fermé) dépasse le délai configuré (ex. 24 h)
// sans prise en charge, un email part au(x) destinataire(s) technique(s) :
//   • ticket assigné      → le technicien assigné, si aucune activité (suivi ou
//                           réponse sortante) depuis le délai ;
//   • ticket non assigné  → les membres de l'équipe (et son email de groupe),
//                           si le ticket ouvert dépasse le délai depuis sa création.
// Contrairement aux relances destinées au demandeur (reminderScheduler, brouillons
// à valider), l'envoi est DIRECT : le réglage posé dans les Paramètres vaut
// décision. Chaque envoi est tracé en TicketEvent REMINDER_SENT
// (payload.kind = 'TECHNICIAN') qui sert aussi d'anti-doublon :
//   • techReminderRepeatHours = 0 (défaut) → un seul rappel par ticket ;
//   • sinon renvoi toutes les X h tant que le critère persiste encore.

const OPEN_STATUSES = ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER'];
const HOUR_MS = 60 * 60 * 1000;

// Libellés français des motifs, repris dans l'email et le journal d'activité.
const CRITERIA_LABELS = {
  NO_ACTIVITY: 'assigné sans activité',
  UNASSIGNED: 'ouvert sans technicien assigné',
};

// Dernière activité « côté agent » du ticket : suivi (Followup) ou réponse sortante
// (TicketMessage OUTBOUND), sinon la création. Les réponses du DEMANDEUR ne
// réinitialisent pas le compteur — c'est précisément elles qui rendent le rappel
// utile (le technicien doit réagir).
function lastAgentActivityAt(ticket, requesterId) {
  let latest = new Date(ticket.createdAt).getTime();
  for (const msg of ticket.messages || []) {
    const ts = new Date(msg.timestamp).getTime();
    if (ts > latest) latest = ts;
  }
  for (const fu of ticket.followups || []) {
    // Un suivi public rédigé par le demandeur n'est pas une activité technicien.
    if (fu.authorId != null && requesterId != null && fu.authorId === requesterId) continue;
    const ts = new Date(fu.createdAt).getTime();
    if (ts > latest) latest = ts;
  }
  return latest;
}

async function runTechnicianReminderScheduler() {
  const settings = await getSystemSettings();
  if (!settings.techReminderEnabled) return [];

  const delayHours = Math.max(1, Number(settings.techReminderDelayHours) || 24);
  const repeatHours = Math.max(0, Number(settings.techReminderRepeatHours) || 0);
  const onNoActivity = settings.techReminderOnNoActivity !== false;
  const onUnassigned = settings.techReminderOnUnassigned !== false;
  if (!onNoActivity && !onUnassigned) return [];

  const tickets = await prisma.ticket.findMany({
    where: { status: { in: OPEN_STATUSES } },
    include: {
      assignedTo: { select: { id: true, email: true, fullName: true } },
      team: {
        select: {
          id: true,
          name: true,
          groupEmail: true,
          members: { select: { id: true, email: true, fullName: true } },
        },
      },
      messages: {
        where: { direction: 'OUTBOUND' },
        orderBy: { timestamp: 'desc' },
        take: 1,
        select: { timestamp: true },
      },
      followups: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { createdAt: true, authorId: true },
      },
    },
  });
  if (tickets.length === 0) return [];

  // Anti-doublon : dernier rappel technicien par ticket (REMINDER_SENT + kind TECHNICIAN).
  const events = await prisma.ticketEvent.findMany({
    where: { ticketId: { in: tickets.map((t) => t.id) }, type: 'REMINDER_SENT' },
    orderBy: { createdAt: 'desc' },
    select: { ticketId: true, createdAt: true, payload: true },
  });
  const lastReminderAt = new Map();
  for (const ev of events) {
    if (ev.payload?.kind !== 'TECHNICIAN') continue;
    if (!lastReminderAt.has(ev.ticketId)) lastReminderAt.set(ev.ticketId, new Date(ev.createdAt).getTime());
  }

  const now = Date.now();
  const results = [];

  for (const ticket of tickets) {
    try {
      const isUnassigned = !ticket.assignedToId;
      if (isUnassigned ? !onUnassigned : !onNoActivity) continue;

      const hoursWaiting = Math.floor((now - lastAgentActivityAt(ticket, ticket.requesterId)) / HOUR_MS);
      if (hoursWaiting < delayHours) continue;

      const lastAt = lastReminderAt.get(ticket.id);
      if (lastAt && (repeatHours <= 0 || (now - lastAt) / HOUR_MS < repeatHours)) continue;

      const criteria = isUnassigned ? 'UNASSIGNED' : 'NO_ACTIVITY';
      const criteriaLabels = [CRITERIA_LABELS[criteria]];

      // Destinataires : le technicien assigné, ou l'équipe entière si non assigné.
      let recipients;
      let technicianName;
      if (!isUnassigned) {
        if (!ticket.assignedTo?.email) continue; // technicien sans adresse : rien à envoyer
        recipients = [ticket.assignedTo.email];
        technicianName = ticket.assignedTo.fullName;
      } else {
        const seen = new Set();
        recipients = [];
        for (const member of ticket.team?.members || []) {
          if (!member.email || seen.has(member.email.toLowerCase())) continue;
          seen.add(member.email.toLowerCase());
          recipients.push(member.email);
        }
        if (ticket.team?.groupEmail && !seen.has(ticket.team.groupEmail.toLowerCase())) {
          recipients.push(ticket.team.groupEmail);
        }
        if (recipients.length === 0) continue; // équipe vide/inconnue : aucun destinataire
      }

      const sent = [];
      for (const recipient of recipients) {
        await sendTechnicianReminderEmail({
          ticketId: ticket.id,
          ticketTitle: ticket.title,
          priority: ticket.priority,
          category: ticket.category || null,
          teamName: ticket.team?.name || null,
          to: recipient,
          technicianName,
          hoursWaiting,
          criteriaLabels,
        });
        sent.push(recipient);
      }

      // Tracé + anti-doublon pour les passes suivantes. Un échec de journalisation ne
      // doit pas faire échouer l'envoi déjà effectué (try/catch enveloppe le ticket).
      await logEvent(ticket.id, 'REMINDER_SENT', 'SYSTEM', {
        kind: 'TECHNICIAN',
        criteria,
        recipients: sent,
        hoursWaiting,
        delayHours,
      });

      results.push({ ticketId: ticket.id, action: 'TECH_REMINDER_SENT', criteria, recipients: sent.length });
    } catch (err) {
      results.push({ ticketId: ticket.id, action: 'ERROR', error: err.message });
    }
  }

  return results;
}

module.exports = { runTechnicianReminderScheduler, CRITERIA_LABELS };
