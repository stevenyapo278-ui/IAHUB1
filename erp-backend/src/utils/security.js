// ── Module de sécurité centralisé ─────────────────────────────────────────
// Fournit des helpers pour la validation des uploads, la sanitization HTML,
// la protection contre le mass assignment, et le masquage des données sensibles.

// ── 1. Validation des uploads ─────────────────────────────────────────────

// Extensions dangereuses qui ne doivent JAMAIS être uploadées
const DANGEROUS_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'pif', 'vbs', 'vbe', 'js', 'jse',
  'ws', 'wsc', 'wsh', 'ps1', 'psm1', 'psd1', 'psc1', 'reg', 'inf',
  'sh', 'bash', 'csh', 'ksh', 'zsh', 'php', 'php3', 'php4', 'php5', 'php7', 'php8',
  'phtml', 'phps', 'cgi', 'pl', 'py', 'rb', 'cgi', 'fcgi', 'perl',
  'asp', 'aspx', 'asa', 'asax', 'ascx', 'ashx', 'asmx', 'cer', 'cfm', 'cfc',
  'jsp', 'jspx', 'jspxf', 'wss', 'do', 'action', 'shtml', 'shtm',
  'htaccess', 'htpasswd', 'env', 'config', 'ini', 'log', 'sql', 'db', 'sqlite',
  'dll', 'so', 'dylib', 'class', 'jar', 'war', 'ear',
  'bin', 'command', 'csh', 'ksh', 'app', 'pkg', 'deb', 'rpm',
  'msp', 'mst', 'gadget', 'application',
]);

// Extensions de types MIME dangereux
const DANGEROUS_MIME_TYPES = new Set([
  'application/x-msdownload', 'application/x-msdos-program',
  'application/x-executable', 'application/x-sharedlib',
  'application/javascript', 'text/javascript', 'text/x-python',
  'text/x-perl', 'text/x-shellscript', 'application/x-php',
  'application/x-httpd-php', 'application/x-sh',
]);

// Extensions autorisées pour les uploads de tickets
const TICKET_ALLOWED_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'txt', 'csv', 'rtf', 'odt', 'ods', 'odp',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp',
  'zip', 'rar', '7z',
  'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv',
  'eml', 'msg',
  // SVG autorisé mais sera sanitizer séparément
  'svg',
]);

// Extensions autorisées pour la base de connaissances
const KB_ALLOWED_EXTENSIONS = new Set([
  'pdf', 'docx', 'md', 'markdown', 'txt',
]);

/**
 * Valide qu'un fichier uploadé n'est pas dangereux.
 * @param {string} originalname - Nom original du fichier
 * @param {string} mimetype - MIME type déclaré
 * @param {string} context - 'ticket' | 'kb' | 'followup' | 'logo'
 * @returns {{ valid: boolean, error?: string }}
 */
function validateUpload(originalname, mimetype, context = 'ticket') {
  const ext = (originalname.split('.').pop() || '').toLowerCase();

  // Vérifier extension dangereuse
  if (DANGEROUS_EXTENSIONS.has(ext)) {
    return { valid: false, error: `Extension dangereuse refusée : .${ext}` };
  }

  // Vérifier MIME type dangereux
  if (DANGEROUS_MIME_TYPES.has(mimetype)) {
    return { valid: false, error: `Type MIME dangereux refusé : ${mimetype}` };
  }

  // Vérifier extension autorisée selon le contexte
  const allowedMap = {
    ticket: TICKET_ALLOWED_EXTENSIONS,
    kb: KB_ALLOWED_EXTENSIONS,
    followup: new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']),
    logo: new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']),
  };
  const allowed = allowedMap[context] || TICKET_ALLOWED_EXTENSIONS;
  if (!allowed.has(ext)) {
    return { valid: false, error: `Extension non autorisée : .${ext}` };
  }

  // Double extension check (ex: file.jpg.exe)
  const parts = originalname.split('.');
  if (parts.length > 2) {
    const secondExt = parts[parts.length - 2].toLowerCase();
    if (DANGEROUS_EXTENSIONS.has(secondExt)) {
      return { valid: false, error: `Double extension dangereuse détectée : .${secondExt}.${ext}` };
    }
  }

  return { valid: true };
}

