-- CreateTable
CREATE TABLE IF NOT EXISTS "TicketCategory" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "glpiCategoryId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "TicketCategory_name_key" ON "TicketCategory"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "TicketCategory_glpiCategoryId_key" ON "TicketCategory"("glpiCategoryId");
