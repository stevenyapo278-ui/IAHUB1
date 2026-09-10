const prisma = require('../prismaClient');
const { logEvent } = require('./ticketEvent');

function daysSince(date) {
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Ferme automatiquement les tickets SOLVED depuis plus de X jours.
 * Le délai est configurable via SystemSettings.solvedAutoCloseDays (défaut : 3).
 * Valeur 0 = désactivé.
 */
async function runSolvedAutoCloseScheduler() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  const autoCloseDays = settings?.solvedAutoCloseDays ?? 3;

  if (autoCloseDays <= 0) {
    console.log('[solvedAutoClose] Désactivé (solvedAutoCloseDays=0)');
    return [];
  }

  const threshold = new Date();
  threshold.setDate(threshold.getDate() - autoCloseDays);
  threshold.setHours(0, 0, 0, 0);

  console.log(`[solvedAutoClose] Recherche tickets SOLVED résolus avant le ${threshold.toISOString()} (délai: ${autoCloseDays}j)`);

  const tickets = await prisma.ticket.findMany({
    where: {
      status: 'SOLVED',
      OR: [
        { solvedAt: { lte: threshold } },
        { solvedAt: null, updatedAt: { lte: threshold } },
      ],
    },
    select: { id: true, title: true, solvedAt: true, updatedAt: true },
  });

  console.log(`[solvedAutoClose] ${tickets.length} ticket(s) trouvé(s) à fermer`);

  const results = [];

  for (const ticket of tickets) {
    try {
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          solvedAt: ticket.solvedAt || ticket.updatedAt,
          closeSuggested: false,
          closeSuggestedAt: null,
          closeSuggestionConfidence: null,
        },
      });

      await logEvent(ticket.id, 'CLOSED_AUTO', 'SYSTEM', {
        reason: 'solved_auto_close',
        daysSinceSolved: daysSince(ticket.solvedAt || ticket.updatedAt),
      });

      console.log(`[solvedAutoClose] Ticket #${ticket.id} fermé (solvedAt: ${ticket.solvedAt}, daysSince: ${daysSince(ticket.solvedAt || ticket.updatedAt)})`);
      results.push({ ticketId: ticket.id, action: 'AUTO_CLOSED' });
    } catch (err) {
      console.error(`[solvedAutoClose] Échec fermeture ticket ${ticket.id}:`, err.message);
    }
  }

  return results;
}

module.exports = { runSolvedAutoCloseScheduler };
