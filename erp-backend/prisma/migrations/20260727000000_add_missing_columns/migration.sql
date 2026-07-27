-- Migration: add_missing_columns
-- Ajoute les colonnes déclarées dans schema.prisma mais jamais créées par les migrations existantes

ALTER TABLE "SystemSettings"
  ADD COLUMN IF NOT EXISTS "glpiLocationsSyncIntervalMinutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "approvalReminderMinutes" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "lastGlpiSyncAt" TIMESTAMP(3);

ALTER TABLE "AiEmailDraft"
  ADD COLUMN IF NOT EXISTS "recipientName" TEXT;
