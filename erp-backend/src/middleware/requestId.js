const crypto = require('crypto');

// Génère un identifiant court mais unique pour chaque requête HTTP
// Format : 8 caractères hexadécimaux aléatoires, lisible et traçable
function generateRequestId() {
  return crypto.randomBytes(4).toString('hex');
}

// Middleware Express : attache un requestId à req et le positionne dans
// l'en-tête de réponse X-Request-Id pour le débogage côté client.
// Les child loggers créés avec ce requestId permettent de tracer toutes
// les opérations d'une même requête dans les logs (format JSON).
function requestId(req, res, next) {
  // On utilise un ID existant si le client en fournit un (corrélation cross-service)
  const id = req.headers['x-request-id'] || generateRequestId();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

module.exports = { requestId, generateRequestId };
