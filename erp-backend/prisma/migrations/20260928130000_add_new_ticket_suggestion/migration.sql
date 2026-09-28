-- Suggestion « nouvelle demande » sur un ticket EN COURS :
-- une réponse du demandeur porte sur un autre besoin → la Hotline décide
-- (créer un ticket séparé ou ignorer) depuis le Centre de Validation.
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "newTicketSuggested" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "newTicketSuggestedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "newTicketSuggestedSender" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "newTicketSuggestedSubject" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "newTicketSuggestedSummary" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "newTicketSuggestedBody" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "newTicketSuggestedBodyHtml" TEXT;

ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'NEW_TICKET_SUGGESTED';
ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'NEW_TICKET_SUGGESTED_CREATED';
ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'NEW_TICKET_SUGGESTED_DISMISSED';

CREATE INDEX IF NOT EXISTS "Ticket_newTicketSuggested_idx" ON "Ticket"("newTicketSuggested");
