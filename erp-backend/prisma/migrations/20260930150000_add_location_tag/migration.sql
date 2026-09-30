-- Tag libre sur les lieux : regroupement et filtrage dans la grille et l'export
-- (indépendant du référentiel GLPI, posé manuellement via l'UI).
-- IF NOT EXISTS : la colonne peut déjà exister sur une base où elle a été posée manuellement
-- pendant le développement — la migration doit rester applicable dans les deux cas.
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "tag" TEXT;
