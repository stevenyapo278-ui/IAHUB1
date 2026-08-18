-- Inventaire d'assets : table Asset + liaison AssetTicket
CREATE TABLE IF NOT EXISTS "Asset" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "assetType" TEXT NOT NULL DEFAULT 'COMPUTER',
    "serialNumber" TEXT,
    "inventoryNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_USE',
    "manufacturer" TEXT,
    "model" TEXT,
    "glpiLocationId" INTEGER,
    "ownerId" INTEGER,
    "teamId" INTEGER,
    "purchaseDate" TIMESTAMP(3),
    "warrantyEnd" TIMESTAMP(3),
    "notes" TEXT,
    "glpiAssetId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Asset_glpiAssetId_key" ON "Asset"("glpiAssetId");
CREATE INDEX IF NOT EXISTS "Asset_assetType_idx" ON "Asset"("assetType");
CREATE INDEX IF NOT EXISTS "Asset_status_idx" ON "Asset"("status");
CREATE INDEX IF NOT EXISTS "Asset_glpiLocationId_idx" ON "Asset"("glpiLocationId");
CREATE INDEX IF NOT EXISTS "Asset_ownerId_idx" ON "Asset"("ownerId");

ALTER TABLE "Asset" ADD CONSTRAINT "Asset_glpiLocationId_fkey" FOREIGN KEY ("glpiLocationId") REFERENCES "GlpiLocation"("glpiLocationId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "AssetTicket" (
    "assetId" INTEGER NOT NULL,
    "ticketId" INTEGER NOT NULL,
    CONSTRAINT "AssetTicket_pkey" PRIMARY KEY ("assetId", "ticketId")
);

CREATE INDEX IF NOT EXISTS "AssetTicket_ticketId_idx" ON "AssetTicket"("ticketId");

ALTER TABLE "AssetTicket" ADD CONSTRAINT "AssetTicket_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetTicket" ADD CONSTRAINT "AssetTicket_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;