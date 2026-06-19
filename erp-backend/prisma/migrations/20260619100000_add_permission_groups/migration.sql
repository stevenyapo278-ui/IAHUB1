-- CreateTable
CREATE TABLE IF NOT EXISTS "PermissionGroup" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "PermissionGroup_name_key" ON "PermissionGroup"("name");

-- CreateTable (implicit M2M join, alphabetical column order: PermissionGroup < User)
CREATE TABLE IF NOT EXISTS "_UserPermissionGroups" (
  "A" INTEGER NOT NULL REFERENCES "PermissionGroup"(id) ON DELETE CASCADE,
  "B" INTEGER NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  CONSTRAINT "_UserPermissionGroups_AB_pkey" PRIMARY KEY ("A", "B")
);
CREATE INDEX IF NOT EXISTS "_UserPermissionGroups_B_index" ON "_UserPermissionGroups"("B");
