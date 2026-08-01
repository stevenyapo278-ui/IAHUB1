-- Migration: closure_human_validation
-- Toutes les clôtures suggérées par l'IA passent par une validation humaine
-- dans le Centre de Validation avant de passer SOLVED.

-- Marquage d'une clôture suggérée par l'IA (détection de résolution)
ALTER TABLE "Ticket" ADD COLUMN "closeSuggested" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Ticket" ADD COLUMN "closeSuggestedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN "closeSuggestionConfidence" DOUBLE PRECISION;

-- Événements de traçabilité du cycle de vie de la clôture validée par un humain
ALTER TYPE "TicketEventType" ADD VALUE 'CLOSURE_SUGGESTED';
ALTER TYPE "TicketEventType" ADD VALUE 'CLOSURE_VALIDATED';
ALTER TYPE "TicketEventType" ADD VALUE 'CLOSURE_REJECTED';