/**
 * Génère un nom de fichier sûr (sans caractères dangereux).
 */
function safeFilename(originalname) {
  const ext = (originalname.split('.').pop() || '').toLowerCase();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}


// ── 2. Sanitization HTML (server-side) ───────────────────────────────────

/**
 * Nettoie le HTML pour prévenir les XSS stockés.
 * Supprime les balises script, iframe, object, embed, form, et les event handlers.
 * Utilisé pour le contenu des followups de tickets.
 */
function sanitizeTicketHtml(html) {
  if (!html || typeof html !== 'string') return html;

  // Supprimer les balises dangereuses (tout le contenu entre les balises)
  let cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '')
    .replace(/<applet\b[^<]*(?:(?!<\/applet>)<[^<]*)*<\/applet>/gi, '')
    .replace(/<meta\b[^>]*>/gi, '')
    .replace(/<link\b[^>]*>/gi, '');

  // Supprimer les event handlers (on*="...")
  cleaned = cleaned.replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // Supprimer les protocoles javascript: et data: dans les href/src
  cleaned = cleaned.replace(/href\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, 'href=""');
  cleaned = cleaned.replace(/src\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, 'src=""');

  // Autoriser uniquement les balises HTML sûres
  const SAFE_TAGS = new Set([
    'p', 'br', 'b', 'i', 'u', 'em', 'strong', 's', 'del', 'ins',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'a', 'span', 'div', 'table', 'thead', 'tbody',
    'tr', 'td', 'th', 'blockquote', 'pre', 'code', 'hr', 'img',
    'sub', 'sup', 'small', 'big', 'mark', 'abbr', 'cite',
  ]);

  // Garder uniquement les balises sûres (supprime les balises non autorisées mais garde le contenu)
  cleaned = cleaned.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/gi, (match, tagName) => {
    if (tagName && SAFE_TAGS.has(tagName.toLowerCase())) {
      // Pour img, garder src et alt uniquement
      if (tagName.toLowerCase() === 'img') {
        const srcMatch = match.match(/src\s*=\s*["']([^"']+)["']/i);
        const altMatch = match.match(/alt\s*=\s*["']([^"']*)["']/i);
        const src = srcMatch ? srcMatch[1] : '';
        const alt = altMatch ? altMatch[1] : '';
        return `<img src="${src}" alt="${alt}" />`;
      }
      // Pour a, garder href et target uniquement
      if (tagName.toLowerCase() === 'a') {
        const hrefMatch = match.match(/href\s*=\s*["']([^"']+)["']/i);
        const href = hrefMatch ? hrefMatch[1] : '#';
        const textMatch = match.match(/>([\s\S]*?)<\/a>/i);
        const text = textMatch ? textMatch[1] : '';
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
      }
      return match;
    }
    // Balise non autorisée : supprimer la balise mais garder le contenu
    return match.replace(/<[^>]+>/g, '');
  });

  return cleaned;
}


// ── 3. Protection Mass Assignment ────────────────────────────────────────

// Champs autorisés pour la modification de ticket (PATCH)
const TICKET_PATCH_ALLOWED = new Set([
  'title', 'content', 'status', 'priority', 'category', 'teamId', 'assignedToId',
  'requesterId', 'sourceName', 'sourceEmail', 'type', 'urgency', 'impact',
  'source', 'externalId', 'dueDate', 'assetIds', 'observerIds',
  'approvalStatus', 'isMajorIncident', 'impactedSites', 'closeSuggested',
]);

// Champs autorisés pour la création de ticket (POST)
const TICKET_POST_ALLOWED = new Set([
  'title', 'content', 'priority', 'category', 'teamId', 'assignedToId',
  'requesterId', 'requiresApproval', 'type', 'urgency', 'impact',
  'source', 'externalId', 'status', 'openedAt', 'locationId', 'dueDate',
  'observerIds', 'assetIds', 'customFields',
]);

