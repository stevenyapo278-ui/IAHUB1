const prisma = require('../prismaClient');
const { logEvent } = require('./ticketEvent');
const { emitTicketEscalated } = require('../utils/socket');
const { sendEscalationEmail, sendRequesterEscalationEmail } = require('./emailSender');

const ACTIVE_STATUSES = ['NEW', 'OPEN', 'PLANNED', 'PENDING'];

// Planifie une escalade automatique sur le ticket (règle de triage avec autoEscalateMinutes).
// Appelé à la création du ticket (pipeline email) — le moniteur déclenche l'escalade à l'échéance.
async function scheduleEscalation(ticketId, minutes, triageRuleId = null) {
  if (!minutes || minutes <= 0) return null;
  return prisma.ticket.update({
    where: { id: ticketId },
    data: { escalateAt: new Date(Date.now() + minutes * 60000), triageRuleId: triageRuleId || null },
  });
}

// Escalade réelle (partagée entre le moniteur automatique et le bouton manuel) :
// événement tracé, notification socket aux admins, email d'alerte.
async function escalateTicket(ticketId, { reason = null, actor = 'SYSTEM', source = 'auto' } = {}) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      assignedTo: { select: { id: true, email: true, fullName: true } },
      requester: { select: { id: true, email: true, fullName: true } },
      team: { select: { id: true, name: true } },
      // Fallback demandeur pour les tickets créés par email (pas d'utilisateur interne associé)
      sourceEmail: true,
      sourceName: true,
    },
  });
  if (!ticket) throw new Error('Ticket introuvable');

  const escalationLevel = (ticket.escalationLevel || 0) + 1;
  const now = new Date();

  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: { escalationLevel, escalatedAt: now, escalateAt: null },
  });

  await logEvent(ticketId, 'ESCALATED', actor, {
    source,
    reason,
    escalationLevel,
  });

  emitTicketEscalated(updated, { reason, escalationLevel });

  // Alerter les admins par email (ils n'ont pas toujours l'application ouverte)
  let admins = [];
  try {
    admins = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPERADMIN'] }, isActive: true, email: { not: null } },
      select: { email: true, fullName: true },
    });
    for (const admin of admins) {
      sendEscalationEmail({
        ticketId,
        ticketTitle: ticket.title,
        priority: ticket.priority,
        reason,
        escalationLevel,
        recipientEmail: admin.email,
        recipientName: admin.fullName,
      }).catch((err) => console.error(`[escalationService] Échec email escalade (ticket ${ticketId}):`, err.message));
    }
  } catch (err) {
    console.error('[escalationService] Échec envoi emails escalade:', err.message);
  }

  // Notifier aussi le technicien assigné et le demandeur — un même email ne doit
  // être envoyé qu'une seule fois au maximum (Set de déduplication par adresse).
  try {
    const alreadyNotified = new Set((admins || []).map((a) => a.email?.toLowerCase()).filter(Boolean));

    const technician = ticket.assignedTo;
    if (technician?.email && !alreadyNotified.has(technician.email.toLowerCase())) {
      alreadyNotified.add(technician.email.toLowerCase());
      sendEscalationEmail({
        ticketId,
        ticketTitle: ticket.title,
        priority: ticket.priority,
        reason,
        escalationLevel,
        recipientEmail: technician.email,
        recipientName: technician.fullName,
      }).catch((err) => console.error(`[escalationService] Échec email escalade technicien (ticket ${ticketId}):`, err.message));
    }

    // Demandeur : utilisateur interne du ticket, sinon expéditeur du mail d'origine (sourceEmail)
    const requesterEmail = ticket.requester?.email || ticket.sourceEmail;
    const requesterName = ticket.requester?.fullName || ticket.sourceName;
    if (requesterEmail && !alreadyNotified.has(requesterEmail.toLowerCase())) {
      sendRequesterEscalationEmail({
        ticketId,
        ticketTitle: ticket.title,
        priority: ticket.priority,
        reason,
        escalationLevel,
        recipientEmail: requesterEmail,
        recipientName: requesterName,
      }).catch((err) => console.error(`[escalationService] Échec email escalade demandeur (ticket ${ticketId}):`, err.message));
    }
  } catch (err) {
    console.error('[escalationService] Échec envoi emails technicien/demandeur:', err.message);
  }

  return updated;
}

// Moniteur : déclenche les escalades planifiées arrivées à échéance sur des tickets actifs.
// Exécuté au même cycle que le moniteur SLA (slaMonitorIntervalSeconds).
async function runEscalationMonitor() {
  const now = new Date();
  const dueTickets = await prisma.ticket.findMany({
    where: {
      status: { in: ACTIVE_STATUSES },
      escalateAt: { not: null, lte: now },
    },
    select: { id: true, title: true, priority: true },
  });

  let escalatedCount = 0;
  for (const ticket of dueTickets) {
    try {
      await escalateTicket(ticket.id, {
        reason: `Escalade automatique planifiée (règle de triage, niveau ${(ticket.escalationLevel || 0) + 1})`,
        actor: 'SYSTEM',
        source: 'auto',
      });
      escalatedCount += 1;
    } catch (err) {
      console.error(`[escalationService] Échec escalade automatique (ticket ${ticket.id}):`, err.message);
    }
  }
  return { escalatedCount };
}

module.exports = { scheduleEscalation, escalateTicket, runEscalationMonitor };
