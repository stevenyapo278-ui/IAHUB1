-- Soft delete des tickets : corbeille + rollback possible
ALTER TABLE "Ticket" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN "deletedById" INTEGER;

-- Index partiel : seuls les tickets supprimés sont interrogés par la corbeille
CREATE INDEX "Ticket_deletedAt_idx" ON "Ticket"("deletedAt");

-- L'auteur d'une suppression peut lui-même être supprimé sans casser l'audit
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_deletedById_fkey" 
  FOREIGN KEY ("deletedById") REFERENCES "User"("id") 
  ON DELETE SET NULL ON UPDATE CASCADE;
