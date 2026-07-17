-- Migration: add_transition_controls
-- Ajoute les contrôles de transition : dry-run (audit), création de suivis, fermeture de tickets.

ALTER TABLE "SystemSettings"
  ADD COLUMN "dryRunMode"                   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "enableGlpiFollowupCreation"   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "enableGlpiTicketClosure"      BOOLEAN NOT NULL DEFAULT true;
