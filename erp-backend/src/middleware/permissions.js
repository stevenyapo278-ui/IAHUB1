const prisma = require('../prismaClient');
const { ROLE_DEFAULT_GROUP_NAME } = require('../config/permissions');

async function getUserPermissions(userId) {
  const groups = await prisma.permissionGroup.findMany({
    where: { members: { some: { id: userId } } },
    select: { permissions: true },
  });
  return new Set(groups.flatMap((g) => g.permissions));
}

// Vérification de permission HORS middleware (services : chatbot, rapports…).
// Mêmes règles que requirePermission : SUPERADMIN passe toujours ; sinon seules
// les permissions des groupes de droits comptent ; un SUPERADMIN ayant endossé
// un autre rôle garde les permissions du groupe par défaut de ce rôle.
async function hasPermission(user, key) {
  if (!user || !key) return false;
  if (user.role === 'SUPERADMIN') return true;

  const groups = await prisma.permissionGroup.findMany({
    where: { members: { some: { id: user.sub } } },
    select: { permissions: true },
  });
  const perms = new Set(groups.flatMap((g) => g.permissions));
  if (perms.has(key)) return true;

  if (Array.isArray(user.roles) && user.roles.includes('SUPERADMIN')) {
    const groupName = ROLE_DEFAULT_GROUP_NAME[user.role];
    if (groupName) {
      const group = await prisma.permissionGroup.findUnique({ where: { name: groupName }, select: { permissions: true } });
      if (group && group.permissions.includes(key)) return true;
    }
  }
  return false;
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
    if (await hasPermission(req.user, key)) return next();
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

module.exports = { requirePermission, getUserPermissions, requireSuperAdmin, hasPermission };
