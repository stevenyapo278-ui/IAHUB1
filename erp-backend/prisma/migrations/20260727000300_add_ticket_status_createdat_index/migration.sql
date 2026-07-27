-- Migration: add_ticket_status_createdat_index
-- Index composite pour accélérer la requête la plus courante :
-- filtrage par statut + tri par date de création décroissante

CREATE INDEX IF NOT EXISTS "Ticket_status_createdAt_idx" ON "Ticket"("status", "createdAt" DESC);
