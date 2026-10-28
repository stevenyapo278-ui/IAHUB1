// ── Middleware auditLogger ──────────────────────────────────────────────────────
// Capture pour chaque requête HTTP les informations nécessaires au
// journaux d'audit enrichi : IP, User-Agent, méthode, chemin, requestId,
// rôle/équipe de l'utilisateur, code de statut et temps de réponse.
//
// Placer après les middlewares existants (helmet, cors, express.json,
// requestId, rate limiter) et avant les routes protégées. Il ne modifie
// jamais la réponse (pas de next(err)), il ne ferme pas le flux. C'est un
// observateur, pas un intercepteur.
//
// Les données sensibles (auth, cookies, tokens) ne sont PAS journalisées :
// - l'en-tête Authorization est retiré
// - l'Cookie est anonymisé (noms seulement)
// - les payloads côté service sont filtrés à la saisie (voir auditLogService)

const { logger, childLogger } = require('../utils/logger');

const AUDIT_LOG_LEVEL = process.env.AUDIT_LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const AUDIT_EVENTS_ENABLED = logger.level === 'debug' || logger.level === 'info' || logger.level === 'silly';

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower.includes('authorization') || lower.includes('cookie') || lower.includes('set-cookie')) {
      out[key] = '[FILTERED]';
    } else if (typeof value === 'string' && value.length > 500) {
      out[key] = value.slice(0, 500) + '…';
    } else {
      out[key] = value;
    }
  }
  return out;
}

function getClientIp(req) {
  return req.ip || req.connection?.remoteAddress || null;
}

function detectTenant(req) {
  return req.tenantId || req.orgId || null;
}

function buildAuditEvent(req, res, startTime, meta = {}) {
  const method = req.method || '-';
  const path = req.path || req.originalUrl || '-';
  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || null;
  const statusCode = res.statusCode >= 100 && res.statusCode < 600 ? res.statusCode : null;
  const responseTimeMs = process.hrtime.bigint()
    ? Number(process.hrtime.bigint() - startTime) : null;

  const event = {
    event: 'HTTP_REQUEST',
    timestamp: new Date().toISOString(),
    method,
    path,
    ip,
    userAgent,
    requestId: req.requestId || null,
    tenant: detectTenant(req),
    userId: req.user?.id || null,
    userEmail: req.user?.email || null,
    userName: req.user?.fullName || null,
    userRole: req.user?.role || null,
    userTeamId: req.user?.teamId || null,
    headers: sanitizeHeaders(req.headers),
    ...meta,
    statusCode,
    responseTimeMs,
  };

  return event;
}

// Middleware de fin de cycle de vie (après les routes)
function auditLogger(req, res, next) {
  if (!AUDIT_EVENTS_ENABLED) return next();

  const startTime = process.hrtime.bigint();
  const requestId = req.requestId || 'unknown';

  // Wrapper pour capturer statusCode et temps de réponse à la fin
  const originalEnd = res.end;
  let wrapped = false;

  const wrappedEnd = function (chunk, encoding, callback) {
    if (wrapped) return originalEnd.apply(this, arguments);
    wrapped = true;

    const statusCode = res.statusCode || 200; // fallback si jamais le handler n'a pas répondu
    const responseTimeMs = process.hrtime.bigint()
      ? Number(process.hrtime.bigint() - startTime) : null;

    const event = buildAuditEvent(req, res, startTime, {
      chunkLength: typeof chunk === 'string' ? chunk.length : null,
    });

    // Logger avec le niveau demandé (info/debug/error selon env)
    const level = AUDIT_LOG_LEVEL === 'debug' ? 'debug' : AUDIT_LOG_LEVEL === 'info' ? 'info' : 'error';
    const log = childLogger(requestId);
    const levelFn = log[level] || log.info;
    levelFn('HTTP request completed', event);

    return originalEnd.call(this, chunk, encoding, callback);
  };

  res.end = wrappedEnd;

  // Pas de next(err) ici : c'est un middleware d'observateur. Le flux continue.
  next();
}

module.exports = { auditLogger, buildAuditEvent, sanitizeHeaders, getClientIp };
