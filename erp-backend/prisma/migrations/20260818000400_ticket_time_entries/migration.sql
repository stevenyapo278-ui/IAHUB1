-- Timesheet : temps passé par technicien sur chaque ticket
CREATE TABLE IF NOT EXISTS "TicketTimeEntry" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "minutes" INTEGER NOT NULL,
    "description" TEXT,
    "entryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketTimeEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TicketTimeEntry_ticketId_idx" ON "TicketTimeEntry"("ticketId");
CREATE INDEX IF NOT EXISTS "TicketTimeEntry_userId_idx" ON "TicketTimeEntry"("userId");
CREATE INDEX IF NOT EXISTS "TicketTimeEntry_entryDate_idx" ON "TicketTimeEntry"("entryDate");

ALTER TABLE "TicketTimeEntry" ADD CONSTRAINT "TicketTimeEntry_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketTimeEntry" ADD CONSTRAINT "TicketTimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
