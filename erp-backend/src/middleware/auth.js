const jwt = require('jsonwebtoken');
const { ADMIN_LIKE_ROLES } = require('../config/permissions');

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentification requise' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
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
