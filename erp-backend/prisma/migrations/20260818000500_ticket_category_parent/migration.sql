-- Catégories arborescentes : parentId sur TicketCategory (sous-catégories)
ALTER TABLE "TicketCategory" ADD COLUMN IF NOT EXISTS "parentId" INTEGER;

CREATE INDEX IF NOT EXISTS "TicketCategory_parentId_idx" ON "TicketCategory"("parentId");

ALTER TABLE "TicketCategory" ADD CONSTRAINT "TicketCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TicketCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
