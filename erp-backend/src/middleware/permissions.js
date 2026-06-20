const prisma = require('../prismaClient');

async function getUserPermissions(userId) {
  const groups = await prisma.permissionGroup.findMany({
    where: { members: { some: { id: userId } } },
    select: { permissions: true },
  });
  return new Set(groups.flatMap((g) => g.permissions));
}

// requirePermission(key, fallbackRoles) : ADMIN passe toujours. Sinon, si l'utilisateur appartient
// à au moins un groupe de droits, SEULES les permissions de ses groupes comptent (le rôle ne sert
// plus de filet — retirer une permission à son groupe la retire vraiment). Si l'utilisateur n'est
// membre d'AUCUN groupe, on retombe sur fallbackRoles (équivalent à l'ancien authorize() par rôle)
// pour ne jamais casser l'accès des comptes existants tant qu'aucun groupe ne leur est assigné.
function requirePermission(key, fallbackRoles = []) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentification requise' });
    if (req.user.role === 'ADMIN') return next();

    const groups = await prisma.permissionGroup.findMany({
      where: { members: { some: { id: req.user.sub } } },
      select: { permissions: true },
    });

    if (groups.length > 0) {
      const perms = new Set(groups.flatMap((g) => g.permissions));
      if (perms.has(key)) return next();
      return res.status(403).json({ error: 'Accès refusé' });
    }

    if (fallbackRoles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Accès refusé' });
  };
}

module.exports = { requirePermission, getUserPermissions };
