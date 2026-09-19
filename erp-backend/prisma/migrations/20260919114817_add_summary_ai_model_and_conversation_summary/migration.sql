-- AlterTable: Add summaryAiModelId to SystemSettings
ALTER TABLE "SystemSettings" ADD COLUMN "summaryAiModelId" INTEGER;

-- CreateIndex: Unique constraint for summaryAiModelId
CREATE UNIQUE INDEX "SystemSettings_summaryAiModelId_key" ON "SystemSettings"("summaryAiModelId");

-- AddForeignKey: summaryAiModelId -> AiModel
ALTER TABLE "SystemSettings" ADD CONSTRAINT "SystemSettings_summaryAiModelId_fkey" FOREIGN KEY ("summaryAiModelId") REFERENCES "AiModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: Add summary to Conversation
ALTER TABLE "Conversation" ADD COLUMN "summary" TEXT;
