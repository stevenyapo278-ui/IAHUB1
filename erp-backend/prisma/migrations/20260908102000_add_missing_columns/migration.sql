-- AlterTable: Add missing columns to Ticket
ALTER TABLE "Ticket" ADD COLUMN "locationId" INTEGER;
ALTER TABLE "Ticket" ADD COLUMN "locationName" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "secondaryRequesterId" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Ticket_secondaryRequesterId_idx" ON "Ticket"("secondaryRequesterId");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_secondaryRequesterId_fkey" FOREIGN KEY ("secondaryRequesterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: Add missing column to SystemSettings
ALTER TABLE "SystemSettings" ADD COLUMN "emailFailureNotificationRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[];
