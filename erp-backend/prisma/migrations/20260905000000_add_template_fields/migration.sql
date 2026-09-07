-- AlterTable: Add new fields to TicketTemplate
ALTER TABLE "TicketTemplate" ADD COLUMN "source" TEXT,
ADD COLUMN "locationId" INTEGER,
ADD COLUMN "teamId" INTEGER,
ADD COLUMN "assignedToId" INTEGER,
ADD COLUMN "dueDate" TIMESTAMP(3),
ADD COLUMN "requiresApproval" BOOLEAN NOT NULL DEFAULT false;
