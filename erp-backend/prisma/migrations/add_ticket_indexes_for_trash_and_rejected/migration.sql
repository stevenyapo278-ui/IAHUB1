-- Enable the pg_trgm extension for GIN/trgm indexes on title/content.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  END IF;
END $$;

-- Index for GET /tickets/trash/list: filter on deletedAt.
-- Without it, PostgreSQL performs a seq scan on Ticket when the table grows
-- beyond the planner threshold (the exact situation that limits retrieval
-- in the trash view).
CREATE INDEX IF NOT EXISTS "Ticket_deletedAt_idx" ON "Ticket"("deletedAt");

-- Index for GET /tickets/rejected-suggestions: filter on approvalStatus.
CREATE INDEX IF NOT EXISTS "Ticket_approvalStatus_idx" ON "Ticket"("approvalStatus");

-- Combined index covering the compound filter used for the rejected list
-- (deletedAt + approvalStatus + status) and the trash-with-rejected filter.
CREATE INDEX IF NOT EXISTS "Ticket_deletedAt_approvalStatus_idx" ON "Ticket"("deletedAt", "approvalStatus", "status");

-- GIN trigram indexes for the free-text search on title and content.
-- These support the ?search= query parameter in both trashes views.
CREATE INDEX IF NOT EXISTS "Ticket_title_trgm_idx" ON "Ticket" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Ticket_content_trgm_idx" ON "Ticket" USING gin ("content" gin_trgm_ops);
