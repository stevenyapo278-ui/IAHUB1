const prisma = require('../prismaClient');
const { sendReminder } = require('./emailSender');
const { logEvent } = require('./ticketEvent');
const { updateGlpiTicket } = require('./glpiTicketCreator');

function daysSince(date) {
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

// Parcourt tous les tickets WAITING_FOR_USER et envoie les relances selon la config
async function runReminderScheduler() {
  const anyConfig = await prisma.reminderConfig.findFirst();
  // Si une config existe mais a été explicitement désactivée (isActive=false), on ne doit PAS
  // retomber sur les délais par défaut : ce serait réactiver silencieusement les relances/clôtures
  // auto qu'un admin a justement voulu désactiver. On ne tourne avec les défauts que si aucune
  // configuration n'existe encore en base (première installation).
  if (anyConfig && !anyConfig.isActive) return [];
  const delays = anyConfig || { firstReminderDays: 2, secondReminderDays: 5, preCloseDays: 10, autoCloseDays: 15 };

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
        if (ticket.glpiTicketId) {
          try {
            await updateGlpiTicket(ticket.glpiTicketId, { status: 'CLOSED' });
          } catch (err) {
            console.error('[reminderScheduler] Échec synchro statut GLPI:', err.message);
          }
        }
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
