-- Migration: add_approved_rejected_ticket_events
-- Ajoute APPROVED et REJECTED à l'enum TicketEventType

ALTER TYPE "TicketEventType" ADD VALUE 'APPROVED';
ALTER TYPE "TicketEventType" ADD VALUE 'REJECTED';
