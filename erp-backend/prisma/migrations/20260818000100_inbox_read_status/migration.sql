-- Suivi lu/non-lu des emails reçus (boîte mail façon Outlook)
ALTER TABLE "IncomingEmail" ADD COLUMN IF NOT EXISTS "isRead" BOOLEAN NOT NULL DEFAULT false;
