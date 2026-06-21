ALTER TABLE "AiEmailDraft" ADD COLUMN IF NOT EXISTS "inReplyToGraphMessageId" TEXT;
ALTER TABLE "AiEmailDraft" ADD COLUMN IF NOT EXISTS "outlookConversationId" TEXT;
