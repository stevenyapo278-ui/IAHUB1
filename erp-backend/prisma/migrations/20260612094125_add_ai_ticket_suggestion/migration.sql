-- CreateTable
CREATE TABLE "AiTicketSuggestion" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "suggestion" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiTicketSuggestion_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AiTicketSuggestion" ADD CONSTRAINT "AiTicketSuggestion_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
