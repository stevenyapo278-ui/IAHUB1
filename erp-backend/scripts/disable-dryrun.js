const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const result = await prisma.systemSettings.update({
    where: { id: 1 },
    data: { dryRunMode: false, enableGlpiTicketCreation: true }
  });
  console.log('✅ Dry Run désactivé');
  console.log(JSON.stringify({ dryRunMode: result.dryRunMode, enableGlpiTicketCreation: result.enableGlpiTicketCreation }, null, 2));
}
main().catch(e => { console.error('❌', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
