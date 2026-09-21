-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "replyOnClosedSuggested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "replyOnClosedSuggestedAt" TIMESTAMP(3),
ADD COLUMN "replyOnClosedSender" TEXT,
ADD COLUMN "replyOnClosedSubject" TEXT,
ADD COLUMN "replyOnClosedBody" TEXT,
ADD COLUMN "replyOnClosedBodyHtml" TEXT;
