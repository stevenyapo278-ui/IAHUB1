// Moniteur des échéances manuelles des tickets (dueDate).
// Tourne à dueDateMonitorIntervalSeconds (Paramètres > Automatisation), 0 = désactivé.
// Un ticket est signalé une seule fois : dueDateNotifiedAt est posé à la première alerte et
// réarmé (remis à null) quand la dueDate change (PATCH /tickets/:id).

const prisma = require('../prismaClient');
const { logEvent } = require('./ticketEvent');
const { persistNotification } = require('../utils/socket');
const { sendDueDateEmail } = require('./emailSender');

const CLOSED_STATUSES = ['SOLVED', 'CLOSED'];

async function runDueDateMonitor() {
  const now = new Date();

  const overdue = await prisma.ticket.findMany({
    where: {
      dueDate: { not: null, lt: now },
      dueDateNotifiedAt: null,
      status: { notIn: CLOSED_STATUSES },
    },
    include: {
      assignedTo: { select: { id: true, email: true, fullName: true } },
      observers: { select: { id: true } },
    },
  });

  let flaggedCount = 0;
  for (const ticket of overdue) {
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { dueDateNotifiedAt: now },
    });

    await logEvent(ticket.id, 'DUE_DATE_BREACHED', 'SYSTEM', {
      dueDate: ticket.dueDate,
      breachedAt: now,
      overdueHours: Math.round((now - ticket.dueDate) / 3600000),
    });

    // Notification persistée : technicien assigné + observateurs
    const targets = new Set();
    if (ticket.assignedToId) targets.add(ticket.assignedToId);
    (ticket.observers || []).forEach((o) => targets.add(o.id));
    for (const userId of targets) {
      await persistNotification({
        userId,
        type: 'ticket_updated',
        title: 'Échéance dépassée',
        message: `#${ticket.id} — ${ticket.title}`,
        link: `/tickets/${ticket.id}`,
        metadata: { dueDate: ticket.dueDate, status: ticket.status },
      });
    }

    // Email au technicien assigné (si présent)
    if (ticket.assignedTo?.email) {
      sendDueDateEmail({
        ticketId: ticket.id,
        ticketTitle: ticket.title,
        priority: ticket.priority,
        dueDate: ticket.dueDate,
        technicianEmail: ticket.assignedTo.email,
        technicianName: ticket.assignedTo.fullName,
      }).catch((err) => console.error(`[dueDateService] Échec email échéance (ticket ${ticket.id}):`, err.message));
    }

    flaggedCount += 1;
  }

  return { flaggedCount };
}

module.exports = { runDueDateMonitor, CLOSED_STATUSES };
