// Test E2E du CLOISONNEMENT par rôle du RAG mails.
// Vérifie qu'un demandeur ne peut PAS lire les mails d'un autre utilisateur,
// tandis que l'admin voit tout.
const prisma = require('../src/prismaClient');
const R = require('../src/services/emailRagService');
const emb = require('../src/utils/embeddings');
const crypto = require('crypto');

function fakeEmbed(t) {
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

const ids = { users: [], tickets: [], emails: [] };
const CONV = 'AAQkAG-isolation-test';

async function main() {
  const alice = await prisma.user.create({ data: { email: `alice.ragtest+${Date.now()}@test.local`, fullName: 'Alice Test', passwordHash: 'x', role: 'REQUESTER' } });
  const bob = await prisma.user.create({ data: { email: `bob.ragtest+${Date.now()}@test.local`, fullName: 'Bob Test', passwordHash: 'x', role: 'REQUESTER' } });
  const admin = await prisma.user.create({ data: { email: `admin.ragtest+${Date.now()}@test.local`, fullName: 'Admin Test', passwordHash: 'x', role: 'ADMIN' } });
  ids.users.push(alice.id, bob.id, admin.id);

  // Ticket d'Alice, avec un mail confidentiel
  const tAlice = await prisma.ticket.create({ data: { title: '[ISO] Ticket Alice', content: 'caisse', requesterId: alice.id, status: 'NEW' } });
  // Ticket de Bob, avec son propre mail
  const tBob = await prisma.ticket.create({ data: { title: '[ISO] Ticket Bob', content: 'caisse', requesterId: bob.id, status: 'NEW' } });
  ids.tickets.push(tAlice.id, tBob.id);

  const mk = (gid, ticketId, subject, body) => prisma.incomingEmail.create({ data: {
    graphMessageId: gid, conversationId: CONV, emailAccountId: 1,
    fromEmail: 'secret@prosuma.ci', fromName: 'Secret', subject, bodyPreview: body,
    bodyHtml: `<p>${body}</p>`, receivedAt: new Date('2026-09-20T10:00:00Z'), erpTicketId: ticketId } });
  const eAlice = await mk('iso-e-alice', tAlice.id, 'CONFIDENTIEL Alice', 'motdepasse caisse alice 4242');
  const eBob = await mk('iso-e-bob', tBob.id, 'CONFIDENTIEL Bob', 'motdepasse caisse bob 9999');
  // Mail NON rattaché à un ticket : contient les MÊMES mots-clés que la requête,
  // pour vérifier qu'un demandeur ne peut pas le récupérer (il n'appartient
  // ni à Alice ni à Bob).
  const eOrphan = await prisma.incomingEmail.create({ data: {
    graphMessageId: 'iso-e-orphan', conversationId: CONV, emailAccountId: 1,
    fromEmail: 'inconnu@prosuma.ci', subject: 'ORPHELIN motdepasse caisse', bodyPreview: 'motdepasse caisse secret orphelin 7777',
    bodyHtml: '<p>motdepasse caisse secret orphelin 7777</p>', receivedAt: new Date('2026-09-20T10:00:00Z') } });
  ids.emails.push(eAlice.id, eBob.id, eOrphan.id);

  for (const id of ids.emails) await RR.indexIncomingEmail(id);
  console.log('Chunks indexés:', await prisma.emailRagChunk.count());

  const q = 'motdepasse caisse';
  const texts = (r) => r.map((x) => (x.metadata.subject || '') + ' ' + (x.content || '').slice(0, 120)).join(' | ');

  // Alice (REQUESTER) ne doit voir que SON mail
  const asAlice = await RR.searchEmailRag(q, { viewer: { sub: alice.id, role: 'REQUESTER' }, topK: 10 });
  console.log('Alice voit:', texts(asAlice) || '(rien)');
  if (asAlice.some((r) => /Bob/.test(r.metadata.subject || ''))) throw new Error('FUGA: Alice voit le mail de Bob');
  if (asAlice.some((r) => /ORPHELIN/.test(r.metadata.subject || ''))) throw new Error('FUGA: Alice voit un mail sans ticket');
  if (!asAlice.some((r) => /Alice/.test(r.metadata.subject || ''))) throw new Error('Alice ne voit pas son propre mail');

  // Bob ne doit voir que LE SIEN
  const asBob = await RR.searchEmailRag(q, { viewer: { sub: bob.id, role: 'REQUESTER' }, topK: 10 });
  console.log('Bob voit:', texts(asBob) || '(rien)');
  if (asBob.some((r) => /Alice/.test(r.metadata.subject || ''))) throw new Error('FUGA: Bob voit le mail d\'Alice');
  if (!asBob.some((r) => /Bob/.test(r.metadata.subject || ''))) throw new Error('Bob ne voit pas son propre mail');

  // Admin voit tout (y compris l'orphelin)
  const asAdmin = await RR.searchEmailRag(q, { viewer: { sub: admin.id, role: 'ADMIN' }, topK: 10 });
  console.log('Admin voit:', texts(asAdmin) || '(rien)');
  if (!asAdmin.some((r) => /Alice/.test(r.metadata.subject || ''))) throw new Error('Admin ne voit pas le mail d\'Alice');
  if (!asAdmin.some((r) => /ORPHELIN/.test(r.metadata.subject || ''))) throw new Error('Admin ne voit pas le mail orphelin');

  // Technician assigné sur le ticket d'Alice doit voir le mail d'Alice
  const tech = await prisma.user.create({ data: { email: `tech.ragtest+${Date.now()}@test.local`, fullName: 'Tech Test', passwordHash: 'x', role: 'TECHNICIAN' } });
  ids.users.push(tech.id);
  const asTechUnassigned = await RR.searchEmailRag(q, { viewer: { sub: tech.id, role: 'TECHNICIAN' }, topK: 10 });
  if (asTechUnassigned.length !== 0) throw new Error('FUGA: technicien non assigné voit des mails');
  await prisma.ticket.update({ where: { id: tAlice.id }, data: { assignedToId: tech.id } });
  const asTech = await RR.searchEmailRag(q, { viewer: { sub: tech.id, role: 'TECHNICIAN' }, topK: 10 });
  console.log('Tech assigné voit:', texts(asTech) || '(rien)');
  if (!asTech.some((r) => /Alice/.test(r.metadata.subject || ''))) throw new Error('Tech assigné ne voit pas le ticket qui lui est assigné');

  // Observateur
  await prisma.ticket.update({ where: { id: tBob.id }, data: { observers: { connect: { id: alice.id } } } });
  const asAliceObs = await RR.searchEmailRag(q, { viewer: { sub: alice.id, role: 'REQUESTER' }, topK: 10 });
  console.log('Alice (observatrice de Bob) voit:', texts(asAliceObs) || '(rien)');
  if (!asAliceObs.some((r) => /Bob/.test(r.metadata.subject || ''))) throw new Error('Observatrice ne voit pas le ticket qu\'elle observe');

  console.log('\nCloisonnement par rôle vérifié ✓');
}

async function cleanup() {
  await prisma.emailRagChunk.deleteMany({ where: { sourceId: { in: ids.emails }, sourceType: 'INCOMING_EMAIL' } });
  for (const id of ids.emails) await prisma.incomingEmail.delete({ where: { id } }).catch(() => {});
  for (const id of ids.tickets) await prisma.ticket.delete({ where: { id } }).catch(() => {});
  for (const id of ids.users) await prisma.user.delete({ where: { id } }).catch(() => {});
  console.log('Cleanup OK');
}

main().then(async () => { await cleanup(); await prisma.$disconnect(); process.exit(0); })
  .catch(async (e) => { console.error('\nÉCHEC:', e.message); await cleanup(); await prisma.$disconnect(); process.exit(1); });
