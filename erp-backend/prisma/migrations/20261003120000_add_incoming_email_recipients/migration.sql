-- Colonne "To" des destinataires d'un email entrant (affichage "À :" dans la conversation Inbox)
ALTER TABLE "IncomingEmail" ADD COLUMN IF NOT EXISTS "recipients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
