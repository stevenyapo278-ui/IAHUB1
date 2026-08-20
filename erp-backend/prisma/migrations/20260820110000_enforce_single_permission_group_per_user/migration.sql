-- Règle métier "un utilisateur n'appartient qu'à un seul groupe de permissions".
-- Avant de poser l'index unique, on nettoie les affectations historiques en doublon :
-- pour un utilisateur présent dans plusieurs groupes, on CONSERVE l'affectation au groupe
-- le plus récent (PermissionGroup.id maximal) et on supprime les autres.

DELETE FROM "_UserPermissionGroups" a
USING "_UserPermissionGroups" b
WHERE a."B" = b."B" AND a."A" < b."A";

-- Puis l'index UNIQUE sur B (= User.id) garantit à l'avenir qu'un utilisateur ne peut figurer
-- que dans une seule ligne, donc un seul groupe, directement en base.
CREATE UNIQUE INDEX IF NOT EXISTS "_UserPermissionGroups_B_key" ON "_UserPermissionGroups" ("B");