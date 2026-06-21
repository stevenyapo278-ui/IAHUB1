ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "glpiTeamsCategoriesSyncIntervalMinutes" INTEGER NOT NULL DEFAULT 10;
