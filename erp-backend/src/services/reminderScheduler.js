const prisma = require('../prismaClient');
const { logEvent } = require('./ticketEvent');

const { processApprovalReminders } = require('./approvalReminderScheduler');

function daysSince(date) {
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

async function runReminderScheduler() {
  const anyConfig = await prisma.reminderConfig.findFirst();
  if (anyConfig && !anyConfig.isActive) return [];
  const delays = anyConfig || { autoCloseDays: 15 };

  const tickets = await prisma.ticket.findMany({
    where: { status: 'WAITING_FOR_USER', sourceEmail: { not: null }, closeSuggested: false },
    include: {
      messages: {
        orderBy: { timestamp: 'desc' },
        take: 1,
        select: { timestamp: true },
      },
    },
  });

  const results = [];

  for (const ticket of tickets) {
    const since = daysSince(ticket.lastUserReplyAt || ticket.updatedAt);

    const latestMsg = ticket.messages?.[0];
    if (latestMsg && daysSince(latestMsg.timestamp) < 1) continue;

    try {
      if (since >= delays.autoCloseDays) {
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: { status: 'CLOSED', closedAt: new Date() },
        });
        await logEvent(ticket.id, 'CLOSED_AUTO', 'SYSTEM', { reason: 'no_response', daysSinceLastReply: since });
        results.push({ ticketId: ticket.id, action: 'AUTO_CLOSED' });
      }
    } catch (err) {
      results.push({ ticketId: ticket.id, action: 'ERROR', error: err.message });
    }
  }

  try {
    await processApprovalReminders();
  } catch (err) {
    console.error('[reminderScheduler] Échec relances approbation Hotline:', err.message);
  }

  return results;
}

module.exports = { runReminderScheduler };
