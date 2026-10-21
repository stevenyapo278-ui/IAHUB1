-- AlterTable: AiUsageLog — tag « source » = tâche précise appelante (découpe du contexte 'background')
ALTER TABLE "AiUsageLog" ADD COLUMN IF NOT EXISTS "source" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiUsageLog_source_idx" ON "AiUsageLog"("source");
