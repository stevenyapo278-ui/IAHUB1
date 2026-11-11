const crypto = require('crypto');
const cookie = require('cookie');
const prisma = require('../prismaClient');
const { getSessionMaxAgeMs } = require('./authToken');

const REFRESH_COOKIE = 'ia_hub_refresh';
const DEFAULT_IDLE_TIMEOUT_MINUTES = 30;
const DEFAULT_MAX_SESSIONS = 10;
const SESSION_RETENTION_DAYS = 7;

function getIdleTimeoutMs() {
  const parsed = Number.parseFloat(process.env.AUTH_IDLE_TIMEOUT_MINUTES);
  const minutes = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_IDLE_TIMEOUT_MINUTES;
  return minutes * 60 * 1000;
}

function getMaxSessions() {
  const parsed = Number.parseInt(process.env.AUTH_MAX_SESSIONS, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_SESSIONS;
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function generateRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

function cookieOptions(maxAgeMs) {
  const sameSite = (process.env.AUTH_COOKIE_SAMESITE || 'lax').toLowerCase();
  const secure = process.env.NODE_ENV === 'production' || process.env.AUTH_COOKIE_SECURE === 'true';
  const options = {
    httpOnly: true,
    secure,
    // Lax protège des POST cross-site tout en restant compatible avec le front sur un
    // autre port/sous-domaine. Mettre AUTH_COOKIE_SAMESITE=none + HTTPS si nécessaire.
    sameSite: ['lax', 'strict', 'none'].includes(sameSite) ? sameSite : 'lax',
    path: '/api/auth',
  };
  if (maxAgeMs !== undefined) options.maxAge = Math.max(0, maxAgeMs);
  return options;
}

function setRefreshCookie(res, token, maxAgeMs) {
  res.cookie(REFRESH_COOKIE, token, cookieOptions(maxAgeMs));
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
}

function readRefreshToken(req) {
  const cookies = cookie.parse(req.headers.cookie || '');
  return cookies[REFRESH_COOKIE] || null;
}

// Crée une session et renvoie le token EN CLAIR (à placer dans le cookie) + la ligne DB.
// Seul le hash est stocké : une fuite de la base ne permet pas de rejouer les refresh tokens.
async function createAuthSession({ userId, tokenVersion = 0, activeRole, req }) {
  const token = generateRefreshToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + getSessionMaxAgeMs());

  // Limite le nombre de sessions actives : les plus anciennes (dernière activité la plus
  // lointaine) sont révoquées pour laisser la place à la nouvelle. Évite l'accumulation
  // illimitée de refresh tokens valides pour un même compte.
  const maxSessions = getMaxSessions();
  if (maxSessions > 0) {
    const activeSessions = await prisma.authSession.findMany({
      where: { userId: Number(userId), revokedAt: null, expiresAt: { gt: now } },
      orderBy: { lastActivityAt: 'asc' },
      select: { id: true },
    });
    const excess = activeSessions.length - (maxSessions - 1);
    if (excess > 0) {
      const toRevoke = activeSessions.slice(0, excess).map((s) => s.id);
      await prisma.authSession.updateMany({
        where: { id: { in: toRevoke }, revokedAt: null },
        data: { revokedAt: now },
      });
      for (const id of toRevoke) disconnectSessionSockets(id);
    }
  }

  const session = await prisma.authSession.create({
    data: {
      userId,
      tokenHash: hashRefreshToken(token),
      tokenVersion: Number(tokenVersion) || 0,
      activeRole: activeRole || null,
      sessionStart: now,
      lastActivityAt: now,
      expiresAt,
      ipAddress: req?.ip || null,
      userAgent: req?.headers?.['user-agent']?.slice(0, 500) || null,
    },
  });
  return { session, token, expiresAt };
}

function disconnectSessionSockets(sessionId) {
  try {
    const { disconnectSession } = require('./socket');
    disconnectSession(sessionId, 'Session révoquée');
  } catch {
    // Socket.IO peut ne pas être initialisé (tests, scripts) : la révocation DB suffit.
  }
}

function disconnectUserSockets(userId, exceptSessionId) {
  try {
    const { disconnectUserSessions } = require('./socket');
    disconnectUserSessions(userId, { exceptSessionId, reason: 'Session révoquée' });
  } catch {
    // idem
  }
}

async function revokeSession(sessionId) {
  if (!sessionId) return;
  await prisma.authSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  disconnectSessionSockets(sessionId);
}

// Vérifie qu'une session référencée par un jeton d'accès est toujours vivante
// (non révoquée, non expirée, non inactive, compte actif).
async function findLiveSessionById(sessionId) {
  if (!sessionId) return null;
  const now = new Date();
  const session = await prisma.authSession.findUnique({
    where: { id: String(sessionId) },
    select: {
      id: true,
      userId: true,
      revokedAt: true,
      expiresAt: true,
      lastActivityAt: true,
      tokenVersion: true,
      user: { select: { id: true, email: true, role: true, teamId: true, isActive: true, tokenVersion: true } },
    },
  });
  if (!session || session.revokedAt || session.expiresAt <= now) return null;
  if (now.getTime() - session.lastActivityAt.getTime() > getIdleTimeoutMs()) return null;
  if (!session.user?.isActive) return null;
  return session;
}

// Vérifie qu'une session référencée par un jeton d'accès est toujours vivante
// (non révoquée, non expirée, non inactive, compte actif, version de jeton à jour).
// Utilisé par les endpoints qui authentifient hors du middleware Express (fichiers, vocal).
async function findLiveSession(payload) {
  if (!payload?.sid) return null;
  const session = await findLiveSessionById(payload.sid);
  if (!session) return null;
  if (session.userId !== Number(payload.sub)) return null;
  if (Number(payload.tv) !== Number(session.user.tokenVersion ?? 0)) return null;
  return session;
}

async function revokeAllUserSessions(userId, { exceptSessionId } = {}) {
  if (!userId) return;
  const where = { userId: Number(userId), revokedAt: null };
  if (exceptSessionId) where.id = { not: exceptSessionId };
  await prisma.authSession.updateMany({ where, data: { revokedAt: new Date() } });
  disconnectUserSockets(userId, exceptSessionId);
}

// Retrouve une session par le hash du refresh token courant OU par le hash précédent
// (fenêtre de grâce après rotation). Sert à la détection de rejeu.
async function findSessionByRefreshToken(rawToken) {
  if (!rawToken) return null;
  const tokenHash = hashRefreshToken(rawToken);
  return prisma.authSession.findFirst({
    where: { OR: [{ tokenHash }, { previousTokenHash: tokenHash }] },
    include: {
      user: { select: { id: true, email: true, fullName: true, role: true, roles: true, teamId: true, isActive: true, tokenVersion: true } },
    },
  });
}

// Purge les sessions expirées/révoquées anciennes et les tokens de reset utilisés/expirés.
// À planifier côté serveur (toutes les 6 h) pour éviter la croissance indéfinie des tables.
async function cleanupExpiredAuthSessions({ retentionDays = SESSION_RETENTION_DAYS } = {}) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const [sessions, resetTokens] = await Promise.all([
    prisma.authSession.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: cutoff } },
          { revokedAt: { lt: cutoff } },
        ],
      },
    }),
    prisma.passwordResetToken.deleteMany({
      where: {
        OR: [
          { usedAt: { lt: cutoff } },
          { expiresAt: { lt: cutoff } },
        ],
      },
    }),
  ]);
  return { sessions: sessions.count, resetTokens: resetTokens.count };
}

module.exports = {
  REFRESH_COOKIE,
  getIdleTimeoutMs,
  getMaxSessions,
  hashRefreshToken,
  // Les tokens de reset utilisent le même hachage opaque que les refresh tokens.
  hashOpaqueToken: hashRefreshToken,
  generateRefreshToken,
  cookieOptions,
  setRefreshCookie,
  clearRefreshCookie,
  readRefreshToken,
  createAuthSession,
  findLiveSession,
  findLiveSessionById,
  findSessionByRefreshToken,
  revokeSession,
  revokeAllUserSessions,
  cleanupExpiredAuthSessions,
};
