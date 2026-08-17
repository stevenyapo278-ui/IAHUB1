-- Followup.isPrivate : commentaires internes visibles uniquement par l'équipe
ALTER TABLE "Followup" ADD COLUMN "isPrivate" BOOLEAN NOT NULL DEFAULT false;