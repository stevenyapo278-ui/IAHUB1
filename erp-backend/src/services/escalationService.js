const prisma = require('../prismaClient');
const { logEvent } = require('./ticketEvent');
const { emitTicketEscalated } = require('../utils/socket');
const { sendEscalationEmail } = require('./emailSender');

const ACTIVE_STATUSES = ['NEW', 'OPEN', 'PENDING'];

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
  try {
    const admins = await prisma.user.findMany({
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
