const jwt = require('jsonwebtoken');
const prisma = require('../prismaClient');
const { ADMIN_LIKE_ROLES } = require('../config/permissions');

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

  prisma.user
    .findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, teamId: true, isActive: true },
    })
    .then((user) => {
      if (!user || !user.isActive) {
        return res.status(401).json({ error: 'Compte inactif ou supprimé' });
      }
      req.user = { sub: user.id, email: user.email, role: user.role, teamId: user.teamId };
      next();
    })
    .catch(() => res.status(500).json({ error: 'Erreur d’authentification' }));
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
