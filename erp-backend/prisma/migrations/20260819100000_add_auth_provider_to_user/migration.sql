-- Ajouter le champ authProvider au modèle User : "local" (mot de passe en base)
-- ou "ldap" (connexion via Active Directory). Les comptes existants restent "local".
ALTER TABLE "User" ADD COLUMN "authProvider" TEXT NOT NULL DEFAULT 'local';
