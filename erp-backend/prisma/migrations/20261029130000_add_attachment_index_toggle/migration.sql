-- Interrupteur global : extraction + indexation RAG du contenu des pièces jointes.
-- Activé par défaut (comportement actuel : backfill automatique).
ALTER TABLE "SystemSettings"
  ADD COLUMN IF NOT EXISTS "attachmentIndexEnabled" BOOLEAN NOT NULL DEFAULT true;
