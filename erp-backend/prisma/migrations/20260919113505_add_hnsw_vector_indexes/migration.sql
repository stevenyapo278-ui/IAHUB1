-- CreateIndex HNSW pour les recherches vectorielles
-- HNSW est disponible depuis pgvector 0.7.0
-- Cette migration vérifie la version avant de créer les index

-- Fonction pour vérifier si HNSW est supporté
CREATE OR REPLACE FUNCTION check_pgvector_version() RETURNS boolean AS $$
DECLARE
  version_text text;
  major int;
  minor int;
BEGIN
  -- Obtenir la version de pgvector
  SELECT extversion INTO version_text FROM pg_extension WHERE extname = 'vector';
  
  -- Si pas d'extension, retourner false
  IF version_text IS NULL THEN
    RETURN false;
  END IF;
  
  -- Extraire major.minor (format "0.7.0" ou "1.0.0")
  major := split_part(version_text, '.', 1)::int;
  minor := split_part(version_text, '.', 2)::int;
  
  -- HNSW disponible depuis 0.7.0
  RETURN (major > 0) OR (major = 0 AND minor >= 7);
END;
$$ LANGUAGE plpgsql;

-- Créer les index HNSW si la version le supporte
DO $$
BEGIN
  IF check_pgvector_version() THEN
    -- Index pour KnowledgeChunk (recherche knowledge base)
    CREATE INDEX IF NOT EXISTS idx_knowledgechunk_embedding_hnsw 
    ON "KnowledgeChunk" USING hnsw (embedding vector_cosine_ops) 
    WITH (m = 16, ef_construction = 64);
    
    -- Index pour Ticket (similarité entre tickets)
    CREATE INDEX IF NOT EXISTS idx_ticket_content_embedding_hnsw 
    ON "Ticket" USING hnsw ("contentEmbedding" vector_cosine_ops) 
    WITH (m = 16, ef_construction = 64);
    
    -- Index pour TicketSimilarityIndex (détection doublons)
    CREATE INDEX IF NOT EXISTS idx_ticketsimilarityindex_embedding_hnsw 
    ON "TicketSimilarityIndex" USING hnsw (embedding vector_cosine_ops) 
    WITH (m = 16, ef_construction = 64);
    
    RAISE NOTICE 'Index HNSW créés avec succès (pgvector compatible)';
  ELSE
    RAISE NOTICE 'Index HNSW ignorés : pgvector < 0.7.0 ou extension non installée';
  END IF;
END $$;

-- Nettoyer la fonction de vérification
DROP FUNCTION IF EXISTS check_pgvector_version();
