-- CreateTable
CREATE TABLE IF NOT EXISTS "_TicketAssignees" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "_TicketAssignees_AB_unique" ON "_TicketAssignees"("A", "B");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "_TicketAssignees_B_index" ON "_TicketAssignees"("B");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '_TicketAssignees_A_fkey') THEN
        ALTER TABLE "_TicketAssignees" ADD CONSTRAINT "_TicketAssignees_A_fkey" FOREIGN KEY ("A") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '_TicketAssignees_B_fkey') THEN
        ALTER TABLE "_TicketAssignees" ADD CONSTRAINT "_TicketAssignees_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Populate existing assignedToId into _TicketAssignees for backward compatibility
INSERT INTO "_TicketAssignees" ("A", "B")
SELECT "id", "assignedToId" FROM "Ticket" WHERE "assignedToId" IS NOT NULL
ON CONFLICT DO NOTHING;
