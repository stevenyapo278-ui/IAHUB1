const prisma = require('../prismaClient');
const { getSystemSettings } = require('./systemSettings');
const { sendHotlineApprovalReminderEmail } = require('./emailSender');
const { logEvent } = require('./ticketEvent');

async function processApprovalReminders() {
  const settings = await getSystemSettings();
  const delayMinutes = settings.approvalReminderMinutes || 30;
  if (delayMinutes <= 0) return;

  const MIN_INTERVAL_MS = 60 * 60 * 1000;
  const effectiveDelayMs = Math.max(delayMinutes, 60) * 60 * 1000;
  const cutoff = new Date(Date.now() - effectiveDelayMs);

  const pendingTickets = await prisma.ticket.findMany({
    where: {
      approvalStatus: 'PENDING',
      createdAt: { lte: cutoff },
      OR: [
        { reminderSentAt: null },
        { reminderSentAt: { lte: cutoff } },
      ],
    },
    include: {
      requester: { select: { fullName: true, email: true } },
    },
    take: 50,
  });

  if (pendingTickets.length === 0) return;

  const hotlineUsers = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [
        { role: 'HOTLINE' },
        { role: 'ADMIN' },
        { role: 'SUPERADMIN' },
      ],
    },
    select: { email: true, fullName: true },
  });

  if (hotlineUsers.length === 0) return;

  for (const ticket of pendingTickets) {
    const minutesWaiting = Math.round((Date.now() - new Date(ticket.createdAt).getTime()) / (60 * 1000));
    const nextReminderCount = (ticket.reminderCount || 0) + 1;

    for (const hotlineUser of hotlineUsers) {
      if (!hotlineUser.email) continue;
      try {
        await sendHotlineApprovalReminderEmail({
          recipientEmail: hotlineUser.email,
          recipientName: hotlineUser.fullName,
          ticketId: ticket.id,
          ticketTitle: ticket.title,
          priority: ticket.priority,
          category: ticket.category,
          requesterName: ticket.requester?.fullName,
          reminderCount: nextReminderCount,
          minutesWaiting,
        });
      } catch (err) {
        console.error(`[approvalReminderScheduler] Échec envoi relance hotline ticket #${ticket.id} vers ${hotlineUser.email}:`, err.message);
      }
    }

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        reminderSentAt: new Date(),
        reminderCount: nextReminderCount,
      },
    });

    await logEvent(ticket.id, 'REMINDER_SENT', 'SYSTEM', {
      type: 'HOTLINE_APPROVAL',
      reminderCount: nextReminderCount,
      minutesWaiting,
    });
  }
}

module.exports = { processApprovalReminders };
