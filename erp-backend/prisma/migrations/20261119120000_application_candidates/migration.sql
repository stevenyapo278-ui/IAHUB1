-- File de validation des applications citées hors catalogue.
--
-- L'IA ne crée jamais une application : quand un ticket mentionne un logiciel
-- absent du référentiel, le nom est enregistré ici (une ligne par nom normalisé)
-- puis un SUPERADMIN le promeut en application du catalogue ou l'ignore.

CREATE TABLE IF NOT EXISTS "ApplicationCandidate" (
  "id"                SERIAL NOT NULL,
  "name"              TEXT NOT NULL,
  "normalizedName"    TEXT NOT NULL,
  "occurrences"       INTEGER NOT NULL DEFAULT 1,
  "status"            TEXT NOT NULL DEFAULT 'PENDING',
  "lastTicketId"      INTEGER,
  "promotedCatalogId" INTEGER,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApplicationCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApplicationCandidate_normalizedName_key" ON "ApplicationCandidate"("normalizedName");
CREATE INDEX IF NOT EXISTS "ApplicationCandidate_status_idx" ON "ApplicationCandidate"("status");
CREATE INDEX IF NOT EXISTS "ApplicationCandidate_lastSeenAt_idx" ON "ApplicationCandidate"("lastSeenAt");
