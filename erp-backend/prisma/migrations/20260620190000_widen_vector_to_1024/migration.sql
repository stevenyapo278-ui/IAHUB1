-- Passe les colonnes pgvector de 768 à 1024 dimensions, pour permettre l'utilisation de modèles
-- d'embedding NVIDIA NIM (nv-embedqa-e5-v5, bge-m3, etc.) qui produisent nativement 1024 dimensions,
-- en l'absence d'un fournisseur 768 dimensions (Gemini text-embedding-004) configuré.
-- USING NULL : aucune valeur existante ne peut être convertie d'une dimension à l'autre — les deux
-- colonnes étaient vides au moment de cette migration (vérifié), donc aucune perte de données réelle.
ALTER TABLE "Ticket" ALTER COLUMN "contentEmbedding" TYPE vector(1024) USING NULL;
ALTER TABLE "KnowledgeChunk" ALTER COLUMN "embedding" TYPE vector(1024) USING NULL;
