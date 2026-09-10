-- CreateEnum
CREATE TYPE "TicketOrigin" AS ENUM ('MANUAL', 'PORTAIL', 'EMAIL', 'CHATBOT');

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "origin" "TicketOrigin";
