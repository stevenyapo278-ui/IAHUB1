const jwt = require('jsonwebtoken');

// Durée de vie du jeton d'ACCÈS (Bearer envoyé à chaque requête). Courte par défaut :
// un jeton volé n'est exploitable que pendant cette fenêtre. Le renouvellement se fait
// via /auth/refresh (cookie HttpOnly) tant que la session n'est ni inactive ni expirée
// (voir AUTH_IDLE_TIMEOUT_MINUTES et AUTH_SESSION_MAX_HOURS).
const DEFAULT_ACCESS_TTL = '15m';

// Plafond ABSOLU d'une session, quel que soit le nombre de renouvellements du jeton.
// Empêche une session de vivre indéfiniment via /auth/me (l'ancien comportement
// réémettait un jeton toutes les 2 minutes sans limite).
const DEFAULT_SESSION_MAX_HOURS = 12;

function getAccessTokenTtl() {
  return process.env.JWT_EXPIRES_IN || DEFAULT_ACCESS_TTL;
}

function getSessionMaxAgeMs() {
  const parsed = Number.parseFloat(process.env.AUTH_SESSION_MAX_HOURS);
  const hours = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SESSION_MAX_HOURS;
  return hours * 60 * 60 * 1000;
}

// Signe un jeton d'accès en y attachant :
// - sid : identifiant de la session de rafraîchissement (contrôle DB à chaque requête)
// - tv  : version de jeton de l'utilisateur (révocation immédiate après changement de mot de passe)
// - sst : début de session (timestamp UNIX), conservé lors des renouvellements /auth/me
function signAccessToken(user, { role, roles, sessionStart, sessionId } = {}) {
  const userId = user?.id ?? user?.sub;
  if (!userId) throw new Error('Utilisateur invalide pour la signature du JWT');
  if (!sessionId) throw new Error('Session invalide pour la signature du JWT');

  const effectiveRole = role || user.role;
  const effectiveRoles = Array.isArray(roles) && roles.length
    ? roles
    : (Array.isArray(user.roles) && user.roles.length ? user.roles : [effectiveRole]);

  const issuedAt = Math.floor(Date.now() / 1000);
  // sessionStart peut être un Date (création de session) ou un timestamp UNIX en secondes
  // (renouvellement /auth/me). On normalise TOUJOURS en secondes : sinon un Date (ms) donnait
  // un sst dans le futur, et verifyAccessToken rejetait immédiatement le jeton.
  let start = Number(sessionStart);
  if (!Number.isFinite(start)) start = issuedAt;
  else if (start > 1e12) start = Math.floor(start / 1000);

  return jwt.sign(
    {
      sub: userId,
      email: user.email,
      role: effectiveRole,
      roles: effectiveRoles,
      teamId: user.teamId ?? null,
      sid: String(sessionId),
      tv: Number(user.tokenVersion ?? 0),
      sst: start,
    },
    process.env.JWT_SECRET,
    { expiresIn: getAccessTokenTtl() }
  );
}

// Vérifie la signature, l'expiration du jeton ET le plafond absolu de session.
// Les jetons émis avant ce mécanisme (sans tv/sst) sont rejetés : une reconnexion
// unique est nécessaire après déploiement.
function verifyAccessToken(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET);

  if (!payload || payload.tv === undefined || payload.sst === undefined || !payload.sid) {
    const err = new Error('Jeton obsolète : reconnexion requise');
    err.code = 'TOKEN_OUTDATED';
    throw err;
  }

  const sessionStartMs = Number(payload.sst) * 1000;
  const ageMs = Date.now() - sessionStartMs;
  if (!Number.isFinite(ageMs) || ageMs < -60000 || ageMs > getSessionMaxAgeMs()) {
    const err = new Error('Session expirée : reconnexion requise');
    err.code = 'SESSION_EXPIRED';
    throw err;
  }

  return payload;
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  getAccessTokenTtl,
  getSessionMaxAgeMs,
  DEFAULT_ACCESS_TTL,
  DEFAULT_SESSION_MAX_HOURS,
};
