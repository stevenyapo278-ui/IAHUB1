-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "glpiGroupId" INTEGER;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "glpiTicketId" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "glpiId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Team_glpiGroupId_key" ON "Team"("glpiGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_glpiTicketId_key" ON "Ticket"("glpiTicketId");

-- CreateIndex
CREATE UNIQUE INDEX "User_glpiId_key" ON "User"("glpiId");

