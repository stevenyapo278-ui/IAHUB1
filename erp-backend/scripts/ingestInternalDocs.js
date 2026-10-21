/**
 * Ingestion des documents de documentation INTERNE dans la base de connaissances (KB).
 *
 * Alimente le RAG du chatbot (outil search_knowledge) avec la documentation des
 * processus internes de la plateforme (gestion des comptes, etc.). Idempotent :
 * chaque document est identifié par un filename interne (`internal/<nom>.md`) ;
 * relancer le script ré-indexe le document sur place (chunks supprimés puis
 * régénérés), sans créer de doublon.
 *
 * Usage :
 *   node scripts/ingestInternalDocs.js [--dry-run] [--doc PROCESSUS_INTERNE_COMPTE.md]
 *
 * Variables d'environnement requises :
 *   DATABASE_URL - URL de connexion PostgreSQL (chargée via dotenv, erp-backend/.env)
 *
 * Note : un chunk sans embedding est inséré avec NULL — invisible dans la recherche
 * hybride (qui exige un vecteur) mais le document reste si au moins un chunk a réussi.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const { chunkText } = require('../src/utils/chunking');
const { generateEmbedding, toVectorLiteral } = require('../src/utils/embeddings');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const DOC_FILTER = args.find((_, i, a) => a[i - 1] === '--doc') || null;

const prisma = new PrismaClient();

// Documents internes à ingérer — ajouter une entrée ici pour indexed une nouvelle
// procédure (fichier markdown dans /docs à la racine du dépôt).
const INTERNAL_DOCS = [
  {
    file: 'PROCESSUS_INTERNE_COMPTE.md',
    title: 'Gestion des comptes utilisateurs — Processus internes',
    category: 'Processus interne',
    tags: [
      'processus', 'comptes', 'utilisateurs', 'creation-de-compte',
      'mot-de-passe', 'roles', 'permissions', 'ldap', 'annuaire',
    ],
  },
];

// Racine du dépôt (erp-backend/scripts → ../..)
const REPO_ROOT = path.resolve(__dirname, '..', '..');

async function ingestDoc(doc) {
  const filePath = path.join(REPO_ROOT, 'docs', doc.file);
  if (!fs.existsSync(filePath)) {
    console.error(`[ingest] Fichier introuvable : ${filePath} — ignoré`);
    return { ok: false, reason: 'missing-file' };
  }
  if (DRY_RUN) {
    console.log(`[ingest] (dry-run) ${doc.file} → « ${doc.title} » (${doc.category})`);
    return { ok: true, dryRun: true };
  }

  const text = fs.readFileSync(filePath, 'utf8');
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    console.error(`[ingest] ${doc.file} : aucun contenu exploitable`);
    return { ok: false, reason: 'empty' };
  }

  // Filename interne = marqueur d'unicité pour l'idempotence (ré-indexation sur place)
  const internalFilename = `internal/${doc.file}`;
  let document = await prisma.knowledgeDocument.findFirst({
    where: { filename: internalFilename },
  });

  if (document) {
    await prisma.knowledgeChunk.deleteMany({ where: { documentId: document.id } });
    document = await prisma.knowledgeDocument.update({
      where: { id: document.id },
      data: {
        title: doc.title,
        sourceType: 'markdown',
        category: doc.category,
        tags: doc.tags,
        author: 'Documentation interne',
        status: 'PROCESSING',
        error: null,
      },
    });
    console.log(`[ingest] Document existant #${document.id} ré-indexé (${chunks.length} chunks)`);
  } else {
    document = await prisma.knowledgeDocument.create({
      data: {
        title: doc.title,
        sourceType: 'markdown',
        filename: internalFilename,
        category: doc.category,
        tags: doc.tags,
        author: 'Documentation interne',
        status: 'PROCESSING',
      },
    });
    console.log(`[ingest] Document créé #${document.id} : « ${doc.title} » (${chunks.length} chunks)`);
  }

  // Enrichissement identique à POST /api/knowledge/documents : le titre/catégorie/tags
  // sont sémantisés avec le chunk pour améliorer la recherche.
  const metaLine = `Document: ${doc.title} | Catégorie: ${doc.category} | Tags: ${doc.tags.join(', ')}`;
  let embedded = 0;
  let failed = 0;

  for (let i = 0; i < chunks.length; i++) {
    const enriched = `${metaLine}\nContenu: ${chunks[i]}`;
    let vectorLiteral = null;
    try {
      const vector = await generateEmbedding(enriched, 'RETRIEVAL_DOCUMENT');
      vectorLiteral = toVectorLiteral(vector);
      embedded++;
    } catch (err) {
      failed++;
      console.warn(`[ingest]   chunk ${i}: embedding échoué (${err.message.slice(0, 120)}) — inséré sans vecteur`);
    }

    if (vectorLiteral) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "KnowledgeChunk" (id, "documentId", "chunkIndex", content, embedding, "createdAt")
         VALUES (DEFAULT, $1, $2, $3, $4::vector, now())`,
        document.id, i, chunks[i], vectorLiteral,
      );
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "KnowledgeChunk" (id, "documentId", "chunkIndex", content, embedding, "createdAt")
         VALUES (DEFAULT, $1, $2, $3, NULL, now())`,
        document.id, i, chunks[i],
      );
    }
  }

  if (embedded === 0) {
    await prisma.knowledgeDocument.update({
      where: { id: document.id },
      data: { status: 'ERROR', error: 'Aucun chunk indexé en vecteur — vérifiez la configuration IA (embeddings)' },
    });
    console.error(`[ingest] ${doc.file} : ÉCHEC — 0/${chunks.length} embeddings générés`);
    return { ok: false, reason: 'no-embeddings' };
  }

  await prisma.knowledgeDocument.update({
    where: { id: document.id },
    data: { status: 'READY', error: failed > 0 ? `${failed} chunk(s) sans vecteur` : null },
  });
  console.log(`[ingest] ${doc.file} : READY — ${embedded}/${chunks.length} chunks vectorisés${failed ? ` (${failed} sans vecteur)` : ''}`);
  return { ok: true, documentId: document.id, chunks: chunks.length, embedded, failed };
}

async function main() {
  console.log(`[ingest] Début ingestion docs internes (dryRun=${DRY_RUN})`);
  const docs = DOC_FILTER ? INTERNAL_DOCS.filter((d) => d.file === DOC_FILTER) : INTERNAL_DOCS;
  if (docs.length === 0) {
    console.error(`[ingest] Aucun document ne correspond à --doc ${DOC_FILTER}. Disponibles : ${INTERNAL_DOCS.map((d) => d.file).join(', ')}`);
    process.exit(1);
  }

  let okCount = 0;
  for (const doc of docs) {
    const result = await ingestDoc(doc);
    if (result.ok) okCount++;
  }

  console.log(`[ingest] Terminé : ${okCount}/${docs.length} document(s) ingéré(s)`);
  await prisma.$disconnect();
  if (okCount !== docs.length) process.exit(1);
}

main().catch(async (err) => {
  console.error('[ingest] Erreur fatale :', err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
