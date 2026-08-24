-- Index trigrammes (pg_trgm) pour la recherche plein-texte des tickets.
-- La recherche GET /api/tickets?search=... utilise ILIKE (contains insensitive)
-- sur title, content, category et glpiLocationName : sans index, chaque requête
-- scanne toute la table. Ces index GIN rendent ces recherches quasi instantanées,
-- ce qui compte d'autant plus que l'endpoint est pollé toutes les 15 secondes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Ticket_title_trgm_idx" ON "Ticket" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Ticket_content_trgm_idx" ON "Ticket" USING gin ("content" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Ticket_category_trgm_idx" ON "Ticket" USING gin ("category" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Ticket_glpiLocationName_trgm_idx" ON "Ticket" USING gin ("glpiLocationName" gin_trgm_ops);
