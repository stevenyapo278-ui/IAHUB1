-- AlterTable: ajouter createdById sur TicketCategory
ALTER TABLE "TicketCategory" ADD COLUMN "createdById" INTEGER;

-- ForeignKey
ALTER TABLE "TicketCategory" ADD CONSTRAINT "TicketCategory_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Index
CREATE INDEX "TicketCategory_createdById_idx" ON "TicketCategory"("createdById");
