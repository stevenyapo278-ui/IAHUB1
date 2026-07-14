const prisma = require('../prismaClient');

async function logEvent(ticketId, type, actor = 'SYSTEM', payload = null, tx = prisma) {
  return tx.ticketEvent.create({
    data: { ticketId, type, actor, payload },
  });
}

module.exports = { logEvent };
