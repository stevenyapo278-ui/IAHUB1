-- Validation hiérarchique conditionnelle des demandes de reporting :
--  - FormDefinition.approval : déclencheur posé dans l'éditeur (Paramètres),
--    { enabled, trigger: { question, equals? } } — « quand un élément est
--    coché ou choisi, la demande doit être validée par le supérieur ».
--  - TicketApproval : demande d'approbation envoyée par e-mail au supérieur
--    hiérarchique (avec copies CC), répondue via un lien public à token
--    opaque unique — le supérieur n'a pas de compte sur la plateforme.
ALTER TABLE "FormDefinition" ADD COLUMN "approval" JSONB;

-- CreateTable
CREATE TABLE "TicketApproval" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "formId" INTEGER,
    "managerEmail" TEXT NOT NULL,
    "cc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "decisionComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketApproval_token_key" ON "TicketApproval"("token");

-- CreateIndex
CREATE INDEX "TicketApproval_ticketId_idx" ON "TicketApproval"("ticketId");

-- AddForeignKey
ALTER TABLE "TicketApproval" ADD CONSTRAINT "TicketApproval_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
