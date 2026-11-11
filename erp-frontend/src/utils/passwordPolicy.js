// Politique de mot de passe côté client — doit rester alignée avec
// erp-backend/src/utils/security.js (validatePasswordStrength).
// Le backend reste la source de vérité : ceci sert uniquement à un retour immédiat.
export const MIN_PASSWORD_LENGTH = 12;

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

export function validatePassword(password) {
  const value = String(password ?? '');

  if (value.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.` };
  }
  if (!/[a-z]/.test(value)) return { valid: false, error: 'Le mot de passe doit contenir au moins une minuscule.' };
  if (!/[A-Z]/.test(value)) return { valid: false, error: 'Le mot de passe doit contenir au moins une majuscule.' };
  if (!/\d/.test(value)) return { valid: false, error: 'Le mot de passe doit contenir au moins un chiffre.' };
  if (!/[^A-Za-z0-9]/.test(value)) return { valid: false, error: 'Le mot de passe doit contenir au moins un caractère spécial.' };

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
