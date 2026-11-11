-- Révocation des sessions JWT : chaque changement/réinitialisation de mot de passe
-- incrémente tokenVersion ; les jetons portant une version antérieure sont rejetés.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;
