-- Migration: sla_starts_at_approval
-- Le SLA ne démarre qu'à l'approbation du ticket : on purge les échéances posées
-- à la création sur des tickets encore en attente (ou refusés), sinon le chrono
-- et les alertes de dépassement partent avant même la validation.
UPDATE "Ticket"
SET "slaResponseDueAt" = NULL,
    "slaResolutionDueAt" = NULL,
    "slaBreachedAt" = NULL
WHERE "approvalStatus" IN ('PENDING', 'REJECTED', 'SUPERSEDED')
  AND ("slaResponseDueAt" IS NOT NULL
    OR "slaResolutionDueAt" IS NOT NULL
    OR "slaBreachedAt" IS NOT NULL);
