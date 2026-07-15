-- AlterTable: désactiver les alertes brouillons par défaut pour les comptes existants
-- Les nouveaux comptes auront false par défaut via le schema Prisma
UPDATE "User" SET "receiveDraftAlerts" = false WHERE "receiveDraftAlerts" = true;
