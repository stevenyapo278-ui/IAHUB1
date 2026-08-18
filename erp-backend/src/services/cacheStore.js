// Cache mémoire TTL pour les réponses GET à fort volume de lecture (listes d'utilisateurs,
// référentiels GLPI, modèles, réglages...). Les données indexées changent rarement (sync GLPI
// toutes les 10-30 min) : un TTL court élimine la latence de rechargement sans jamais laisser
// de données trop obsolètes. Les écritures (POST/PATCH/DELETE) ne sont jamais mises en cache.
//
// Géré depuis Paramètres > Avancé (statistiques + purge manuelle) via cache.routes.js.
const MAX_ENTRIES = 500; // garde-fou mémoire : au-delà, on évince les entrées les plus anciennes

const store = new Map(); // key -> { value, expiresAt, hits, createdAt }

function createKey(req) {
  return `${req.method} ${req.originalUrl}`;
}

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  entry.hits += 1;
  return entry.value;
}

function set(key, value, ttlSeconds) {
  if (store.size >= MAX_ENTRIES) {
    // Éviction des entrées expirées puis, sinon, des plus anciennes
    for (const [k, e] of store) if (e.expiresAt <= Date.now()) store.delete(k);
    if (store.size >= MAX_ENTRIES) {
      const oldestKey = [...store.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0]?.[0];
      if (oldestKey) store.delete(oldestKey);
    }
  }
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000, hits: 0, createdAt: Date.now() });
}

function clear(prefix) {
  if (!prefix) {
    const size = store.size;
    store.clear();
    return size;
  }
  let removed = 0;
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      removed++;
    }
  }
  return removed;
}

function getStats() {
  let approxBytes = 0;
  const entries = [];
  for (const [key, e] of store) {
    approxBytes += key.length + (JSON.stringify(e.value)?.length || 0);
    entries.push({
      key,
      hits: e.hits,
      ageSeconds: Math.round((Date.now() - e.createdAt) / 1000),
      remainingSeconds: Math.max(0, Math.round((e.expiresAt - Date.now()) / 1000)),
    });
  }
  entries.sort((a, b) => b.hits - a.hits);
  return { count: entries.length, approxBytes, entries: entries.slice(0, 50) };
}

// Purge périodique des entrées expirées (le timer ne maintient pas le process en vie)
setInterval(() => {
  for (const [key, e] of store) if (e.expiresAt <= Date.now()) store.delete(key);
}, 60_000).unref();

module.exports = { createKey, get, set, clear, getStats };