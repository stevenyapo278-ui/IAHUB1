-- Robusteification de la suggestion de clôture :
-- 1) Compteur de suggestions par ticket (plafonné pour éviter les boucles de re-suggestion)
-- 2) Réputation des clôtures par expéditeur (feedback de la Hotline)
-- 3) File de retry des actions de synchro GLPI différées (clôture validée mais GLPI down)

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "closeSuggestionCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SenderReputation" ADD COLUMN "closureTotal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SenderReputation" ADD COLUMN "closureApproved" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SenderReputation" ADD COLUMN "closureRejected" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SenderReputation" ADD COLUMN "closureStatus" TEXT NOT NULL DEFAULT 'NORMAL';

-- CreateTable
CREATE TABLE "GlpiSyncRetry" (
    "id" SERIAL NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlpiSyncRetry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GlpiSyncRetry_nextRetryAt_attempts_idx" ON "GlpiSyncRetry"("nextRetryAt", "attempts");