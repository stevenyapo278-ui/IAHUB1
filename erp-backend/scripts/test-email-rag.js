// Test E2E du RAG mails : insertion données synthétiques, indexation, recherche
// avec filtres. Nécessite une base accessible (conteneur de dev recommandé) :
//   docker cp scripts/test-email-rag.js <backend>:/app/scripts/
//   docker exec -w /app/scripts <backend> node test-email-rag.js
// La base de données est lue/écrite via DATABASE_URL ; les lignes créées sont
// supprimées à la fin (cleanup), que le test passe ou échoue.
const prisma = require('../src/prismaClient');
const emb = require('../src/utils/embeddings');

// Stub de generateEmbedding : vecteur "hashing trick" (bag-of-words 768-d).
// La similarité cosinus reflète alors le recouvrement lexical, ce qui permet
// de valider les seuils et le ranking de façon déterministe.
const crypto = require('crypto');
function fakeEmbed(text) {
  const v = new Array(768).fill(0);
  const tokens = String(text).toLowerCase().match(/[a-zà-ÿ0-9]+/g) || [];
  for (const tok of tokens) {
    const h = crypto.createHash('md5').update(tok).digest();
    const idx = h.readUInt16BE(0) % 768;
    const sign = h[2] % 2 === 0 ? 1 : -1;
    v[idx] += sign;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
emb.generateEmbedding = async (text) => fakeEmbed(text);
emb.toVectorLiteral = (v) => `[${v.join(',')}]`;
// recharger le service avec le stub
delete require.cache[require.resolve('../src/services/emailRagService')];
const R = require('../src/services/emailRagService');

const CONV = 'AAQkAG-test-conv-1';
let ticketId = null;
const created = { emails: [], msgs: [] };

async function main() {
  // Ticket parent requis pour TicketMessage
  const ticket = await prisma.ticket.create({
    data: {
      title: '[TEST RAG] Panne caisse Marcory',
      content: 'Caisse Marcory hors-ligne, timeout DNS sur le switch.',
      requesterId: (await prisma.user.findFirst())?.id,
      status: 'NEW',
      category: 'RESEAU',
    },
  });
  ticketId = ticket.id;
  console.log('Ticket test #%d', ticketId);

  // 1. Email entrant « panne réseau » de Jean
  const e1 = await prisma.incomingEmail.create({
    data: {
      graphMessageId: 'test-rag-e1',
      conversationId: CONV,
      emailAccountId: 1,
      fromEmail: 'jean.kouassi@prosuma.ci',
      fromName: 'Jean Kouassi',
      subject: 'Panne réseau caisse Marcory',
      bodyPreview: 'La caisse Marcory ne plus accès au réseau depuis 8h.',
      bodyHtml: '<p>Bonjour, la caisse <b>Marcory</b> est hors-ligne. Erreur DNS timeout.</p>',
      receivedAt: new Date('2026-09-20T10:00:00Z'),
      erpTicketId: ticketId,
      aiSummary: 'Caisse Marcory hors-ligne, timeout DNS.',
    },
  });
  created.emails.push(e1.id);

  // 2. Email entrant « slows » de Aya (autre jour / autre expéditeur)
  const e2 = await prisma.incomingEmail.create({
    data: {
      graphMessageId: 'test-rag-e2',
      conversationId: CONV,
      emailAccountId: 1,
      fromEmail: 'aya.traore@prosuma.ci',
      fromName: 'Aya Traore',
      subject: 'Serveur très lent',
      bodyPreview: 'Le serveur de compta est très lent ce matin.',
      receivedAt: new Date('2026-09-24T08:00:00Z'),
    },
  });
  created.emails.push(e2.id);

  // 3. Message sortant (réponse) sur le ticket
  const m1 = await prisma.ticketMessage.create({
    data: {
      ticketId,
      direction: 'OUTBOUND',
      sender: 'support@prosuma.ci',
      recipients: ['jean.kouassi@prosuma.ci'],
      subject: 'Re: Panne réseau caisse Marcory',
      body: 'Bonjour Jean, nous investigons le timeout DNS sur le switch Marcory.',
      bodyHtml: '<p>Bonjour Jean, nous investiguons le timeout DNS sur le switch Marcory.</p>',
      conversationId: CONV,
      timestamp: new Date('2026-09-20T11:00:00Z'),
      summary: 'Réponse : investigation timeout DNS switch Marcory.',
    },
  });
  created.msgs.push(m1.id);

  // Indexer
  console.log('Indexation…');
  for (const id of created.emails) await R.indexIncomingEmail(id);
  for (const id of created.msgs) await R.indexTicketMessage(id);
  const total = await prisma.emailRagChunk.count();
  console.log('Chunks indexés:', total);
  if (total < 3) throw new Error('Indexation incomplète');

  // Vérifier que les embeddings sont bienvecteurs (pas null)
  const withEmb = await prisma.$queryRawUnsafe('SELECT count(*)::int AS c FROM "EmailRagChunk" WHERE embedding IS NOT NULL');
  console.log('Chunks avec embedding:', withEmb[0].c);
  if (withEmb[0].c < 3) throw new Error('Embeddings manquants');

  // Scénarios de recherche
  const scenarios = [
    { label: 'S1 recherche globale "caisse réseau"', opts: { query: 'caisse réseau' } },
    { label: 'S2 par expéditeur Jean', opts: { query: 'caisse', fromEmail: 'jean.kouassi' } },
    { label: 'S3 par ticketId', opts: { query: 'DNS', ticketId } },
    { label: 'S4 par conversationId', opts: { query: 'caisse', conversationId: CONV } },
    { label: 'S5 par date (2026-09-24)', opts: { query: 'serveur', dateFrom: '2026-09-24', dateTo: '2026-09-24' } },
    { label: 'S6 direction OUTBOUND', opts: { query: 'timeout DNS', direction: 'OUTBOUND' } },
    { label: 'S7 dateTo=2026-09-20 inclut la journée', opts: { query: 'caisse', dateFrom: '2026-09-20', dateTo: '2026-09-20' } },
  ];

  for (const s of scenarios) {
    const r = await R.searchEmailRag(s.opts.query, s.opts);
    const meta = r[0] ? r[0].metadata : null;
    console.log(`  ${s.label} → ${r.length} résultat(s)`, meta ? `| top: ${meta.subject || meta.fromEmail}` : '');
    // Vérifier qu'un filtre restrictif ne renvoie pas de résultat hors filtre
    if (s.opts.fromEmail && r.length) {
      const bad = r.filter((x) => !(x.metadata.fromEmail || '').toLowerCase().includes('jean'));
      if (bad.length) throw new Error(`S2 FUITE expéditeur: ${JSON.stringify(bad.map((b) => b.metadata.fromEmail))}`);
    }
    if (s.opts.direction && r.length) {
      const bad = r.filter((x) => (x.metadata.direction || '').toUpperCase() !== s.opts.direction);
      if (bad.length) throw new Error('S6 FUITE direction');
    }
    if (s.opts.ticketId && r.length) {
      const bad = r.filter((x) => Number(x.metadata.ticketId) !== Number(s.opts.ticketId));
      if (bad.length) throw new Error('S3 FUITE ticketId');
    }
  }

  // S8 : requête sans correspondance → 0
  const none = await R.searchEmailRag('avion spatial zzzz', {});
  console.log('  S8 aucun match →', none.length, 'résultat(s)');
  if (none.length !== 0) throw new Error('S8: attendu 0 résultat');

  // ── Phase 2 : fallback FTS pur (aucun fournisseur d'embedding configuré) ──
  console.log('\n[Fallback FTS — embedding indisponible]');
  emb.generateEmbedding = async () => { throw new Error('Aucun fournisseur IA configuré'); };
  delete require.cache[require.resolve('../src/services/emailRagService')];
  const RF = require('../src/services/emailRagService');

  const fts = [
    { label: 'F1 "caisse"', opts: { query: 'caisse' }, expect: (r) => r.length > 0 },
    { label: 'F2 expéditeur Aya', opts: { query: 'serveur', fromEmail: 'aya.traore' }, expect: (r) => r.length > 0 && r.every((x) => (x.metadata.fromEmail || '').includes('aya')) },
    { label: 'F3 direction INBOUND', opts: { query: 'caisse', direction: 'INBOUND' }, expect: (r) => r.length > 0 && r.every((x) => x.metadata.direction === 'INBOUND') },
    { label: 'F4 hors période', opts: { query: 'caisse', dateFrom: '2026-01-01', dateTo: '2026-01-02' }, expect: (r) => r.length === 0 },
    { label: 'F5 aucun match', opts: { query: 'avion spatial zzzz' }, expect: (r) => r.length === 0 },
  ];
  for (const s of fts) {
    const r = await RF.searchEmailRag(s.opts.query, s.opts);
    console.log(`  ${s.label} → ${r.length} résultat(s)`);
    if (!s.expect(r)) throw new Error(`${s.label}: résultat inattendu ${JSON.stringify(r.map((x) => x.metadata && x.metadata.subject))}`);
  }

  console.log('\nTous les scénarios passent ✓');
}

main()
  .then(async () => {
    // Cleanup
    await prisma.emailRagChunk.deleteMany({ where: { sourceId: { in: [...created.emails, ...created.msgs] }, sourceType: { in: ['INCOMING_EMAIL', 'TICKET_MESSAGE'] } } });
    for (const id of created.msgs) await prisma.ticketMessage.delete({ where: { id } }).catch(() => {});
    for (const id of created.emails) await prisma.incomingEmail.delete({ where: { id } }).catch(() => {});
    if (ticketId) await prisma.ticket.delete({ where: { id: ticketId } }).catch(() => {});
    console.log('Cleanup OK');
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error('\nÉCHEC:', e.message);
    console.error(e.stack);
    try {
      await prisma.emailRagChunk.deleteMany({ where: { sourceId: { in: [...created.emails, ...created.msgs] } } });
      for (const id of created.msgs) await prisma.ticketMessage.delete({ where: { id } }).catch(() => {});
      for (const id of created.emails) await prisma.incomingEmail.delete({ where: { id } }).catch(() => {});
      if (ticketId) await prisma.ticket.delete({ where: { id: ticketId } }).catch(() => {});
    } catch {}
    await prisma.$disconnect();
    process.exit(1);
  });
