-- Migration: sla_engine
-- Moteur SLA : échéances de réponse/résolution par priorité, détection de dépassement,
-- et temps de première réponse (métrique).

-- Échéances SLA et première réponse sur les tickets
ALTER TABLE "Ticket" ADD COLUMN "slaResponseDueAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN "slaResolutionDueAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN "slaBreachedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN "firstResponseAt" TIMESTAMP(3);

-- Seuils SLA configurables (JSON { P1: { response: 1, resolution: 4 }, ... } en heures) +
-- fréquence de détection des dépassements
ALTER TABLE "SystemSettings" ADD COLUMN "slaHours" JSONB;
ALTER TABLE "SystemSettings" ADD COLUMN "slaMonitorIntervalSeconds" INTEGER NOT NULL DEFAULT 60;

-- Événements de traçabilité SLA
ALTER TYPE "TicketEventType" ADD VALUE 'SLA_BREACHED';
ALTER TYPE "TicketEventType" ADD VALUE 'SLA_UPDATED';
ALTER TYPE "TicketEventType" ADD VALUE 'ESCALATION_REQUESTED';
ALTER TYPE "TicketEventType" ADD VALUE 'MERGED_INTO';
ALTER TYPE "TicketEventType" ADD VALUE 'MERGED_FROM';
