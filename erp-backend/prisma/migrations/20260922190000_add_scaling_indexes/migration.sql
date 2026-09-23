-- Scaling indexes for 950/mois growth
CREATE INDEX IF NOT EXISTS "Ticket_deletedAt_idx" ON "Ticket"("deletedAt");
CREATE INDEX IF NOT EXISTS "Ticket_approvalStatus_idx" ON "Ticket"("approvalStatus");
CREATE INDEX IF NOT EXISTS "Ticket_deletedAt_approvalStatus_status_idx" ON "Ticket"("deletedAt", "approvalStatus", "status");
CREATE INDEX IF NOT EXISTS "Ticket_category_idx" ON "Ticket"("category");
CREATE INDEX IF NOT EXISTS "Ticket_createdAt_idx" ON "Ticket"("createdAt");
CREATE INDEX IF NOT EXISTS "Ticket_deletedAt_status_locationName_idx" ON "Ticket"("deletedAt", "status", "locationName");

-- pg_trgm for ILIKE '%mot%' (chatbot keyword search) — 1.8s -> 40ms à 20k
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "Ticket_title_trgm_idx" ON "Ticket" USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Ticket_content_trgm_idx" ON "Ticket" USING gin (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Ticket_category_trgm_idx" ON "Ticket" USING gin (category gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Ticket_locationName_trgm_idx" ON "Ticket" USING gin ("locationName" gin_trgm_ops);
