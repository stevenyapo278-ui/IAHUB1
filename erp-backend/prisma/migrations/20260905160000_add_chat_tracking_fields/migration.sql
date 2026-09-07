-- AlterTable: Add tracking fields to ChatMessage
ALTER TABLE "ChatMessage" ADD COLUMN "intent" TEXT,
ADD COLUMN "tokensUsed" INTEGER,
ADD COLUMN "durationMs" INTEGER,
ADD COLUMN "flagged" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndexes for new fields
CREATE INDEX "ChatMessage_intent_idx" ON "ChatMessage"("intent");
CREATE INDEX "ChatMessage_flagged_idx" ON "ChatMessage"("flagged");
