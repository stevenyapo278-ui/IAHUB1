-- Sous-tickets (parent/enfant) : réglage clôture en cascade.
-- NB : TicketLink.type est un String (pas un enum) — les types PARENT/CHILD
-- n'ont pas besoin de migration de type, ils sont acceptés par le code.
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "closeChildrenWithParent" BOOLEAN NOT NULL DEFAULT false;
