-- AlterTable: Add conversation state column for multi-turn context persistence
ALTER TABLE "Conversation" ADD COLUMN "state" JSONB;
