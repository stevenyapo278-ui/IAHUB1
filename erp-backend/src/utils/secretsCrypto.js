const crypto = require('crypto');

// Chiffrement applicatif des secrets stockés en base (clés API, tokens GLPI, secrets OAuth).
// AES-256-GCM : confidentialité + intégrité. Format versionné pour permettre une rotation
// future de la clé : enc:v1:<iv>:<tag>:<ciphertext> (base64url).
const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

let warnedMissingKey = false;

function loadKey() {
  const raw = process.env.SECRETS_ENCRYPTION_KEY;
  if (!raw) return null;

  // Formats acceptés : base64 (44 chars pour 32 octets), hex (64 chars) ou texte de 32 octets.
  const candidates = [
    () => Buffer.from(raw, 'base64'),
    () => Buffer.from(raw, 'hex'),
    () => Buffer.from(raw, 'utf8'),
  ];
  for (const make of candidates) {
    try {
      const key = make();
      if (key && key.length === 32) return key;
    } catch {
      // format suivant
    }
  }
  throw new Error('SECRETS_ENCRYPTION_KEY invalide : fournir 32 octets en base64, hex ou texte (ex. openssl rand -base64 32).');
}

function isEncryptionEnabled() {
  return Boolean(loadKey());
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function encryptSecret(value) {
  if (!value || typeof value !== 'string') return value;
  // Déjà chiffré (réécriture d'une valeur lue) : ne pas doubler le chiffrement.
  if (isEncrypted(value)) return value;

  const key = loadKey();
  if (!key) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn('[secrets] SECRETS_ENCRYPTION_KEY absent : les secrets restent en clair en base. Définir cette variable puis exécuter scripts/encryptSecrets.js.');
    }
    return value;
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

function decryptSecret(value) {
  if (!isEncrypted(value)) return value;

  const key = loadKey();
  if (!key) {
    throw new Error('Secret chiffré en base mais SECRETS_ENCRYPTION_KEY est absent. Restaurez la clé utilisée lors du chiffrement.');
  }

  const [, , ivPart, tagPart, dataPart] = value.split(':');
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error('Secret chiffré au format invalide.');
  }
  try {
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch (err) {
    throw new Error(`Impossible de déchiffrer un secret (clé erronée ou donnée corrompue) : ${err.message}`);
  }
}

module.exports = {
  PREFIX,
  isEncryptionEnabled,
  isEncrypted,
  encryptSecret,
  decryptSecret,
};
