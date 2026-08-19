-- La migration originale (20260612093945) créait glpiDocumentId avec NOT NULL,
-- mais le schéma Prisma le déclare nullable (Int?). Cette migration aligne la DB.
ALTER TABLE "TicketAttachment" ALTER COLUMN "glpiDocumentId" DROP NOT NULL;
