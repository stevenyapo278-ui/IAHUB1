-- AlterTable
ALTER TABLE "Followup" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'erp',
ADD COLUMN "glpiFollowupId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Followup_glpiFollowupId_key" ON "Followup"("glpiFollowupId");
