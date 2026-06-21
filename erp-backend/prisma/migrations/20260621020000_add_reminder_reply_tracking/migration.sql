ALTER TABLE "EmailApprovalToken" ADD COLUMN IF NOT EXISTS "reminderInternetMessageId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "EmailApprovalToken_reminderInternetMessageId_key" ON "EmailApprovalToken"("reminderInternetMessageId");
