-- Mode autonome : la plateforme peut fonctionner comme outil d'e-ticketing sans GLPI.
-- Quand autonomousMode est actif, toutes les synchronisations/écritures GLPI sont désactivées
-- (getActiveGlpiConfig retourne null), mais le ticketing local reste pleinement fonctionnel.
ALTER TABLE "SystemSettings" ADD COLUMN "autonomousMode" BOOLEAN NOT NULL DEFAULT false;

-- Catégories locales : glpiCategoryId devient optionnel (null pour les catégories créées
-- manuellement dans l'ERP) et on ajoute un drapeau isCustom, sur le modèle de GlpiLocation.
ALTER TABLE "TicketCategory" ALTER COLUMN "glpiCategoryId" DROP NOT NULL;
ALTER TABLE "TicketCategory" ADD COLUMN "isCustom" BOOLEAN NOT NULL DEFAULT false;
