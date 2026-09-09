-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN "voiceAiModelId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "SystemSettings_voiceAiModelId_key" ON "SystemSettings"("voiceAiModelId");

-- AddForeignKey
ALTER TABLE "SystemSettings" ADD CONSTRAINT "SystemSettings_voiceAiModelId_fkey" FOREIGN KEY ("voiceAiModelId") REFERENCES "AiModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
