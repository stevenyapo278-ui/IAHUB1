-- Migration: sender_reputation_feedback_loop
-- Boucle de rétroaction : réputation d'expéditeur apprise des décisions humaines
-- (approbations/rejets) + marquage des tickets issus d'expéditeurs dégradés.

-- Table de réputation d'expéditeur (apprise, pas de liste préétablie)
CREATE TABLE "SenderReputation" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "ticketsTotal" INTEGER NOT NULL DEFAULT 0,
    "ticketsApproved" INTEGER NOT NULL DEFAULT 0,
    "ticketsRejected" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'NORMAL',
    "degradedAt" TIMESTAMP(3),
    "lastDecisionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SenderReputation_pkey" PRIMARY KEY ("id")
);

-- Index unique sur email pour les upserts
CREATE UNIQUE INDEX "SenderReputation_email_key" ON "SenderReputation"("email");

-- Index pour l'agrégation par domaine et le filtrage par statut
CREATE INDEX "SenderReputation_domain_idx" ON "SenderReputation"("domain");
CREATE INDEX "SenderReputation_status_idx" ON "SenderReputation"("status");

-- Marquage des tickets issus d'un expéditeur dégradé (affichage "à risque" dans l'UI)
ALTER TABLE "Ticket" ADD COLUMN "lowTrustSender" BOOLEAN NOT NULL DEFAULT false;

-- Nouvel événement de traçabilité quand un ticket est créé depuis un expéditeur dégradé
ALTER TYPE "TicketEventType" ADD VALUE 'AI_LOW_TRUST_SENDER';
