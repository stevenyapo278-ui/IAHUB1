const prisma = require('../prismaClient');

async function logEvent(ticketId, type, actor = 'SYSTEM', payload = null) {
  return prisma.ticketEvent.create({
    data: { ticketId, type, actor, payload },
  });
}

module.exports = { logEvent };
