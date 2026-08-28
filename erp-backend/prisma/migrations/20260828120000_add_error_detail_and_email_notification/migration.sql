-- AlterTable
ALTER TABLE "IncomingEmail" ADD COLUMN "errorDetail" TEXT;

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN "emailFailureNotificationEmail" TEXT;
