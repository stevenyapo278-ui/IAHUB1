-- CSAT : satisfaction du demandeur (1-5) après résolution
ALTER TABLE "Ticket" ADD COLUMN "csatScore" INTEGER;
ALTER TABLE "Ticket" ADD COLUMN "csatComment" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "csatRatedAt" TIMESTAMP(3);