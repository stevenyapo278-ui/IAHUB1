-- Types d'événements de suivi (visibilité d'un commentaire) utilisés par ticket.routes.js
-- mais absents de l'énumération : logEvent échouait à chaque changement de visibilité.
ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'FOLLOWUP_MADE_PRIVATE';
ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'FOLLOWUP_MADE_PUBLIC';
