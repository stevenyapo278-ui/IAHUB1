-- Règle métier "un utilisateur n'appartient qu'à un seul groupe de permissions".
-- Sur la table implicite _UserPermissionGroups (A = PermissionGroup.id, B = User.id),
-- un index UNIQUE sur B garantit qu'un utilisateur ne peut figurer que dans une seule ligne
-- (donc un seul groupe), directement en base.

CREATE UNIQUE INDEX "_UserPermissionGroups_B_key" ON "_UserPermissionGroups" ("B");