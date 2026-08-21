const prisma = require('../prismaClient');
const { logEvent } = require('./ticketEvent');
const { updateGlpiTicket } = require('./glpiTicketCreator');

const AUTO_CLOSE_DAYS = 3;

function daysSince(date) {
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Ferme automatiquement les tickets SOLVED depuis plus de AUTO_CLOSE_DAYS jours.
 * Appelé périodiquement par server.js.
 */
async function runSolvedAutoCloseScheduler() {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - AUTO_CLOSE_DAYS);

  const tickets = await prisma.ticket.findMany({
    where: {
      status: 'SOLVED',
      solvedAt: { not: null, lte: threshold },
    },
    select: { id: true, glpiTicketId: true, title: true, solvedAt: true },
  });

  const results = [];

  for (const ticket of tickets) {
    try {
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'CLOSED', closedAt: new Date() },
      });

      await logEvent(ticket.id, 'CLOSED_AUTO', 'SYSTEM', {
        reason: 'solved_auto_close',
        daysSinceSolved: daysSince(ticket.solvedAt),
      });

      // Synchroniser la fermeture vers GLPI si le ticket y est lié
      if (ticket.glpiTicketId) {
        try {
          await updateGlpiTicket(ticket.glpiTicketId, { status: 'CLOSED' });
        } catch (err) {
          console.error(`[solvedAutoClose] Échec synchro GLPI (ticket ${ticket.id}):`, err.message);
        }
      }

      results.push({ ticketId: ticket.id, action: 'AUTO_CLOSED' });
    } catch (err) {
      console.error(`[solvedAutoClose] Échec fermeture ticket ${ticket.id}:`, err.message);
    }
  }

  return results;
}

module.exports = { runSolvedAutoCloseScheduler };
