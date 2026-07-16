-- Création de la table GlpiLocation pour stocker les "Lieux" synchronisés depuis GLPI
CREATE TABLE "GlpiLocation" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "completename" TEXT,
    "glpiLocationId" INTEGER NOT NULL,
    "address" TEXT,
    "postcode" TEXT,
    "town" TEXT,
    "country" TEXT,
    "building" TEXT,
    "room" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlpiLocation_pkey" PRIMARY KEY ("id")
);

-- Index unique sur glpiLocationId pour les upserts
CREATE UNIQUE INDEX "GlpiLocation_glpiLocationId_key" ON "GlpiLocation"("glpiLocationId");

-- Ajout des champs "Lieu" sur la table Ticket
ALTER TABLE "Ticket" ADD COLUMN "glpiLocationId" INTEGER;
ALTER TABLE "Ticket" ADD COLUMN "glpiLocationName" TEXT;
