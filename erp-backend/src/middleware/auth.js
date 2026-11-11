const prisma = require('../prismaClient');
const { ADMIN_LIKE_ROLES } = require('../config/permissions');
const { verifyAccessToken } = require('../utils/authToken');
const { getIdleTimeoutMs } = require('../utils/authSession');

// Tous les rôles possibles — un SUPERADMIN les possède implicitement (prérequis du switch de rôle)
const ALL_ROLES = ['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN', 'REQUESTER'];

// Le JWT n'est qu'une preuve de connexion : à chaque requête, le rôle, l'équipe et l'état du compte
// sont RELUS en base, afin qu'un changement de rôle (vue Utilisateurs) ou une désactivation prenne
// effet immédiatement, sans attendre l'expiration du token ni une reconnexion manuelle.
// La durée de vie du jeton d'accès est courte (15 min par défaut) ; il est renouvelé via le
// refresh token HttpOnly (/auth/refresh ou /auth/me), sans jamais dépasser le plafond absolu
// (AUTH_SESSION_MAX_HOURS, 12 h). La session est vérifiée en base à chaque requête :
// révocation, expiration, inactivité et `tokenVersion` (changement de mot de passe).
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentification requise' });
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    const message = err.code === 'SESSION_EXPIRED'
      ? 'Session expirée, veuillez vous reconnecter'
      : 'Token invalide ou expiré';
    return res.status(401).json({ error: message });
  }

  const userId = Number(payload?.sub);
  if (!userId || Number.isNaN(userId)) {
    return res.status(401).json({ error: 'Token invalide (identifiant incorrect)' });
  }

  const now = new Date();
  prisma.authSession
    .findUnique({
      where: { id: String(payload.sid) },
      select: {
        id: true,
        userId: true,
        revokedAt: true,
        sessionStart: true,
        lastActivityAt: true,
        expiresAt: true,
        user: {
          select: { id: true, email: true, fullName: true, role: true, roles: true, teamId: true, isActive: true, tokenVersion: true },
        },
      },
    })
    .then((session) => {
      if (!session || session.userId !== userId) {
        return res.status(401).json({ error: 'Session invalide, veuillez vous reconnecter' });
      }
      if (session.revokedAt) {
        return res.status(401).json({ error: 'Session révoquée, veuillez vous reconnecter' });
      }
      if (session.expiresAt <= now) {
        prisma.authSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: now } }).catch(() => {});
        return res.status(401).json({ error: 'Session expirée, veuillez vous reconnecter' });
      }
      if (now.getTime() - session.lastActivityAt.getTime() > getIdleTimeoutMs()) {
        prisma.authSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: now } }).catch(() => {});
        return res.status(401).json({ error: 'Session inactive, veuillez vous reconnecter' });
      }

      const user = session.user;
      if (!user || !user.isActive) {
        return res.status(401).json({ error: 'Compte inactif ou supprimé' });
      }
      // Révocation : un changement/réinitialisation de mot de passe incrémente tokenVersion.
      // Les jetons émis avant cet incrément deviennent immédiatement inutilisables.
      if (Number(payload.tv) !== Number(user.tokenVersion ?? 0)) {
        return res.status(401).json({ error: 'Session révoquée, veuillez vous reconnecter' });
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
      req.auth = { sessionId: session.id, sessionStart: Number(payload.sst), tokenVersion: Number(payload.tv) };
      req.user = { sub: user.id, email: user.email, fullName: user.fullName, role: activeRole, roles: ownedRoles, teamId: user.teamId };

      // Trace d'activité pour le timeout d'inactivité — écriture throttlée à 1/min.
      // Seules les actions réelles (header X-User-Activity envoyé par le front sur
      // interaction) ou les mutations prolongent la session. Le polling passif
      // (notifications, listes) ne maintient pas un onglet inactif en vie.
      const countsAsActivity = req.headers['x-user-activity'] === '1' || req.method !== 'GET';
      if (countsAsActivity && now.getTime() - session.lastActivityAt.getTime() > 60000) {
        prisma.authSession.update({ where: { id: session.id }, data: { lastActivityAt: now } }).catch(() => {});
      }
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
