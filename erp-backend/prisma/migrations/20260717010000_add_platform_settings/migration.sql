-- Migration: add_platform_settings
-- Ajoute les champs de configuration de la plateforme (date de bascule, comportement
-- sur ticket fermé, marqueur de source GLPI) à la table SystemSettings.

ALTER TABLE "SystemSettings"
  ADD COLUMN "goLiveDate"              TIMESTAMPTZ,
  ADD COLUMN "closedTicketBehavior"    TEXT NOT NULL DEFAULT 'create_new',
  ADD COLUMN "reopenThresholdDays"     INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN "glpiSourceMarker"        TEXT NOT NULL DEFAULT 'internal_note';
