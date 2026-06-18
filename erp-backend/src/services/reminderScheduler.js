const prisma = require('../prismaClient');
const { sendReminder } = require('./emailSender');
const { logEvent } = require('./ticketEvent');

function daysSince(date) {
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

// Parcourt tous les tickets WAITING_FOR_USER et envoie les relances selon la config
async function runReminderScheduler() {
  const config = await prisma.reminderConfig.findFirst({ where: { isActive: true } });
  const delays = config || { firstReminderDays: 2, secondReminderDays: 5, preCloseDays: 10, autoCloseDays: 15 };

  const tickets = await prisma.ticket.findMany({
    where: { status: 'WAITING_FOR_USER', sourceEmail: { not: null } },
  });

  const results = [];

  for (const ticket of tickets) {
    const since = daysSince(ticket.lastUserReplyAt || ticket.updatedAt);
    const count = ticket.reminderCount || 0;

    try {
      // Clôture automatique
      if (since >= delays.autoCloseDays) {
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: { status: 'CLOSED', closedAt: new Date() },
        });
        await logEvent(ticket.id, 'CLOSED_AUTO', 'SYSTEM', { reason: 'no_response', daysSinceLastReply: since });
        results.push({ ticketId: ticket.id, action: 'AUTO_CLOSED' });
        continue;
      }

      // Pré-clôture J+10
      if (since >= delays.preCloseDays && count < 3) {
        await sendReminder({
          ticketId: ticket.id,
          glpiTicketId: ticket.glpiTicketId,
          toEmail: ticket.sourceEmail,
          toName: ticket.sourceName,
          subject: ticket.title,
          reminderNumber: 3,
          isPreClose: true,
        });
        await prisma.ticket.update({ where: { id: ticket.id }, data: { reminderCount: 3, reminderSentAt: new Date() } });
        results.push({ ticketId: ticket.id, action: 'REMINDER_PRE_CLOSE' });
        continue;
      }

      // Deuxième relance J+5
      if (since >= delays.secondReminderDays && count < 2) {
        await sendReminder({ ticketId: ticket.id, glpiTicketId: ticket.glpiTicketId, toEmail: ticket.sourceEmail, toName: ticket.sourceName, subject: ticket.title, reminderNumber: 2 });
        await prisma.ticket.update({ where: { id: ticket.id }, data: { reminderCount: 2, reminderSentAt: new Date() } });
        results.push({ ticketId: ticket.id, action: 'REMINDER_2' });
        continue;
      }

      // Première relance J+2
      if (since >= delays.firstReminderDays && count < 1) {
        await sendReminder({ ticketId: ticket.id, glpiTicketId: ticket.glpiTicketId, toEmail: ticket.sourceEmail, toName: ticket.sourceName, subject: ticket.title, reminderNumber: 1 });
        await prisma.ticket.update({ where: { id: ticket.id }, data: { reminderCount: 1, reminderSentAt: new Date() } });
        results.push({ ticketId: ticket.id, action: 'REMINDER_1' });
      }
    } catch (err) {
      results.push({ ticketId: ticket.id, action: 'ERROR', error: err.message });
    }
  }

  return results;
}

module.exports = { runReminderScheduler };
