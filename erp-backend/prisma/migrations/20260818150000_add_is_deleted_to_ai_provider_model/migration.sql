-- AlterTable
ALTER TABLE "AiProvider" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AiModel" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
