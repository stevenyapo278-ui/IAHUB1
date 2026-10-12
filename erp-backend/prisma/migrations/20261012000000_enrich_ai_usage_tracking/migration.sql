-- AlterTable: AiUsageLog — enrichissement du suivi de consommation
ALTER TABLE "AiUsageLog" ADD COLUMN IF NOT EXISTS "model" TEXT;
ALTER TABLE "AiUsageLog" ADD COLUMN IF NOT EXISTS "userId" INTEGER;
ALTER TABLE "AiUsageLog" ADD COLUMN IF NOT EXISTS "durationMs" INTEGER;
ALTER TABLE "AiUsageLog" ADD COLUMN IF NOT EXISTS "estimated" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiUsageLog_model_idx" ON "AiUsageLog"("model");
CREATE INDEX IF NOT EXISTS "AiUsageLog_userId_idx" ON "AiUsageLog"("userId");
