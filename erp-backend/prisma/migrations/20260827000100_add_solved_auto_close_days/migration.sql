-- Fermeture automatique des tickets résolus : délai configurable en jours (0 = désactivé).
ALTER TABLE "SystemSettings" ADD COLUMN "solvedAutoCloseDays" INTEGER NOT NULL DEFAULT 3;
