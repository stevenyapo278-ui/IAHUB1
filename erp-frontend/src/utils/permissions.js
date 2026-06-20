// Réplique côté frontend la même règle que requirePermission() (backend) : ADMIN passe toujours ;
// si l'utilisateur appartient à au moins un groupe de droits (permissions !== null), seules les
// permissions de ses groupes comptent ; sinon (aucun groupe assigné) on retombe sur fallbackRoles,
// équivalent à l'ancien contrôle par rôle simple — pour ne jamais cacher un lien à un utilisateur
// existant qui n'a encore aucun groupe assigné.
export function hasPermission(user, key, fallbackRoles = []) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;

  if (Array.isArray(user.permissions)) {
    return user.permissions.includes(key);
  }

  return fallbackRoles.includes(user.role);
}
