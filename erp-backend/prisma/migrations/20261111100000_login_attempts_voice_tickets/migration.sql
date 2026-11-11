-- Lockout persistant + tickets vocaux à usage unique.
-- Le lockout quitte la Map mémoire (perdue au redémarrage) pour la base.
-- Les WebSockets ne peuvent pas porter d'en-tête Authorization : le front échange son
-- jeton d'accès contre un ticket 60 s à usage unique au lieu d'un JWT en query string.

CREATE TABLE IF NOT EXISTS "LoginAttempt" (
  "key"            TEXT NOT NULL,
  "count"          INTEGER NOT NULL DEFAULT 0,
  "firstAttemptAt" TIMESTAMP(3) NOT NULL,
  "lastAttemptAt"  TIMESTAMP(3) NOT NULL,
  "lockedUntil"    TIMESTAMP(3),
  CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "VoiceTicket" (
  "id"        SERIAL NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId"    INTEGER NOT NULL,
  "sessionId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VoiceTicket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "VoiceTicket_tokenHash_key" ON "VoiceTicket"("tokenHash");
CREATE INDEX IF NOT EXISTS "VoiceTicket_expiresAt_idx" ON "VoiceTicket"("expiresAt");

ALTER TABLE "VoiceTicket" DROP CONSTRAINT IF EXISTS "VoiceTicket_userId_fkey";
ALTER TABLE "VoiceTicket" ADD CONSTRAINT "VoiceTicket_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
