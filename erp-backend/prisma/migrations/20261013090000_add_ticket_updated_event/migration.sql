-- Migration: add_ticket_updated_event
-- Ajoute TICKET_UPDATED à l'enum TicketEventType : journal détaillé des
-- modifications de champ(s) sur un ticket (PATCH /tickets/:id).

ALTER TYPE "TicketEventType" ADD VALUE 'TICKET_UPDATED';
