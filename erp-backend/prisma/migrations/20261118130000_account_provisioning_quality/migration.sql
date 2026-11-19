-- ── Module « Création de comptes applicatifs » : qualité du pré-remplissage ──
-- 1) Télémétrie : conserve la proposition (applications/comptes suggérés), la
--    source (IA ou déterministe) et les applications hors catalogue rencontrées.
--    Objectif : mesurer le taux d'acceptation et piloter la boucle d'amélioration
--    du catalogue, sans jamais stocker de secret.
-- 2) Corrige un cas réel de double détection : « sage » (Sage X3) était aussi
--    contenu dans « sage paie » (Sage Paie). L'alias est retiré pour les bases
--    existantes ; il reste modifiable via Paramètres > Avancé.
ALTER TABLE "AccountProvisioningRecord"
  ADD COLUMN "prefillSource" TEXT,
  ADD COLUMN "prefillConfidence" DOUBLE PRECISION,
  ADD COLUMN "prefillSnapshot" JSONB,
  ADD COLUMN "ignoredApplications" JSONB NOT NULL DEFAULT '[]';

UPDATE "ApplicationCatalog"
SET "aliases" = array_remove("aliases", 'sage')
WHERE "name" = 'Sage X3';
