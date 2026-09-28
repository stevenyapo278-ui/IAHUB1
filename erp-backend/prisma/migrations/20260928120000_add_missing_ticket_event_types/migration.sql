-- Valeurs d'énumération utilisées par le code (logEvent) mais absentes de la base :
--   - REPLY_ON_CLOSED_* : faisaient échouer les 3 endpoints du Centre de Validation
--     (rouvrir / nouvelle demande / ignorer) avec une erreur Prisma → HTTP 500
--   - FOLLOWUP_* / STATUS_UPDATED / MAJOR_INCIDENT_PROMOTED / EMAIL_LOOP_SKIPPED :
--     logEvent silencieusement avorté (vérifié : aucune ligne en base pour ces types)
ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'REPLY_ON_CLOSED_REOPENED';
ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'REPLY_ON_CLOSED_NEW_TICKET';
ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'REPLY_ON_CLOSED_DISMISSED';
ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'FOLLOWUP_EDITED';
ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'FOLLOWUP_DELETED';
ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'STATUS_UPDATED';
ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'MAJOR_INCIDENT_PROMOTED';
ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'EMAIL_LOOP_SKIPPED';
