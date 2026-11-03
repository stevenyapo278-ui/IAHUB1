-- Thème saisonnier : permet à l'admin de forcer le thème de Noël pour tous les utilisateurs
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "xmasForceEnabled" BOOLEAN NOT NULL DEFAULT false;
