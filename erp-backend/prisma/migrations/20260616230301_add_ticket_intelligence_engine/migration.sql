-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "TicketEventType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'ASSIGNED', 'EMAIL_RECEIVED', 'EMAIL_SENT', 'FOLLOWUP_ADDED', 'AI_ANALYZED', 'AI_DRAFT_GENERATED', 'KNOWLEDGE_CREATED', 'REOPENED', 'ESCALATED', 'REMINDER_SENT', 'CLOSED_AUTO');

-- AlterEnum
ALTER TYPE "TicketStatus" ADD VALUE 'WAITING_FOR_USER';

-- AlterTable
ALTER TABLE "IncomingEmail" ADD COLUMN     "aiIntent" TEXT,
ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "inReplyTo" TEXT,
ADD COLUMN     "internetMessageId" TEXT,
ADD COLUMN     "isNewTicket" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "references" TEXT;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "aiSummary" TEXT,
ADD COLUMN     "lastUserReplyAt" TIMESTAMP(3),
ADD COLUMN     "outlookConversationId" TEXT,
ADD COLUMN     "reminderCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TicketMessage" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "sender" TEXT NOT NULL,
    "recipients" TEXT[],
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "outlookMessageId" TEXT,
    "internetMessageId" TEXT,
    "inReplyTo" TEXT,
    "conversationId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketEvent" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "type" "TicketEventType" NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'SYSTEM',
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderConfig" (
    "id" SERIAL NOT NULL,
    "firstReminderDays" INTEGER NOT NULL DEFAULT 2,
    "secondReminderDays" INTEGER NOT NULL DEFAULT 5,
    "preCloseDays" INTEGER NOT NULL DEFAULT 10,
    "autoCloseDays" INTEGER NOT NULL DEFAULT 15,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketMessage_outlookMessageId_key" ON "TicketMessage"("outlookMessageId");

-- CreateIndex
CREATE INDEX "TicketMessage_ticketId_idx" ON "TicketMessage"("ticketId");

-- CreateIndex
CREATE INDEX "TicketMessage_conversationId_idx" ON "TicketMessage"("conversationId");

-- CreateIndex
CREATE INDEX "TicketEvent_ticketId_idx" ON "TicketEvent"("ticketId");

-- CreateIndex
CREATE INDEX "IncomingEmail_conversationId_idx" ON "IncomingEmail"("conversationId");

-- CreateIndex
CREATE INDEX "IncomingEmail_internetMessageId_idx" ON "IncomingEmail"("internetMessageId");

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
