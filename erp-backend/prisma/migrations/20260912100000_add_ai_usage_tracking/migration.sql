-- AlterTable: SystemSettings
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "aiEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "aiDailyTokenBudget" INTEGER NOT NULL DEFAULT 100000;
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "aiTokenAlertThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.8;
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "aiTokenAlertRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable: AiUsageLog
CREATE TABLE IF NOT EXISTS "AiUsageLog" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "usage" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiUsageLog_provider_idx" ON "AiUsageLog"("provider");
CREATE INDEX IF NOT EXISTS "AiUsageLog_createdAt_idx" ON "AiUsageLog"("createdAt");
CREATE INDEX IF NOT EXISTS "AiUsageLog_usage_idx" ON "AiUsageLog"("usage");
