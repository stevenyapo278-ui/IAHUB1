-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "EmailAttachmentSource" AS ENUM ('MANUAL_UPLOAD', 'INCOMING_EMAIL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable IncomingEmail
ALTER TABLE "IncomingEmail" ADD COLUMN IF NOT EXISTS "ccRecipients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "IncomingEmail" ADD COLUMN IF NOT EXISTS "hasAttachments" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable TicketAttachment
ALTER TABLE "TicketAttachment" ADD COLUMN IF NOT EXISTS "source" "EmailAttachmentSource" NOT NULL DEFAULT 'MANUAL_UPLOAD';
ALTER TABLE "TicketAttachment" ADD COLUMN IF NOT EXISTS "incomingEmailId" INTEGER;

DO $$ BEGIN
  ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_incomingEmailId_fkey"
    FOREIGN KEY ("incomingEmailId") REFERENCES "IncomingEmail"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable TicketMessage
ALTER TABLE "TicketMessage" ADD COLUMN IF NOT EXISTS "ccRecipients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable AiEmailDraft
ALTER TABLE "AiEmailDraft" ADD COLUMN IF NOT EXISTS "glpiTicketId" INTEGER;
ALTER TABLE "AiEmailDraft" ADD COLUMN IF NOT EXISTS "ccRecipients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
