-- Module « Création de comptes applicatifs ».
--
-- 1) Toggle SUPERADMIN sur SystemSettings : à l'activation, un technicien doit déclarer
--    les comptes applicatifs créés avant de pouvoir passer un ticket à SOLVED.
-- 2) Catalogue fermé des applications (alias pour le matching déterministe et IA).
-- 3) Déclaration par ticket (source de vérité), miroir Budibase asynchrone.
--
-- Aucun mot de passe n'est stocké : seuls le login, l'email, le profil et le canal de
-- transmission du secret sont conservés.

ALTER TABLE "SystemSettings"
  ADD COLUMN IF NOT EXISTS "accountProvisioningEnabled"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "accountProvisioningAiPrefill"     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "accountProvisioningRetrySeconds"  INTEGER NOT NULL DEFAULT 300;

CREATE TABLE IF NOT EXISTS "ApplicationCatalog" (
  "id"        SERIAL NOT NULL,
  "name"      TEXT NOT NULL,
  "aliases"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "fields"    JSONB,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApplicationCatalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApplicationCatalog_name_key" ON "ApplicationCatalog"("name");
CREATE INDEX IF NOT EXISTS "ApplicationCatalog_isActive_idx" ON "ApplicationCatalog"("isActive");

CREATE TABLE IF NOT EXISTS "AccountProvisioningRecord" (
  "id"                SERIAL NOT NULL,
  "ticketId"          INTEGER NOT NULL,
  "applicationId"     INTEGER,
  "applications"      JSONB NOT NULL DEFAULT '[]'::jsonb,
  "accounts"          JSONB NOT NULL,
  "accountsCount"     INTEGER NOT NULL DEFAULT 1,
  "source"            TEXT NOT NULL DEFAULT 'MANUAL',
  "aiConfidence"      DOUBLE PRECISION,
  "createdById"       INTEGER,
  "budibaseStatus"    TEXT NOT NULL DEFAULT 'PENDING',
  "budibaseRowId"     TEXT,
  "budibaseSyncedAt"  TIMESTAMP(3),
  "idempotencyKey"    TEXT NOT NULL,
  "syncAttempts"      INTEGER NOT NULL DEFAULT 0,
  "lastError"         TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountProvisioningRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AccountProvisioningRecord_ticketId_key" ON "AccountProvisioningRecord"("ticketId");
CREATE UNIQUE INDEX IF NOT EXISTS "AccountProvisioningRecord_idempotencyKey_key" ON "AccountProvisioningRecord"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "AccountProvisioningRecord_budibaseStatus_idx" ON "AccountProvisioningRecord"("budibaseStatus");
CREATE INDEX IF NOT EXISTS "AccountProvisioningRecord_createdById_idx" ON "AccountProvisioningRecord"("createdById");
CREATE INDEX IF NOT EXISTS "AccountProvisioningRecord_applicationId_idx" ON "AccountProvisioningRecord"("applicationId");
CREATE INDEX IF NOT EXISTS "AccountProvisioningRecord_createdAt_idx" ON "AccountProvisioningRecord"("createdAt");

DO $$ BEGIN
  ALTER TABLE "AccountProvisioningRecord"
    ADD CONSTRAINT "AccountProvisioningRecord_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AccountProvisioningRecord"
    ADD CONSTRAINT "AccountProvisioningRecord_applicationId_fkey"
    FOREIGN KEY ("applicationId") REFERENCES "ApplicationCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AccountProvisioningRecord"
    ADD CONSTRAINT "AccountProvisioningRecord_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
