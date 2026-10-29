-- Extraction de texte / OCR des pièces jointes (PDF, DOCX, XLSX, CSV, texte, images)
ALTER TABLE "TicketAttachment" ADD COLUMN IF NOT EXISTS "extractedText" TEXT;
ALTER TABLE "TicketAttachment" ADD COLUMN IF NOT EXISTS "extractionStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "TicketAttachment" ADD COLUMN IF NOT EXISTS "extractionError" TEXT;
ALTER TABLE "TicketAttachment" ADD COLUMN IF NOT EXISTS "extractedAt" TIMESTAMP(3);

-- Le backfill sélectionne les pièces jointes restant à traiter
CREATE INDEX IF NOT EXISTS "TicketAttachment_extractionStatus_idx" ON "TicketAttachment"("extractionStatus");
