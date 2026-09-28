// Nettoyage one-shot : les tickets créés MANUELLEMENT (back-office → origin MANUAL,
// portail → origin PORTAIL) ont été poussés en PENDING par le bug requiresApproval —
// le formulaire multipart envoyait la chaîne "false", truthy en JS, donc
// `requiresApproval ? 'PENDING' : 'APPROVED'` basculait toujours sur PENDING.
// Ils doivent être APPROVED : seuls les tickets IA/email/chatbot (ticketCreator,
// chatbotService, approvalReminderScheduler) doivent encore passer par le centre
// de validation.
//
// Usage (depuis erp-backend/, avec DATABASE_URL défini) :
//   node scripts/approve-manual-pending.js           # dry-run : inventaire seul
//   node scripts/approve-manual-pending.js --apply   # approuve réellement
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const MANUAL_ORIGINS = ['MANUAL', 'PORTAIL'];
const APPLY = process.argv.includes('--apply');

async function main() {
  // Inventaire global : quels PENDING restent (email/chatbot/IA = légitimes)
  const groups = await prisma.ticket.groupBy({
    by: ['origin'],
    where: { approvalStatus: 'PENDING', deletedAt: null },
    _count: { _all: true },
  });
  console.log('Tickets en PENDING, par origine :');
  groups.forEach((g) => {
    const manual = MANUAL_ORIGINS.includes(g.origin);
    console.log(`  ${g.origin || '(null)'} : ${g._count._all}${manual ? '  ← à corriger' : ''}`);
  });

  const where = {
    approvalStatus: 'PENDING',
    origin: { in: MANUAL_ORIGINS },
    deletedAt: null,
  };
  const pending = await prisma.ticket.findMany({
    where,
    select: { id: true, title: true, origin: true, createdAt: true },
    orderBy: { id: 'asc' },
  });

  console.log(`\nTickets manuels bloqués en PENDING : ${pending.length}`);
  pending.forEach((t) => {
    console.log(`  #${t.id} [${t.origin}] ${(t.createdAt || '').toISOString?.() || t.createdAt} ${t.title}`);
  });

  if (!APPLY) {
    console.log('\nDry-run : rien n\'a été modifié. Relancer avec --apply pour approuver.');
    return;
  }

  const res = await prisma.ticket.updateMany({
    where,
    data: { approvalStatus: 'APPROVED' },
  });
  console.log(`\n✅ ${res.count} ticket(s) passé(s) de PENDING à APPROVED.`);
}

main()
  .catch((e) => {
    console.error('❌', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
