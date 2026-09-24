const jwt = require('jsonwebtoken');
const prisma = require('../prismaClient');
const { ADMIN_LIKE_ROLES } = require('../config/permissions');

// Tous les rôles possibles — un SUPERADMIN les possède implicitement (prérequis du switch de rôle)
const ALL_ROLES = ['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN', 'REQUESTER'];

// Le JWT n'est qu'une preuve de connexion : à chaque requête, le rôle, l'équipe et l'état du compte
// sont RELUS en base, afin qu'un changement de rôle (vue Utilisateurs) ou une désactivation prenne
// effet immédiatement, sans attendre l'expiration du token (2 h) ni une reconnexion manuelle.
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentification requise' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }

  const userId = Number(payload?.sub);
  if (!userId || Number.isNaN(userId)) {
    return res.status(401).json({ error: 'Token invalide (identifiant incorrect)' });
  }

  prisma.user
    .findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, role: true, roles: true, teamId: true, isActive: true },
    })
    .then((user) => {
      if (!user || !user.isActive) {
        return res.status(401).json({ error: 'Compte inactif ou supprimé' });
      }
      // Rôles possédés : ceux du compte. Un SUPERADMIN possède IMPLICITEMENT tous les rôles —
      // sans ça, le rôle actif demandé via /auth/switch-role (ex. TECHNICIAN) n'est jamais
      // « possédé », le middleware retombe sur le rôle principal et le switch est annulé côté
      // serveur à chaque requête (l'UI affiche un rôle, la DB en applique un autre).
      let ownedRoles = user.roles && user.roles.length ? user.roles : [user.role];
      if (ownedRoles.includes('SUPERADMIN') || user.role === 'SUPERADMIN') {
        ownedRoles = [...ALL_ROLES];
      }
      // Rôle actif = celui du JWT s'il fait partie des rôles possédés (et est valide), sinon rôle principal
      const requestedRole = ALL_ROLES.includes(payload.role) ? payload.role : null;
      const activeRole = requestedRole && ownedRoles.includes(requestedRole) ? requestedRole : user.role;
      req.user = { sub: user.id, email: user.email, fullName: user.fullName, role: activeRole, roles: ownedRoles, teamId: user.teamId };
      next();
    })
    .catch((err) => {
      console.error('[auth middleware] Erreur d\'authentification DB:', err.message);
      res.status(500).json({ error: 'Erreur d’authentification' });
    });
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    next();
  };
}

// Remplace authorize('ADMIN') : couvre ADMIN et SUPERADMIN par construction (liste centralisée
// ADMIN_LIKE_ROLES), pour ne pas avoir à éditer chaque routeur si la hiérarchie des rôles évolue.
function authorizeAdmin(req, res, next) {
  if (!req.user || !ADMIN_LIKE_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  next();
}

module.exports = { authenticate, authorize, authorizeAdmin };
