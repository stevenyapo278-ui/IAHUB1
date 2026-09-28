-- Fiabilité des brouillons de réponse IA (Centre de Validation) :
-- 1. Tracer CE sur quoi l'IA s'appuie : confiance retournée par le modèle + extraits de la
--    base de connaissances réellement utilisés (ids) + aperçu du premier extrait, pour que le
--    valideur voie la source d'une affirmation au lieu de la deviner.
-- 2. Statut SUPERSEDED : quand un nouveau mail arrive sur un ticket, les brouillons PENDING
--    antérieurs sont neutralisés pour qu'il n'y ait JAMAIS deux propositions concurrentes
--    (l'ancienne ne contient pas le dernier échange et reste pourtant validable).
ALTER TYPE "ApprovalStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';

ALTER TABLE "AiEmailDraft" ADD COLUMN IF NOT EXISTS "aiConfidence" DOUBLE PRECISION;
ALTER TABLE "AiEmailDraft" ADD COLUMN IF NOT EXISTS "knowledgeChunkIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "AiEmailDraft" ADD COLUMN IF NOT EXISTS "knowledgeSnippet" TEXT;
-- Derniers échanges vus par l'IA au moment de la génération (4 x max, corps tronqué à 400 car.) :
-- permet d'afficher le contexte sur la carte du centre de validation sans recharger le fil entier.
ALTER TABLE "AiEmailDraft" ADD COLUMN IF NOT EXISTS "contextMessages" JSONB;
