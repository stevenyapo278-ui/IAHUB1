-- CreateEnum
CREATE TYPE "ProblemStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'ASSIGNED', 'PLANNED', 'WAITING', 'SOLVED', 'CLOSED', 'OBSERVED');

-- CreateTable
CREATE TABLE "Problem" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ProblemStatus" NOT NULL DEFAULT 'NEW',
    "priority" "TicketPriority" NOT NULL DEFAULT 'P3',
    "urgency" "TicketUrgency" NOT NULL DEFAULT 'MEDIUM',
    "impact" "TicketImpact" NOT NULL DEFAULT 'MEDIUM',
    "category" TEXT,
    "glpiLocationId" INTEGER,
    "glpiLocationName" TEXT,
    "dueDate" TIMESTAMP(3),
    "requesterId" INTEGER,
    "assignedToId" INTEGER,
    "teamId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "solvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemTicket" (
    "id" SERIAL NOT NULL,
    "problemId" INTEGER NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProblemTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemFollowup" (
    "id" SERIAL NOT NULL,
    "problemId" INTEGER NOT NULL,
    "authorId" INTEGER,
    "content" TEXT NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProblemFollowup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemEvent" (
    "id" SERIAL NOT NULL,
    "problemId" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'CREATED',
    "actor" TEXT NOT NULL DEFAULT 'SYSTEM',
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProblemEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemLink" (
    "id" SERIAL NOT NULL,
    "problemAId" INTEGER NOT NULL,
    "problemBId" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'RELATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProblemLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ProblemObservers" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_ProblemObservers_AB_unique" ON "_ProblemObservers"("A", "B");

-- CreateIndex
CREATE INDEX "_ProblemObservers_B_index" ON "_ProblemObservers"("B");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemTicket_problemId_ticketId_key" ON "ProblemTicket"("problemId", "ticketId");

-- CreateIndex
CREATE INDEX "ProblemTicket_ticketId_idx" ON "ProblemTicket"("ticketId");

-- CreateIndex
CREATE INDEX "ProblemFollowup_problemId_idx" ON "ProblemFollowup"("problemId");

-- CreateIndex
CREATE INDEX "ProblemFollowup_authorId_idx" ON "ProblemFollowup"("authorId");

-- CreateIndex
CREATE INDEX "ProblemEvent_problemId_idx" ON "ProblemEvent"("problemId");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemLink_problemAId_problemBId_type_key" ON "ProblemLink"("problemAId", "problemBId", "type");

-- CreateIndex
CREATE INDEX "ProblemLink_problemBId_idx" ON "ProblemLink"("problemBId");

-- CreateIndex
CREATE INDEX "Problem_status_idx" ON "Problem"("status");

-- CreateIndex
CREATE INDEX "Problem_requesterId_idx" ON "Problem"("requesterId");

-- CreateIndex
CREATE INDEX "Problem_assignedToId_idx" ON "Problem"("assignedToId");

-- CreateIndex
CREATE INDEX "Problem_teamId_idx" ON "Problem"("teamId");

-- CreateIndex
CREATE INDEX "Problem_createdAt_idx" ON "Problem"("createdAt");

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTicket" ADD CONSTRAINT "ProblemTicket_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTicket" ADD CONSTRAINT "ProblemTicket_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemFollowup" ADD CONSTRAINT "ProblemFollowup_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemFollowup" ADD CONSTRAINT "ProblemFollowup_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemEvent" ADD CONSTRAINT "ProblemEvent_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemLink" ADD CONSTRAINT "ProblemLink_problemAId_fkey" FOREIGN KEY ("problemAId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemLink" ADD CONSTRAINT "ProblemLink_problemBId_fkey" FOREIGN KEY ("problemBId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProblemObservers" ADD CONSTRAINT "_ProblemObservers_A_fkey" FOREIGN KEY ("A") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProblemObservers" ADD CONSTRAINT "_ProblemObservers_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
