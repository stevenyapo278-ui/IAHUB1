// Middleware de cache de réponse pour les routes GET — voir services/cacheStore.js.
// Câblé uniquement sur les montages de routes à lecture lourde (utilisateurs, référentiels
// GLPI, templates, réglages...). Ne touche jamais aux requêtes d'écriture ni aux erreurs.
//
// Cache-Control: no-cache, private — le cache in-memory backend reste actif (évite les
// requêtes DB répétées), mais le navigateur doit toujours revalider auprès du serveur avant
// de servir une réponse. Cela évite que des suppressions/modifications ne soient masquées
// par une copie locale du navigateur pendant le TTL (60s).
const cacheStore = require('../services/cacheStore');

function apiCache(ttlSeconds) {
  return (req, res, next) => {
    if (!ttlSeconds || ttlSeconds <= 0) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const key = cacheStore.createKey(req);
    const cached = cacheStore.get(key);
    if (cached !== null) {
      res.set('X-Cache', 'HIT');
      // no-cache force le navigateur à revalider : il contacte le serveur qui répond
      // depuis le cache mémoire (fast path) sans toucher la DB. private évite le cache
      // des proxies/CDN intermédiaires qui ne connaissent pas l'état de la session.
      res.set('Cache-Control', 'no-cache, private');
      return res.json(cached);
    }

    // Capture la réponse JSON pour la mettre en cache (uniquement si le statut est un succès)
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cacheStore.set(key, body, ttlSeconds);
        res.set('X-Cache', 'MISS');
        res.set('Cache-Control', 'no-cache, private');
      }
      return originalJson(body);
    };
    next();
  };
}

module.exports = { apiCache };