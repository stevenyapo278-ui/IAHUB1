-- Config de l'apprentissage IA hebdomadaire (page /ai-weekly-reports) :
-- génération automatique (actif + jour/heure), seuils de propositions de règles
-- (occurrences min., rejets/domaine, confiance min.) et fenêtre glissante d'analyse.
ALTER TABLE "SystemSettings"
  ADD COLUMN "aiWeeklyAutoEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "aiWeeklyDay" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "aiWeeklyHour" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "aiWeeklyMinOccurrences" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "aiWeeklyDomainThreshold" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "aiWeeklyConfidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  ADD COLUMN "aiWeeklyWindowDays" INTEGER NOT NULL DEFAULT 7;
