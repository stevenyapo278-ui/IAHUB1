-- AlterTable: Ajouter le réglage de notification email au technicien assigné
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "notifyTechnicianOnAssignment" BOOLEAN NOT NULL DEFAULT false;
