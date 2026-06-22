const prisma = require('../prismaClient');

async function getUserPermissions(userId) {
  const groups = await prisma.permissionGroup.findMany({
    where: { members: { some: { id: userId } } },
    select: { permissions: true },
  });
  return new Set(groups.flatMap((g) => g.permissions));
}

// requirePermission(key) : SUPERADMIN passe toujours (au-dessus de tout groupe). Pour tous les
// autres rôles (ADMIN inclus), seules les permissions des groupes de droits de l'utilisateur
// comptent — le rôle ne sert plus jamais de filet de secours. Un utilisateur sans aucun groupe
// assigné n'a donc aucune permission (hors SUPERADMIN) : un compte nouvellement créé doit être
// rattaché à un groupe pour accéder à quoi que ce soit au-delà des pages toujours visibles
// (Dashboard/Tickets/Boîte mail, voir navItems de MainLayout.jsx côté frontend).
// Le second paramètre (ancien fallbackRoles) est accepté mais ignoré, pour ne pas avoir à modifier
// chaque site d'appel existant.
function requirePermission(key) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentification requise' });
    if (req.user.role === 'SUPERADMIN') return next();

    const groups = await prisma.permissionGroup.findMany({
      where: { members: { some: { id: req.user.sub } } },
      select: { permissions: true },
    });

    const perms = new Set(groups.flatMap((g) => g.permissions));
    if (perms.has(key)) return next();
    return res.status(403).json({ error: 'Accès refusé' });
  };
}

// Réservé à SUPERADMIN strictement — pas de bypass via groupe de permissions, c'est un rôle, pas
// une permission déléguable (cf. page "Avancé" : config serveur, fréquences de sync, auto-envoi IA).
function requireSuperAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentification requise' });
  if (req.user.role !== 'SUPERADMIN') return res.status(403).json({ error: 'Accès réservé au super-administrateur' });
  next();
}

module.exports = { requirePermission, getUserPermissions, requireSuperAdmin };
