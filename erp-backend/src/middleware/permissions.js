const prisma = require('../prismaClient');

async function getUserPermissions(userId) {
  const groups = await prisma.permissionGroup.findMany({
    where: { members: { some: { id: userId } } },
    select: { permissions: true },
  });
  return new Set(groups.flatMap((g) => g.permissions));
}

function requirePermission(key) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentification requise' });
    if (req.user.role === 'ADMIN') return next();

    const perms = await getUserPermissions(req.user.sub);
    if (perms.has(key)) return next();

    return res.status(403).json({ error: 'Accès refusé' });
  };
}

module.exports = { requirePermission, getUserPermissions };
