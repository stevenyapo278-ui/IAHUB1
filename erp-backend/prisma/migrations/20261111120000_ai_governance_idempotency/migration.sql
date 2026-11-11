-- Gouvernance des outils de l'agent + idempotence des actions externes.
--
-- 1) Kill switch d'IA actionnable sans redémarrage (SystemSettings) : arrêt d'urgence
--    de tous les appels IA et de toute exécution d'outil, plus un interrupteur dédié
--    aux actions d'écriture/externes et une liste de refus explicite d'outils.
-- 2) Journal d'idempotence : une action à effet externe (envoi d'email, création de
--    ticket par l'agent…) déjà exécutée n'est jamais rejouée après retry/restauration.

ALTER TABLE "SystemSettings"
  ADD COLUMN IF NOT EXISTS "aiKillSwitch"       BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "aiKillSwitchReason" TEXT,
  ADD COLUMN IF NOT EXISTS "aiKillSwitchAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "aiKillSwitchBy"     TEXT,
  ADD COLUMN IF NOT EXISTS "aiWritesEnabled"    BOOLEAN   NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "aiDisabledTools"    TEXT[]    NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE IF NOT EXISTS "IdempotencyRecord" (
  "id"           SERIAL NOT NULL,
  "key"          TEXT NOT NULL,
  "scope"        TEXT NOT NULL,
  "userId"       INTEGER,
  "requestHash"  TEXT NOT NULL,
  "state"        TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  "responseBody" JSONB,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "IdempotencyRecord_key_key" ON "IdempotencyRecord"("key");
CREATE INDEX IF NOT EXISTS "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");
CREATE INDEX IF NOT EXISTS "IdempotencyRecord_scope_idx" ON "IdempotencyRecord"("scope");
