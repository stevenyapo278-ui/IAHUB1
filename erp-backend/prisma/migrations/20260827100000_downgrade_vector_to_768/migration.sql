-- Passe les colonnes pgvector de 1024 à 768 dimensions pour matcher
-- Gemini text-embedding-004 qui produit nativement 768 dimensions.
-- USING NULL : les embeddings existants (1024 dim) sont incompatibles avec 768 dim —
-- ils seront régénérés automatiquement lors des prochains indexages.
ALTER TABLE "Ticket" ALTER COLUMN "contentEmbedding" TYPE vector(768) USING NULL;
ALTER TABLE "KnowledgeChunk" ALTER COLUMN "embedding" TYPE vector(768) USING NULL;
ALTER TABLE "TicketSimilarityIndex" ALTER COLUMN "embedding" TYPE vector(768) USING NULL;
