-- Nouveaux événements du journal pour la corbeille (soft delete / rollback)
ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'DELETED';
ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'RESTORED';
