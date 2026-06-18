-- CreateTable
CREATE TABLE "AiEmailDraft" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER,
    "recipientEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "proposedContent" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiEmailDraft_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AiEmailDraft" ADD CONSTRAINT "AiEmailDraft_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEmailDraft" ADD CONSTRAINT "AiEmailDraft_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
