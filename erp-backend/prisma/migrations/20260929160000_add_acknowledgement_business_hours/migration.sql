-- Variantes horaires de l'accusé de réception : message dédié hors horaires,
-- toggle d'activation et plage d'ouverture (jours + heures) configurables.
ALTER TABLE "SystemSettings"
  ADD COLUMN "acknowledgementOffHoursMessage" TEXT,
  ADD COLUMN "acknowledgementBusinessHoursEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "acknowledgementBusinessDays" INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::INTEGER[],
  ADD COLUMN "acknowledgementBusinessStartTime" TEXT NOT NULL DEFAULT '08:00',
  ADD COLUMN "acknowledgementBusinessEndTime" TEXT NOT NULL DEFAULT '17:00';
