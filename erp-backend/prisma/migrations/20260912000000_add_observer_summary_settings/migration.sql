-- AlterTable: add observer summary settings columns
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "observerSummaryEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "observerSummaryDay" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "observerSummaryTime" TEXT NOT NULL DEFAULT '09:00';
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "observerSummaryLastSentDate" TEXT;