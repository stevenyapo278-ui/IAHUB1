-- Multi-assignation des problèmes : table de jointure Problem <-> User (miroir de _TicketAssignees).
-- assignedToId (porteur principal) reste en place pour la compatibilité.
-- IF NOT EXISTS partout : la structure peut avoir été posée manuellement en dev — la
-- migration doit rester applicable dans les deux cas.
CREATE TABLE IF NOT EXISTS "_ProblemAssignees" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_ProblemAssignees_A_fkey" FOREIGN KEY ("A") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_ProblemAssignees_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "_ProblemAssignees_AB_unique" ON "_ProblemAssignees"("A", "B");
CREATE INDEX IF NOT EXISTS "_ProblemAssignees_B_index" ON "_ProblemAssignees"("B");

-- Édition des suivis : trace de la dernière modification (miroir de Followup.updatedAt).
ALTER TABLE "ProblemFollowup" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
