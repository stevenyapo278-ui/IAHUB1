-- CreateTable: TriageRule
-- Règles de triage automatique pour l'assignation des tickets sans appeler l'IA
CREATE TABLE IF NOT EXISTS "TriageRule" (
    "id" SERIAL NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "matchField" TEXT NOT NULL,
    "matchType" TEXT NOT NULL,
    "matchValue" TEXT NOT NULL,
    "category" TEXT,
    "skillName" TEXT,
    "teamName" TEXT,
    "ticketPriority" TEXT,
    "isSpam" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TriageRule_pkey" PRIMARY KEY ("id")
);
