const prisma = require('../prismaClient');
const { getSystemSettings } = require('./systemSettings');
const { sendHotlineApprovalReminderEmail } = require('./emailSender');
const { logEvent } = require('./ticketEvent');

// Récupère les membres de la Hotline (rôles HOTLINE/ADMIN/SUPERADMIN actifs) à notifier.
async function getHotlineUsers() {
  return prisma.user.findMany({
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
}

// Envoie l'email d'approbation à chaque membre de la Hotline (best-effort : un échec par
// destinataire ne doit jamais faire échouer le traitement du ticket).
async function notifyHotlineUsers({ ticket, reminderCount, minutesWaiting }) {
  const hotlineUsers = await getHotlineUsers();
  if (hotlineUsers.length === 0) return;
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
        requesterName: ticket.requesterName,
        reminderCount,
        minutesWaiting,
      });
    } catch (err) {
      console.error(`[approvalReminderScheduler] Échec envoi relance hotline ticket #${ticket.id} vers ${hotlineUser.email}:`, err.message);
    }
  }
}

// Notifie immédiatement la Hotline qu'un nouveau ticket est en attente d'approbation (créé en
// PENDING, ex. via le pipeline email). La 1re notification part donc EN MÊME TEMPS que la création
// du ticket (plus d'attente de 30/60 min) — le scheduler ne gère ensuite que la relance n°2.
// La notification initiale est comptée comme 1re relance (reminderCount=1) pour éviter tout doublon.
async function notifyNewPendingTicket(ticketId) {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true, title: true, priority: true, category: true, createdAt: true, sourceName: true,
        requester: { select: { fullName: true } },
      },
    });
    if (!ticket) return;
    const minutesWaiting = Math.round((Date.now() - new Date(ticket.createdAt).getTime()) / (60 * 1000));
    await notifyHotlineUsers({
      ticket: { ...ticket, requesterName: ticket.requester?.fullName || ticket.sourceName },
      reminderCount: 0,
      minutesWaiting,
    });
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { reminderSentAt: new Date(), reminderCount: 1 },
    }).catch(() => {});
  } catch (err) {
    console.error('[approvalReminderScheduler] Échec notification immédiate hotline:', err.message);
  }
}

async function processApprovalReminders() {
  const settings = await getSystemSettings();
  const delayMinutes = settings.approvalReminderMinutes || 30;
  if (delayMinutes <= 0) return;

  // Délai exactement égal à la valeur configurée (approvalReminderMinutes, défaut 30 min) —
  // plus de plancher à 60 min : le 1er mail part à la création du ticket (notifyNewPendingTicket),
  // cette relance n°2 part après le délai configuré.
  const effectiveDelayMs = delayMinutes * 60 * 1000;
  const cutoff = new Date(Date.now() - effectiveDelayMs);

  const pendingTickets = await prisma.ticket.findMany({
    where: {
      approvalStatus: 'PENDING',
      createdAt: { lte: cutoff },
      reminderCount: { lt: 2 },
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

  const hotlineUsers = await getHotlineUsers();
  if (hotlineUsers.length === 0) return;

  for (const ticket of pendingTickets) {
    const currentCount = ticket.reminderCount || 0;
    if (currentCount >= 2) continue;

    const minutesWaiting = Math.round((Date.now() - new Date(ticket.createdAt).getTime()) / (60 * 1000));
    const nextReminderCount = currentCount + 1;

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
          requesterName: ticket.requester?.fullName || ticket.sourceName,
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

module.exports = { processApprovalReminders, notifyNewPendingTicket };