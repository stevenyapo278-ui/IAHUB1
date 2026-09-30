-- Pièces jointes d'un problème : captures collées dans un suivi ou fichiers uploadés
-- (miroir de TicketAttachment, sans le lien vers l'email entrant).
-- Idempotent : la table peut déjà exister si un `prisma db push` a été exécuté.
CREATE TABLE IF NOT EXISTS "ProblemAttachment" (
    "id" SERIAL NOT NULL,
    "problemId" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT,
    "localFilepath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProblemAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProblemAttachment_problemId_idx" ON "ProblemAttachment"("problemId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProblemAttachment_problemId_fkey'
  ) THEN
    ALTER TABLE "ProblemAttachment"
      ADD CONSTRAINT "ProblemAttachment_problemId_fkey"
      FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
