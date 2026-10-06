// Validation et découpage d'adresses e-mail (validation hiérarchique, copies CC)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isValidEmail(value) {
  return typeof value === 'string' && EMAIL_RE.test(value.trim());
}

// « a@x.com, b@y.com; c@z.com » → ['a@x.com', 'b@y.com', 'c@z.com'] (dé-doublonné)
function parseEmailList(raw) {
  if (Array.isArray(raw)) raw = raw.join(', ');
  if (typeof raw !== 'string') return [];
  const out = [];
  const seen = new Set();
  for (const part of raw.split(/[,;\n]/)) {
    const addr = part.trim();
    if (!addr) continue;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(addr);
  }
  return out;
}

// Découpe puis valide : { list, invalid } — invalid = les adresses mal formées
function validateEmailList(raw) {
  const list = parseEmailList(raw);
  return { list, invalid: list.filter((addr) => !isValidEmail(addr)) };
}

module.exports = { isValidEmail, parseEmailList, validateEmailList };
