-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "ticketCreationEmailEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ticketCreationEmailRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[];
