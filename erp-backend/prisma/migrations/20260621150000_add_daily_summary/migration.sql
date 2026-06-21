ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "dailySummaryEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "dailySummaryTime" TEXT NOT NULL DEFAULT '18:00';
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "dailySummaryRecipients" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "dailySummaryLastSentDate" TEXT;
