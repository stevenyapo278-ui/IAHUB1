-- Durcissement des sessions : détection de réutilisation du refresh token (token family)
-- et suppression des tokens de réinitialisation stockés en clair.

-- 1) Sessions : mémorise le hash précédent pour détecter le rejeu d'un token déjà tourné.
ALTER TABLE "AuthSession" ADD COLUMN IF NOT EXISTS "previousTokenHash" TEXT;
ALTER TABLE "AuthSession" ADD COLUMN IF NOT EXISTS "rotatedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "AuthSession_previousTokenHash_idx" ON "AuthSession"("previousTokenHash");

-- 2) Réinitialisation de mot de passe : ne stocker que le hash SHA-256.
--    Les liens existants (stockés en clair) sont invalidés : l'utilisateur doit refaire
--    une demande « mot de passe oublié ».
ALTER TABLE "PasswordResetToken" ADD COLUMN IF NOT EXISTS "tokenHash" TEXT;
DELETE FROM "PasswordResetToken";
ALTER TABLE "PasswordResetToken" ALTER COLUMN "tokenHash" SET NOT NULL;
DROP INDEX IF EXISTS "PasswordResetToken_token_key";
ALTER TABLE "PasswordResetToken" DROP COLUMN IF EXISTS "token";
CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
