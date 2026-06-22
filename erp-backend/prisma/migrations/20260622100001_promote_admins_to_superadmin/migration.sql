-- Promeut les comptes ADMIN existants en SUPERADMIN : sans cette promotion, après ce déploiement
-- aucun compte n'aurait accès à la page "Avancé" (config serveur, fréquences de sync) ni le droit
-- de créer un futur compte ADMIN, ce qui bloquerait totalement la configuration sans intervention
-- SQL manuelle. Un SUPERADMIN peut ensuite redescendre un compte en ADMIN depuis l'UI s'il le souhaite.
-- Dans une migration séparée de l'ajout de la valeur d'enum : PostgreSQL interdit d'utiliser une
-- valeur d'enum tout juste ajoutée (ALTER TYPE ... ADD VALUE) dans la même transaction.
UPDATE "User" SET role = 'SUPERADMIN' WHERE role = 'ADMIN';
