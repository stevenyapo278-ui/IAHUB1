-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN "needsHumanReviewNotificationEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SystemSettings" ADD COLUMN "needsHumanReviewRecipients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
