-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN "draftReminderExcludeEmails" TEXT[] DEFAULT '{}';
