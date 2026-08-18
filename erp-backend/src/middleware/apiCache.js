// Middleware de cache de réponse pour les routes GET — voir services/cacheStore.js.
// Câblé uniquement sur les montages de routes à lecture lourde (utilisateurs, référentiels
// GLPI, templates, réglages...). Ne touche jamais aux requêtes d'écriture ni aux erreurs.
const cacheStore = require('../services/cacheStore');

function apiCache(ttlSeconds) {
  return (req, res, next) => {
    if (!ttlSeconds || ttlSeconds <= 0) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const key = cacheStore.createKey(req);
    const cached = cacheStore.get(key);
    if (cached !== null) {
      res.set('X-Cache', 'HIT');
      res.set('Cache-Control', `public, max-age=${ttlSeconds}`);
      return res.json(cached);
    }

    // Capture la réponse JSON pour la mettre en cache (uniquement si le statut est un succès)
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cacheStore.set(key, body, ttlSeconds);
        res.set('X-Cache', 'MISS');
        res.set('Cache-Control', `public, max-age=${ttlSeconds}`);
      }
      return originalJson(body);
    };
    next();
  };
}

module.exports = { apiCache };