-- Nouvel événement : détection de résolution sans suggestion (confiance < 0.7 ou plafond atteint)
ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'CLOSURE_NOT_SUGGESTED';