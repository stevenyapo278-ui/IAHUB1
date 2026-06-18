-- CreateTable
CREATE TABLE "IncomingEmail" (
    "id" SERIAL NOT NULL,
    "graphMessageId" TEXT NOT NULL,
    "emailAccountId" INTEGER NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT,
    "subject" TEXT NOT NULL,
    "bodyPreview" TEXT,
    "bodyHtml" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "aiSummary" TEXT,
    "aiCategory" TEXT,
    "aiPriority" TEXT,
    "aiTeam" TEXT,
    "aiConfidence" DOUBLE PRECISION,
    "aiIsSpam" BOOLEAN NOT NULL DEFAULT false,
    "glpiTicketId" INTEGER,
    "erpTicketId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomingEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncomingEmail_graphMessageId_key" ON "IncomingEmail"("graphMessageId");
