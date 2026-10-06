-- Affectation automatique des tickets créés par un formulaire de demande :
-- configurable côté Paramètres (bloc dédié de l'éditeur), jamais saisi par le
-- demandeur. Clés possibles : teamId, assignedToId, priority, type, urgency,
-- impact, locationId, source — appliquées à chaque soumission.
ALTER TABLE "FormDefinition" ADD COLUMN "assignment" JSONB;
