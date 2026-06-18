-- AlterTable
ALTER TABLE "EmailAccount" ADD COLUMN     "deltaLink" TEXT,
ADD COLUMN     "lastSyncAt" TIMESTAMP(3);
