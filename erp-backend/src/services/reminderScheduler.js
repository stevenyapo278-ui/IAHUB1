const prisma = require('../prismaClient');
const { logEvent } = require('./ticketEvent');

const { processApprovalReminders } = require('./approvalReminderScheduler');

function daysSince(date) {
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

function buildReminderDraftBody({ toName, ticketId, subject, isPreClose }) {
  if (isPreClose) {
    return `<p>Bonjour ${toName || ''},</p>\n<p>Sans réponse de votre part dans les 5 prochains jours, votre ticket <strong>#${ticketId}</strong> (${subject}) sera automatiquement clôturé.</p>\n<p>Si le problème est résolu, vous n'avez rien à faire. Sinon, répondez à cet email.</p>`;
  }
  return `<p>Bonjour ${toName || ''},</p>\n<p>Nous revenons vers vous concernant votre ticket <strong>#${ticketId}</strong> : ${subject}.</p>\n<p>Votre demande est toujours en attente. Pouvez-vous nous confirmer si le problème est résolu ou s'il persiste ?</p>\n<p>Répondez simplement à cet email.</p>`;
}

async function runReminderScheduler() {
  const anyConfig = await prisma.reminderConfig.findFirst();
  if (anyConfig && !anyConfig.isActive) return [];
  const delays = anyConfig || { firstReminderDays: 2, secondReminderDays: 5, preCloseDays: 10, autoCloseDays: 15 };

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
    const count = ticket.reminderCount || 0;

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
        continue;
      }

      const hasPendingReminderDraft = await prisma.aiEmailDraft.findFirst({
        where: { ticketId: ticket.id, draftKind: 'REMINDER', status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });

      if (since >= delays.preCloseDays && count < 3) {
        if (!hasPendingReminderDraft) {
          await prisma.aiEmailDraft.create({
            data: {
              ticketId: ticket.id,
              recipientEmail: ticket.sourceEmail,
              recipientName: ticket.sourceName || ticket.sourceEmail,
              subject: `[Ticket #${ticket.id}] ${ticket.title}`,
              proposedContent: buildReminderDraftBody({
                toName: ticket.sourceName, ticketId: ticket.id,
                subject: ticket.title, isPreClose: true,
              }),
              draftKind: 'REMINDER',
            },
          });
        }
        await prisma.ticket.update({ where: { id: ticket.id }, data: { reminderCount: 3, reminderSentAt: new Date() } });
        results.push({ ticketId: ticket.id, action: 'REMINDER_PRE_CLOSE' });
        continue;
      }

      if (since >= delays.secondReminderDays && count < 2) {
        if (!hasPendingReminderDraft) {
          await prisma.aiEmailDraft.create({
            data: {
              ticketId: ticket.id,
              recipientEmail: ticket.sourceEmail,
              recipientName: ticket.sourceName || ticket.sourceEmail,
              subject: `[Ticket #${ticket.id}] ${ticket.title}`,
              proposedContent: buildReminderDraftBody({
                toName: ticket.sourceName, ticketId: ticket.id,
                subject: ticket.title, isPreClose: false,
              }),
              draftKind: 'REMINDER',
            },
          });
        }
        await prisma.ticket.update({ where: { id: ticket.id }, data: { reminderCount: 2, reminderSentAt: new Date() } });
        results.push({ ticketId: ticket.id, action: 'REMINDER_2' });
        continue;
      }

      if (since >= delays.firstReminderDays && count < 1) {
        if (!hasPendingReminderDraft) {
          await prisma.aiEmailDraft.create({
            data: {
              ticketId: ticket.id,
              recipientEmail: ticket.sourceEmail,
              recipientName: ticket.sourceName || ticket.sourceEmail,
              subject: `[Ticket #${ticket.id}] ${ticket.title}`,
              proposedContent: buildReminderDraftBody({
                toName: ticket.sourceName, ticketId: ticket.id,
                subject: ticket.title, isPreClose: false,
              }),
              draftKind: 'REMINDER',
            },
          });
        }
        await prisma.ticket.update({ where: { id: ticket.id }, data: { reminderCount: 1, reminderSentAt: new Date() } });
        results.push({ ticketId: ticket.id, action: 'REMINDER_1' });
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
