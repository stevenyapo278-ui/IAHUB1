-- Migration: escalation_engine
-- Moteur d'escalade : déclenchement automatique (TriageRule.autoEscalateMinutes) et manuel,
-- avec niveau d'escalade tracé sur le ticket.

-- Suivi d'escalade sur les tickets
ALTER TABLE "Ticket" ADD COLUMN "escalationLevel" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Ticket" ADD COLUMN "escalatedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN "escalateAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN "triageRuleId" INTEGER;
