-- AlterTable: Add requesterIds array column to Ticket
ALTER TABLE "Ticket" ADD COLUMN "requesterIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

-- Backfill: populate requesterIds from existing requesterId + secondaryRequesterId
UPDATE "Ticket"
SET "requesterIds" = (
  CASE
    WHEN "requesterId" IS NOT NULL AND "secondaryRequesterId" IS NOT NULL
      THEN ARRAY["requesterId", "secondaryRequesterId"]
    WHEN "requesterId" IS NOT NULL
      THEN ARRAY["requesterId"]
    ELSE ARRAY[]::INTEGER[]
  END
)
WHERE "requesterId" IS NOT NULL OR "secondaryRequesterId" IS NOT NULL;
