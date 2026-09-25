// Vérifie que le backfill RAG est INCRÉMENTAL : il doit traverser un backlog
// par lots successifs, puis finir par ne plus rien trouver.
const prisma = require('../src/prismaClient');
const R = require('../src/services/emailRagService');
const emb = require('../src/utils/embeddings');
const crypto = require('crypto');

let calls = 0;
function fakeEmbed(t) {
  calls++;
  const v = new Array(768).fill(0);
  const toks = String(t).toLowerCase().match(/[a-z0-9]+/g) || [];
  for (const k of toks) { const h = crypto.createHash('md5').update(k).digest(); v[h.readUInt16BE(0) % 768] += h[2] % 2 === 0 ? 1 : -1; }
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}
emb.generateEmbedding = async (t) => fakeEmbed(t);
emb.toVectorLiteral = (v) => `[${v.join(',')}]`;
delete require.cache[require.resolve('../src/services/emailRagService')];
const RR = require('../src/services/emailRagService');

const emails = [];
const TOTAL = 25;
const BATCH = 10;

async function main() {
  for (let i = 0; i < TOTAL; i++) {
    const e = await prisma.incomingEmail.create({ data: {
      graphMessageId: `bf-backfill-${Date.now()}-${i}`, conversationId: 'bf-conv', emailAccountId: 1,
      fromEmail: `bf${i}@test.local`, subject: `Backfill test ${i}`, bodyPreview: `caisse body ${i}`,
      bodyHtml: `<p>caisse body ${i}</p>`, receivedAt: new Date(Date.now() - i * 60000) } });
    emails.push(e.id);
  }
  console.log(`Backlog créé : ${TOTAL} emails non indexés`);
  const initial = await prisma.emailRagChunk.count();
  console.log('Chunks avant:', initial, '(doit être 0)');

  // Passe 1 : ne doit indexer qu'un lot, PAS les 25
  const s1 = await RR.backfillEmailRag({ batchSize: BATCH });
  console.log(`Passe 1 : ${s1.emails} email(s) indexé(s)`);
  if (s1.emails > BATCH) throw new Error(`Passe 1 a indexé ${s1.emails} > batchSize ${BATCH}`);
  if (s1.emails === 0) throw new Error('Passe 1 n\'a rien indexé');

  // Passe 2 : progresse sur le reste
  const s2 = await RR.backfillEmailRag({ batchSize: BATCH });
  console.log(`Passe 2 : ${s2.emails} email(s) indexé(s)`);
  if (s2.emails === 0) throw new Error('Passe 2 n\'a rien indexé (ne progresse pas !)');

  // Passe finale : plus rien à faire
  let last;
  for (let i = 0; i < 6; i++) last = await RR.backfillEmailRag({ batchSize: BATCH });
  console.log(`Passe finale : ${last.emails} email(s) (doit être 0)`);
  if (last.emails !== 0) throw new Error(`Backfill ne converge pas : ${last.emails} restants`);

  const total = await prisma.emailRagChunk.count();
  console.log('Chunks après:', total);
  if (total < TOTAL) throw new Error(`Chunks ${total} < ${TOTAL} attendus`);

  // Le nombre d'appels embedding doit rester borné (1 par chunk, pas 1 par scan)
  console.log('Appels embedding:', calls, `(~${total} chunks)`);
  if (calls > total * 2) throw new Error(`Trop d'appels embedding: ${calls} pour ${total} chunks (re-indexation ?)`);

  console.log('\nBackfill incrémental vérifié ✓');
}

async function cleanup() {
  await prisma.emailRagChunk.deleteMany({ where: { sourceId: { in: emails }, sourceType: 'INCOMING_EMAIL' } });
  for (const id of emails) await prisma.incomingEmail.delete({ where: { id } }).catch(() => {});
  console.log('Cleanup OK');
}

main().then(async () => { await cleanup(); await prisma.$disconnect(); process.exit(0); })
  .catch(async (e) => { console.error('\nÉCHEC:', e.message); await cleanup(); await prisma.$disconnect(); process.exit(1); });
