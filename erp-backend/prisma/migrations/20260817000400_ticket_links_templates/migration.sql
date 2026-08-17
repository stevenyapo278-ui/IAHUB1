-- TicketLink : liens entre tickets (liés, doublon, bloque/bloqué)
CREATE TABLE "TicketLink" (
  "id" SERIAL PRIMARY KEY,
  "ticketAId" INTEGER NOT NULL REFERENCES "Ticket"("id") ON DELETE CASCADE,
  "ticketBId" INTEGER NOT NULL REFERENCES "Ticket"("id") ON DELETE CASCADE,
  "type" TEXT NOT NULL DEFAULT 'RELATED',
  "createdById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketLink_ticketAId_ticketBId_type_key" UNIQUE ("ticketAId", "ticketBId", "type")
);
CREATE INDEX "TicketLink_ticketBId_idx" ON "TicketLink"("ticketBId");

-- TicketTemplate : modèles de ticket réutilisables
CREATE TABLE "TicketTemplate" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "priority" TEXT,
  "category" TEXT,
  "type" TEXT,
  "urgency" TEXT,
  "impact" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Nouveaux types d'événements
ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'LINKED';
ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'UNLINKED';