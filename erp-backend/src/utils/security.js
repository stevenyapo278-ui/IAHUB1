// ── Module de sécurité centralisé ─────────────────────────────────────────
// Fournit des helpers pour la validation des uploads, la sanitization HTML,
// la protection contre le mass assignment, et le masquage des données sensibles.

const prisma = require('../prismaClient');

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

  // Convertir les URLs absolues localhost / 127.0.0.1 des uploads en chemins relatifs (/uploads/...)
  let cleaned = html.replace(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(\/uploads\/[^\s"'>]+)/gi, '$1');

  // Supprimer les balises dangereuses (tout le contenu entre les balises)
  cleaned = cleaned
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

  // Supprimer les protocoles javascript: et data: dans les href/src.
  // Gère les guillemets simples, doubles et les attributs non encadrés.
  // Les data: sont bloqués partout (href, src) sauf les images raster dans <img src="data:image/...">
  // (png/jpeg/gif/webp) qui sont inoffensifs et conservent l'affichage des captures collées.
  const isUnsafeUrl = (value, attr) => {
    const v = String(value || '').trim().toLowerCase();
    if (v.startsWith('javascript:')) return true;
    if (v.startsWith('data:')) {
      const safeRasterImage = /^data:image\/(?:png|jpe?g|gif|webp|bmp|x-icon|vnd\.microsoft\.icon)[;,]/.test(v);
      return !(safeRasterImage && attr.toLowerCase() === 'src');
    }
    return false;
  };
  cleaned = cleaned.replace(/\b(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (match, attr, dq, sq, unquoted) => {
    const value = dq ?? sq ?? unquoted ?? '';
    return isUnsafeUrl(value, attr) ? `${attr}=""` : match;
  });

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
        // Src vide (protocole dangereux retiré ci-dessus) : la balise ne sert à rien → on la supprime
        if (!src || isUnsafeUrl(src, 'src')) return '';
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
  'requesterId', 'type', 'urgency', 'impact',
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


// ── 5. Account Lockout (persistant) ────────────────────────────────────
// Le compteur est stocké en base (table LoginAttempt) : il survit aux redémarrages
// et reste cohérent si plusieurs instances tournent derrière un load balancer.
const LOCKOUT_THRESHOLD = Number.parseInt(process.env.AUTH_LOCKOUT_THRESHOLD, 10) || 10;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // fenêtre d'observation des échecs
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // durée du verrouillage

function normalizeLoginKey(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Enregistre une tentative de connexion échouée (upsert atomique).
 */
async function recordFailedLogin(email) {
  const key = normalizeLoginKey(email);
  if (!key) return;

  const now = new Date();
  const windowStart = new Date(now.getTime() - LOCKOUT_WINDOW_MS);
  const lockedUntil = new Date(now.getTime() + LOCKOUT_DURATION_MS);

  try {
    await prisma.$executeRaw`
      INSERT INTO "LoginAttempt" ("key", "count", "firstAttemptAt", "lastAttemptAt", "lockedUntil")
      VALUES (${key}, 1, ${now}, ${now}, NULL)
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "LoginAttempt"."firstAttemptAt" < ${windowStart} THEN 1
          ELSE "LoginAttempt"."count" + 1 END,
        "firstAttemptAt" = CASE
          WHEN "LoginAttempt"."firstAttemptAt" < ${windowStart} THEN ${now}
          ELSE "LoginAttempt"."firstAttemptAt" END,
        "lastAttemptAt" = ${now},
        "lockedUntil" = CASE
          WHEN "LoginAttempt"."firstAttemptAt" < ${windowStart} THEN NULL
          WHEN "LoginAttempt"."count" + 1 >= ${LOCKOUT_THRESHOLD} THEN ${lockedUntil}
          ELSE "LoginAttempt"."lockedUntil" END
    `;
  } catch (err) {
    // Ne jamais bloquer une connexion à cause d'un incident sur le compteur.
    console.error(`[security] Enregistrement de l'échec de connexion impossible : ${err.message}`);
  }
}

/**
 * Réinitialise le compteur après connexion réussie.
 */
async function clearFailedLogins(email) {
  const key = normalizeLoginKey(email);
  if (!key) return;
  try {
    await prisma.loginAttempt.deleteMany({ where: { key } });
  } catch (err) {
    console.error(`[security] Réinitialisation du compteur de connexion impossible : ${err.message}`);
  }
}

/**
 * Vérifie si un compte est verrouillé.
 */
async function isAccountLocked(email) {
  const key = normalizeLoginKey(email);
  if (!key) return false;

  try {
    const record = await prisma.loginAttempt.findUnique({ where: { key } });
    if (!record) return false;

    const now = Date.now();
    if (record.lockedUntil && record.lockedUntil.getTime() > now) return true;

    // Fenêtre écoulée : on remet le compteur à zéro.
    if (now - record.firstAttemptAt.getTime() > LOCKOUT_WINDOW_MS) {
      await prisma.loginAttempt.deleteMany({ where: { key } });
      return false;
    }

    return record.count >= LOCKOUT_THRESHOLD;
  } catch (err) {
    // Fail-open : une panne DB ne doit pas empêcher tout le monde de se connecter.
    console.error(`[security] Vérification du verrouillage impossible : ${err.message}`);
    return false;
  }
}

/**
 * Nettoyage périodique des compteurs inactifs (appelé toutes les 5 min).
 */
async function cleanupLockouts() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    await prisma.loginAttempt.deleteMany({ where: { lastAttemptAt: { lt: cutoff } } });
  } catch {
    // Nettoyage best-effort.
  }
}

// Nettoyage automatique toutes les 5 minutes
setInterval(() => { cleanupLockouts().catch(() => {}); }, 5 * 60 * 1000).unref();


// ── 6. Politique de mot de passe ───────────────────────────────────────
// Longueur minimale (12 par défaut) + complexité + refus des mots de passe les plus
// courants. Appliquée à la création, la réinitialisation et le changement de mot de passe.
const MIN_PASSWORD_LENGTH = Number.parseInt(process.env.PASSWORD_MIN_LENGTH, 10) || 12;

const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'password123',
  'motdepasse', 'motdepasse1', 'azerty', 'azerty123', 'qwerty', 'qwerty123',
  'admin123', 'admin1234', 'administrateur', 'welcome', 'welcome1', 'letmein',
  'changeme', 'changezmoi', 'p@ssw0rd', 'passw0rd', 'soleil', 'bonjour',
  'prosuma', 'prosuma123', 'ia-hub', 'iahub2024', 'iahub2025', 'iahub2026',
  'default', 'root1234', 'superadmin', 'superadmin123', 'test1234', 'test12345',
]);

const FORBIDDEN_SEQUENCES = [
  'azerty', 'qwerty', '123456', 'abcdef', 'motdepasse', 'password', 'letmein',
  'welcome', 'prosuma',
];

/**
 * Valide la robustesse d'un mot de passe.
 * @returns {{ valid: boolean, error?: string }}
 */
function validatePasswordStrength(password) {
  const value = String(password ?? '');

  if (value.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.` };
  }
  if (!/[a-z]/.test(value)) {
    return { valid: false, error: 'Le mot de passe doit contenir au moins une minuscule.' };
  }
  if (!/[A-Z]/.test(value)) {
    return { valid: false, error: 'Le mot de passe doit contenir au moins une majuscule.' };
  }
  if (!/\d/.test(value)) {
    return { valid: false, error: 'Le mot de passe doit contenir au moins un chiffre.' };
  }
  if (!/[^A-Za-z0-9]/.test(value)) {
    return { valid: false, error: 'Le mot de passe doit contenir au moins un caractère spécial.' };
  }

  const lower = value.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    return { valid: false, error: 'Ce mot de passe est trop courant : choisissez-en un autre.' };
  }
  if (FORBIDDEN_SEQUENCES.some((seq) => lower.includes(seq))) {
    return { valid: false, error: 'Le mot de passe contient une suite trop prévisible (azerty, qwerty, 123456, nom de l’organisation…).' };
  }
  if (/^(.)\1+$/.test(value)) {
    return { valid: false, error: 'Le mot de passe ne peut pas être un caractère répété.' };
  }

  return { valid: true };
}



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
  cleanupLockouts,

  // Politique de mot de passe
  MIN_PASSWORD_LENGTH,
  validatePasswordStrength,
};
