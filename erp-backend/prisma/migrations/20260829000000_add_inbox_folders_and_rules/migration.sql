-- CreateTable
CREATE TABLE "InboxFolder" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxRule" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "conditions" JSONB NOT NULL,
    "conditionOperator" TEXT NOT NULL DEFAULT 'AND',
    "action" TEXT NOT NULL,
    "actionConfig" JSONB NOT NULL,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxRule_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "IncomingEmail" ADD COLUMN "folderId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "InboxFolder_name_createdById_key" ON "InboxFolder"("name", "createdById");

-- CreateIndex
CREATE INDEX "InboxRule_createdById_idx" ON "InboxRule"("createdById");

-- CreateIndex
CREATE INDEX "IncomingEmail_folderId_idx" ON "IncomingEmail"("folderId");

-- AddForeignKey
ALTER TABLE "IncomingEmail" ADD CONSTRAINT "IncomingEmail_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "InboxFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxFolder" ADD CONSTRAINT "InboxFolder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxRule" ADD CONSTRAINT "InboxRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
