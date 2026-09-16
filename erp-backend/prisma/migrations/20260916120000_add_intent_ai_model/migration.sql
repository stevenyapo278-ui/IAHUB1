-- AlterTable: Add intentAiModelId to SystemSettings
ALTER TABLE "SystemSettings" ADD COLUMN "intentAiModelId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "SystemSettings_intentAiModelId_key" ON "SystemSettings"("intentAiModelId");

-- AddForeignKey
ALTER TABLE "SystemSettings" ADD CONSTRAINT "SystemSettings_intentAiModelId_fkey" FOREIGN KEY ("intentAiModelId") REFERENCES "AiModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
