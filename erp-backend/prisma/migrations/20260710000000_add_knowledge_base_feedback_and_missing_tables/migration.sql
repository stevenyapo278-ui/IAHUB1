-- AlterTable
ALTER TABLE "KnowledgeDocument" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "KnowledgeDocument" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "KnowledgeDocument" ADD COLUMN IF NOT EXISTS "author" TEXT;

-- AlterTable
ALTER TABLE "KnowledgeDraft" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "KnowledgeDraft" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "KnowledgeFeedbackRating" AS ENUM ('NOT_RELEVANT', 'SOMEWHAT_RELEVANT', 'VERY_RELEVANT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "KnowledgeFeedback" (
    "id" SERIAL NOT NULL,
    "documentId" INTEGER NOT NULL,
    "chunkId" INTEGER,
    "query" TEXT NOT NULL,
    "rating" "KnowledgeFeedbackRating" NOT NULL,
    "comment" TEXT,
    "userEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TicketMapping" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "requesterEmail" TEXT,
    "ticketId" INTEGER,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MailEvent" (
    "id" SERIAL NOT NULL,
    "messageId" TEXT NOT NULL,
    "conversationId" TEXT,
    "fromEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "decision" JSONB NOT NULL,
    "relatedTicketId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MailError" (
    "id" SERIAL NOT NULL,
    "messageId" TEXT NOT NULL,
    "conversationId" TEXT,
    "fromEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "errorStage" TEXT NOT NULL,
    "errorDetails" TEXT,
    "rawSubworkflowOutput" TEXT,
    "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SupportTeam" (
    "id" SERIAL NOT NULL,
    "teamName" TEXT NOT NULL,
    "glpiGroupName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TicketSimilarityIndex" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "bodyShort" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1024),
    "status" TEXT NOT NULL,
    "requesterEmail" TEXT NOT NULL,
    "metadata" JSONB,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketSimilarityIndex_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SupportTeam_teamName_key" ON "SupportTeam"("teamName");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TicketMapping_conversationId_idx" ON "TicketMapping"("conversationId");
CREATE INDEX IF NOT EXISTS "TicketMapping_messageId_idx" ON "TicketMapping"("messageId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MailEvent_messageId_idx" ON "MailEvent"("messageId");
CREATE INDEX IF NOT EXISTS "MailEvent_conversationId_idx" ON "MailEvent"("conversationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MailError_messageId_idx" ON "MailError"("messageId");
CREATE INDEX IF NOT EXISTS "MailError_conversationId_idx" ON "MailError"("conversationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TicketSimilarityIndex_ticketId_idx" ON "TicketSimilarityIndex"("ticketId");
CREATE INDEX IF NOT EXISTS "TicketSimilarityIndex_requesterEmail_idx" ON "TicketSimilarityIndex"("requesterEmail");

-- AddForeignKey
ALTER TABLE "KnowledgeFeedback" DROP CONSTRAINT IF EXISTS "KnowledgeFeedback_documentId_fkey";
ALTER TABLE "KnowledgeFeedback" ADD CONSTRAINT "KnowledgeFeedback_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
