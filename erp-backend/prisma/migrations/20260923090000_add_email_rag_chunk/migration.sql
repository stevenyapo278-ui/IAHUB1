-- RAG des mails : chunks indexables pour IncomingEmail + TicketMessage
-- Idempotent : la table peut déjà exister si un `prisma db push` a été exécuté.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "EmailRagChunk" (
    "id" SERIAL NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL,
    "embedding" vector(768),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailRagChunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EmailRagChunk_createdAt_idx" ON "EmailRagChunk"("createdAt");
CREATE INDEX IF NOT EXISTS "EmailRagChunk_sourceType_idx" ON "EmailRagChunk"("sourceType");
CREATE UNIQUE INDEX IF NOT EXISTS "EmailRagChunk_sourceType_sourceId_chunkIndex_key"
    ON "EmailRagChunk"("sourceType", "sourceId", "chunkIndex");
-- Index GIN sur metadata pour accélérer les filtres JSONB (fromEmail, ticketId, ...)
CREATE INDEX IF NOT EXISTS "EmailRagChunk_metadata_idx" ON "EmailRagChunk" USING GIN (metadata jsonb_path_ops);
-- Index vectoriel HNSW (cosine) pour la recherche sémantique
CREATE INDEX IF NOT EXISTS "EmailRagChunk_embedding_idx"
    ON "EmailRagChunk" USING hnsw (embedding vector_cosine_ops);