// Champs autorisés pour la modification d'utilisateur (PATCH)
const USER_PATCH_ALLOWED = new Set([
  'fullName', 'email', 'role', 'teamId', 'isActive', 'mustChangePassword',
]);

/**
 * Filtre un objet pour ne garder que les champs autorisés.
 * @param {object} body - Corps de la requête
 * @param {Set<string>} allowed - Set des noms de champs autorisés
 * @returns {object} - Objet filtré
 */
function filterAllowedFields(body, allowed) {
  const filtered = {};
  for (const key of Object.keys(body)) {
    if (allowed.has(key)) {
      filtered[key] = body[key];
    }
  }
  return filtered;
}


// ── 4. Masquage des données sensibles dans les logs ──────────────────────

/**
 * Masque les données sensibles dans un objet avant logging.
 */
function maskSensitive(obj, sensitiveKeys = ['password', 'passwordHash', 'apiKey', 'token', 'secret', 'creditCard', 'ssn']) {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => maskSensitive(item, sensitiveKeys));
  }

  const masked = { ...obj };
  for (const key of Object.keys(masked)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sk => lowerKey.includes(sk.toLowerCase()))) {
      if (typeof masked[key] === 'string' && masked[key].length > 4) {
        masked[key] = masked[key].slice(0, 2) + '****' + masked[key].slice(-2);
      } else {
        masked[key] = '****';
      }
    }
  }
  return masked;
}

/**
 * Masque un email partiellement : j***@domain.com
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return email;
  const [local, domain] = email.split('@');
  if (!domain) return email;
  if (local.length <= 2) return '*@' + domain;
  return local[0] + '***@' + domain;
}


// ── 5. Account Lockout ──────────────────────────────────────────────────

// Store en mémoire pour le lockout (en production, utiliser Redis)
const loginAttempts = new Map();
const LOCKOUT_THRESHOLD = 10; // tentatives échouées avant lockout
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Enregistre une tentative de connexion échouée.
 */
function recordFailedLogin(email) {
  const key = email.toLowerCase().trim();
  const record = loginAttempts.get(key) || { count: 0, firstAttempt: Date.now() };
  record.count += 1;
  record.lastAttempt = Date.now();
  if (record.count === 1) record.firstAttempt = Date.now();
  loginAttempts.set(key, record);
}

/**
 * Réinitialise le compteur après connexion réussie.
 */
function clearFailedLogins(email) {
  loginAttempts.delete(email.toLowerCase().trim());
}

/**
 * Vérifie si un compte est lockout.
 */
function isAccountLocked(email) {
  const key = email.toLowerCase().trim();
  const record = loginAttempts.get(key);
  if (!record) return false;

  // Si le lockout a expiré, réinitialiser
  if (Date.now() - record.firstAttempt > LOCKOUT_DURATION_MS) {
    loginAttempts.delete(key);
    return false;
  }

  return record.count >= LOCKOUT_THRESHOLD;
}

/**
 * Nettoyage périodique des entrées expirées (appeler toutes les 5 min).
 */
function cleanupLockouts() {
  const now = Date.now();
  for (const [key, record] of loginAttempts) {
    if (now - record.firstAttempt > LOCKOUT_DURATION_MS) {
      loginAttempts.delete(key);
    }
  }
}

// Nettoyage automatique toutes les 5 minutes
setInterval(cleanupLockouts, 5 * 60 * 1000).unref();


module.exports = {
  // Uploads
  validateUpload,
  safeFilename,
  DANGEROUS_EXTENSIONS,
  TICKET_ALLOWED_EXTENSIONS,
  KB_ALLOWED_EXTENSIONS,

  // HTML
  sanitizeTicketHtml,

  // Mass assignment
  filterAllowedFields,
  TICKET_PATCH_ALLOWED,
  TICKET_POST_ALLOWED,
  USER_PATCH_ALLOWED,

  // Logs
  maskSensitive,
  maskEmail,

  // Lockout
  recordFailedLogin,
  clearFailedLogins,
  isAccountLocked,
};
