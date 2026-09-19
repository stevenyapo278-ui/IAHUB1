/**
 * Backfill des embeddings pour les tickets existants en base.
 * 
 * Ce script génère les embeddings pour les tickets qui n'en ont pas encore,
 * afin de pouvoir utiliser la détection d'incidents similaires et la recherche
 * vectorielle.
 * 
 * Idempotent : peut être relancé sans risque ( traite uniquement les tickets
 * sans embedding).
 * 
 * Usage :
 *   node scripts/backfillTicketEmbeddings.js [--batch-size 50] [--delay 2000] [--dry-run]
 * 
 * Variables d'environnement requises :
 *   DATABASE_URL - URL de connexion PostgreSQL
 *   JWT_SECRET   - Secret JWT (requis par le client Prisma)
 */

const { PrismaClient } = require('@prisma/client');

// Parse des arguments CLI
const args = process.argv.slice(2);
const BATCH_SIZE = parseInt(args.find((_, i, a) => a[i - 1] === '--batch-size') || '50', 10);
const DELAY_MS = parseInt(args.find((_, i, a) => a[i - 1] === '--delay') || '2000', 10);
const DRY_RUN = args.includes('--dry-run');

const prisma = new PrismaClient();

// Import dynamique pour éviter les erreurs si les dépendances manquent
let generateEmbedding, toVectorLiteral;
try {
  ({ generateEmbedding, toVectorLiteral } = require('../src/utils/embeddings'));
} catch (err) {
  console.error('[backfill] Impossible de charger ../src/utils/embeddings:', err.message);
  console.error('[backfill] Assurez-vous d\'exécuter ce script depuis erp-backend/');
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('[backfill] Début du backfill des embeddings tickets');
  console.log(`[backfill] Configuration : batch=${BATCH_SIZE}, delay=${DELAY_MS}ms, dryRun=${DRY_RUN}`);

  // Compter les tickets sans embedding OU sans entrée TicketSimilarityIndex
  const totalWithoutEmbedding = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM "Ticket" t
    LEFT JOIN "TicketSimilarityIndex" tsi ON tsi."ticketId" = t.id
    WHERE t."contentEmbedding" IS NULL OR tsi.id IS NULL
  `;

  const total = totalWithoutEmbedding[0]?.count || 0;
  console.log(`[backfill] ${total} tickets sans embedding à traiter`);

  if (total === 0) {
    console.log('[backfill] Aucun ticket à traiter, fin du script');
    await prisma.$disconnect();
    return;
  }

  let processed = 0;
  let errors = 0;
  let skipped = 0;

  // Traiter par batch
  while (processed < total) {
    // Récupérer un batch de tickets sans embedding ou sans similarity index
    const tickets = await prisma.$queryRaw`
      SELECT t.id, t.title, t.content
      FROM "Ticket" t
      LEFT JOIN "TicketSimilarityIndex" tsi ON tsi."ticketId" = t.id
      WHERE t."contentEmbedding" IS NULL OR tsi.id IS NULL
      ORDER BY t.id ASC
      LIMIT ${BATCH_SIZE}
    `;

    if (tickets.length === 0) break;

    console.log(`[backfill] Batch ${Math.floor(processed / BATCH_SIZE) + 1} : ${tickets.length} tickets`);

    for (const ticket of tickets) {
      const text = `${ticket.title || ''} ${ticket.content || ''}`.substring(0, 1000);
      if (!text.trim()) {
        skipped++;
        processed++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`[backfill] [DRY-RUN] Ticket ${ticket.id}: "${(ticket.title || '').substring(0, 50)}..."`);
        processed++;
        continue;
      }

      try {
        // Vérifier si le ticket a déjà un embedding (sinon le générer)
        const ticketRow = await prisma.$queryRaw`
          SELECT "contentEmbedding"::text AS embedding_text FROM "Ticket" WHERE id = ${ticket.id}
        `;
        let vectorLiteral;
        if (ticketRow[0]?.embedding_text) {
          // L'embedding existe déjà — le réutiliser
          vectorLiteral = ticketRow[0].embedding_text;
        } else {
          const embedding = await generateEmbedding(text);
          vectorLiteral = toVectorLiteral(embedding);
        }

        // Mettre à jour l'embedding dans Ticket (seulement si NULL)
        await prisma.$executeRaw`
          UPDATE "Ticket"
          SET "contentEmbedding" = ${vectorLiteral}::vector
          WHERE id = ${ticket.id} AND "contentEmbedding" IS NULL
        `;

        // Upsert TicketSimilarityIndex (find-first + create/update car ticketId n'est pas @unique)
        const existing = await prisma.ticketSimilarityIndex.findFirst({ where: { ticketId: ticket.id } });
        if (existing) {
          await prisma.ticketSimilarityIndex.update({
            where: { id: existing.id },
            data: {
              summary: (ticket.title || '').substring(0, 500),
              bodyShort: (ticket.content || '').substring(0, 200),
              content: (ticket.content || '').substring(0, 2000),
            },
          });
        } else {
          await prisma.ticketSimilarityIndex.create({
            data: {
              ticketId: ticket.id,
              summary: (ticket.title || '').substring(0, 500),
              bodyShort: (ticket.content || '').substring(0, 200),
              content: (ticket.content || '').substring(0, 2000),
              status: 'OPEN',
              requesterEmail: '',
            },
          });
        }

        // Mettre à jour l'embedding dans TicketSimilarityIndex
        await prisma.$executeRaw`
          UPDATE "TicketSimilarityIndex"
          SET embedding = ${vectorLiteral}::vector
          WHERE "ticketId" = ${ticket.id}
        `;

        processed++;
        console.log(`[backfill] ✓ Ticket ${ticket.id} traité (${processed}/${total})`);
      } catch (err) {
        errors++;
        processed++;
        console.error(`[backfill] ✗ Ticket ${ticket.id} échoué: ${err.message}`);
      }
    }

    // Pause entre les batches pour éviter de surcharger les APIs d'embedding
    if (processed < total) {
      console.log(`[backfill] Pause de ${DELAY_MS}ms avant le prochain batch...`);
      await sleep(DELAY_MS);
    }
  }

  console.log('\n[backfill] Résumé :');
  console.log(`[backfill]   Total traité : ${processed}`);
  console.log(`[backfill]   Succès : ${processed - errors - skipped}`);
  console.log(`[backfill]   Échecs : ${errors}`);
  console.log(`[backfill]   Ignorés (contenu vide) : ${skipped}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[backfill] Erreur fatale:', err);
  prisma.$disconnect();
  process.exit(1);
});
