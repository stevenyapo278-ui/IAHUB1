// Tests du chiffrement applicatif des secrets (AES-256-GCM).
// Aucune connexion base : le module est pur.

const crypto = require('crypto');
const {
  PREFIX,
  isEncryptionEnabled,
  isEncrypted,
  encryptSecret,
  decryptSecret,
} = require('./secretsCrypto');

const KEY = crypto.randomBytes(32).toString('base64');

describe('secretsCrypto', () => {
  const originalKey = process.env.SECRETS_ENCRYPTION_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
    else process.env.SECRETS_ENCRYPTION_KEY = originalKey;
  });

  it('chiffre puis déchiffre une valeur sans la modifier', () => {
    process.env.SECRETS_ENCRYPTION_KEY = KEY;
    const plain = 'glpi-app-token-secret-123';
    const encrypted = encryptSecret(plain);

    expect(encrypted).not.toBe(plain);
    expect(encrypted.startsWith(PREFIX)).toBe(true);
    expect(isEncrypted(encrypted)).toBe(true);
    expect(decryptSecret(encrypted)).toBe(plain);
  });

  it('produit un chiffré différent à chaque appel (IV aléatoire)', () => {
    process.env.SECRETS_ENCRYPTION_KEY = KEY;
    const a = encryptSecret('same-value');
    const b = encryptSecret('same-value');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same-value');
    expect(decryptSecret(b)).toBe('same-value');
  });

  it("n'encode pas deux fois une valeur déjà chiffrée", () => {
    process.env.SECRETS_ENCRYPTION_KEY = KEY;
    const once = encryptSecret('secret');
    expect(encryptSecret(once)).toBe(once);
    expect(decryptSecret(encryptSecret(once))).toBe('secret');
  });

  it('laisse passer les valeurs vides ou non textuelles', () => {
    process.env.SECRETS_ENCRYPTION_KEY = KEY;
    expect(encryptSecret('')).toBe('');
    expect(encryptSecret(null)).toBe(null);
    expect(encryptSecret(undefined)).toBe(undefined);
    expect(decryptSecret('valeur-en-clair-historique')).toBe('valeur-en-clair-historique');
  });

  it('refuse de déchiffrer avec une mauvaise clé', () => {
    process.env.SECRETS_ENCRYPTION_KEY = KEY;
    const encrypted = encryptSecret('top-secret');
    process.env.SECRETS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    expect(() => decryptSecret(encrypted)).toThrow(/Impossible de déchiffrer/);
  });

  it('reste en clair et le signale si la clé est absente', () => {
    delete process.env.SECRETS_ENCRYPTION_KEY;
    expect(isEncryptionEnabled()).toBe(false);
    expect(encryptSecret('sans-cle')).toBe('sans-cle');
    // Une valeur déjà chiffrée reste illisible sans la clé : erreur explicite.
    expect(() => decryptSecret(`${PREFIX}aaa:bbb:ccc`)).toThrow(/SECRETS_ENCRYPTION_KEY est absent/);
  });

  it('accepte une clé en hexadécimal ou en texte de 32 octets', () => {
    process.env.SECRETS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    expect(decryptSecret(encryptSecret('hex-key'))).toBe('hex-key');

    process.env.SECRETS_ENCRYPTION_KEY = 'a'.repeat(32);
    expect(decryptSecret(encryptSecret('raw-key'))).toBe('raw-key');
  });

  it('rejette une clé de mauvaise taille', () => {
    process.env.SECRETS_ENCRYPTION_KEY = 'trop-court';
    expect(() => isEncryptionEnabled()).toThrow(/invalide/);
  });
});
