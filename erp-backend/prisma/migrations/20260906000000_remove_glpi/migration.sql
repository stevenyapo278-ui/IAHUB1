-- Suppression complète de l'intégration GLPI.
-- ⚠️ La table "Location" est l'ancienne "GlpiLocation" (données conservées).
-- Les valeurs de lieu sont préservées, seules les références GLPI sont perdues.

-- ── 1. Renommage GlpiLocation → Location (données conservées) ────────────────
ALTER TABLE "GlpiLocation" RENAME TO "Location";
ALTER INDEX IF EXISTS "GlpiLocation_pkey" RENAME TO "Location_pkey";
ALTER INDEX IF EXISTS "GlpiLocation_glpiLocationId_key" RENAME TO "Location_glpiLocationId_key";

-- ── 2. Colonnes renommées (glpi* → noms neutres) ────────────────────────────
ALTER TABLE "Asset" RENAME COLUMN "glpiLocationId" TO "locationId";
ALTER TABLE "Ticket" RENAME COLUMN "glpiLocationId" TO "locationId";
ALTER TABLE "Ticket" RENAME COLUMN "glpiLocationName" TO "locationName";
ALTER TABLE "Problem" RENAME COLUMN "glpiLocationId" TO "locationId";
ALTER TABLE "Problem" RENAME COLUMN "glpiLocationName" TO "locationName";
ALTER TABLE "RequesterLocation" RENAME COLUMN "glpiLocationId" TO "locationId";

-- ── 3. Nettoyage du FK/contrainte sur RequesterLocation (le renommage de colonne
--       garde l'ancien nom de contrainte) ─────────────────────────────────────
ALTER TABLE "RequesterLocation" DROP CONSTRAINT IF EXISTS "RequesterLocation_glpiLocationId_fkey";
ALTER TABLE "RequesterLocation" ADD CONSTRAINT "RequesterLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER INDEX IF EXISTS "RequesterLocation_email_glpiLocationId_key" RENAME TO "RequesterLocation_email_locationId_key";

-- Les FK des autres tables (Asset/Ticket) gardent leur nom d'origine — renommons-les proprement :
ALTER TABLE "Asset" DROP CONSTRAINT IF EXISTS "Asset_glpiLocationId_fkey";
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 4. Drop des colonnes GLPI et de leurs index/contraintes uniques ─────────
ALTER TABLE "User" DROP COLUMN IF EXISTS "glpiId";
ALTER TABLE "Team" DROP COLUMN IF EXISTS "glpiGroupId";
ALTER TABLE "TicketCategory" DROP COLUMN IF EXISTS "glpiCategoryId";
ALTER TABLE "Ticket" DROP COLUMN IF EXISTS "glpiTicketId";
ALTER TABLE "Ticket" DROP COLUMN IF EXISTS "lastGlpiSyncAt";
ALTER TABLE "TicketAttachment" DROP COLUMN IF EXISTS "glpiDocumentId";
ALTER TABLE "Followup" DROP COLUMN IF EXISTS "glpiFollowupId";
ALTER TABLE "IncomingEmail" DROP COLUMN IF EXISTS "glpiTicketId";
ALTER TABLE "AiEmailDraft" DROP COLUMN IF EXISTS "glpiTicketId";
ALTER TABLE "Asset" DROP COLUMN IF EXISTS "glpiAssetId";
ALTER TABLE "SupportTeam" DROP COLUMN IF EXISTS "glpiGroupName";
ALTER TABLE "TriageRule" DROP COLUMN IF EXISTS "autoApproveGlpi";

-- ── 5. Drop des index GLPI restants ─────────────────────────────────────────
DROP INDEX IF EXISTS "Ticket_glpiTicketId_key";
DROP INDEX IF EXISTS "Ticket_glpiLocationName_trgm_idx";
DROP INDEX IF EXISTS "User_glpiId_key";
DROP INDEX IF EXISTS "Team_glpiGroupId_key";
DROP INDEX IF EXISTS "TicketCategory_glpiCategoryId_key";
DROP INDEX IF EXISTS "TicketAttachment_glpiDocumentId_key";
DROP INDEX IF EXISTS "Followup_glpiFollowupId_key";
DROP INDEX IF EXISTS "Asset_glpiAssetId_key";
DROP INDEX IF EXISTS "Ticket_glpiLocationId_idx";
DROP INDEX IF EXISTS "Location_glpiLocationId_key";

-- La colonne de lieu étant renommée, l'index trigramme associé est recréé sous le bon nom
-- (le drop/recreate évite de dépendre du nom exact généré par la migration d'origine)
DROP INDEX IF EXISTS "Ticket_glpiLocationName_trgm_idx";
CREATE INDEX IF NOT EXISTS "Ticket_locationName_trgm_idx" ON "Ticket" USING gin ("locationName" gin_trgm_ops);

-- ── 6. Suppression des réglages GLPI de SystemSettings ─────────────────────
ALTER TABLE "SystemSettings" DROP COLUMN IF EXISTS "activeGlpiInstance";
ALTER TABLE "SystemSettings" DROP COLUMN IF EXISTS "autoApproveGlpiSolutions";
ALTER TABLE "SystemSettings" DROP COLUMN IF EXISTS "autonomousMode";
ALTER TABLE "SystemSettings" DROP COLUMN IF EXISTS "dryRunMode";
ALTER TABLE "SystemSettings" DROP COLUMN IF EXISTS "enableGlpiFollowupCreation";
ALTER TABLE "SystemSettings" DROP COLUMN IF EXISTS "enableGlpiTicketClosure";
ALTER TABLE "SystemSettings" DROP COLUMN IF EXISTS "enableGlpiTicketCreation";
ALTER TABLE "SystemSettings" DROP COLUMN IF EXISTS "glpiSourceMarker";
ALTER TABLE "SystemSettings" DROP COLUMN IF EXISTS "glpiTicketsSyncIntervalSeconds";
ALTER TABLE "SystemSettings" DROP COLUMN IF EXISTS "glpiTeamsCategoriesSyncIntervalMinutes";
ALTER TABLE "SystemSettings" DROP COLUMN IF EXISTS "glpiLocationsSyncIntervalMinutes";

-- ── 7. GlpiSyncRetry → SyncRetry ────────────────────────────────────────────
ALTER TABLE "GlpiSyncRetry" RENAME TO "SyncRetry";
ALTER INDEX IF EXISTS "GlpiSyncRetry_pkey" RENAME TO "SyncRetry_pkey";
ALTER INDEX IF EXISTS "GlpiSyncRetry_nextRetryAt_attempts_idx" RENAME TO "SyncRetry_nextRetryAt_attempts_idx";

-- ── 8. Recréation des index standards attendus par Prisma ───────────────────
CREATE INDEX IF NOT EXISTS "Asset_locationId_idx" ON "Asset"("locationId");
