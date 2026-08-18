-- Échéance manuelle des tickets (dueDate) + surveillance automatique
ALTER TYPE "TicketEventType" ADD VALUE 'DUE_DATE_BREACHED';
ALTER TYPE "TicketEventType" ADD VALUE 'DUE_DATE_UPDATED';
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "dueDateNotifiedAt" TIMESTAMP(3);
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "dueDateMonitorIntervalSeconds" INTEGER NOT NULL DEFAULT 300;
