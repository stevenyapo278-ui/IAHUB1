// Authentification LDAP / Active Directory — même patron que le projet GESTION_ACCESS :
// bind en userPrincipalName (UPN) « username@domaine » (ou style NTLM « domaine\\username » via
// LDAP_BIND_FORMAT). Utilisé comme fallback après l'authentification locale.
//
// Distinction obligatoire entre deux « domaines » :
//   - LDAP_EMAIL_DOMAIN  : suffixe email des comptes (ex. prosuma.ci) — sert à fabriquer
//                          l'email du compte IA Hub (ldapEmailFor).
//   - LDAP_BIND_DOMAIN   : suffixe UPN utilisé au moment du bind (ex. prosuma.lan). Valeur par
//                          défaut = LDAP_EMAIL_DOMAIN si non précisé, mais sur de nombreuses AD
//                          le suffixe UPN diffère du domaine mail — si le bind échoue avec une
//                          erreur « utilisateur introuvable » (invalidCredentials 0x31),
//                          vérifier LDAP_BIND_DOMAIN.
const { Client } = require('ldapts');
const { logger } = require('../utils/logger');

const LDAP_ENABLED = process.env.LDAP_ENABLED === 'true';
const LDAP_URL = process.env.LDAP_URL || 'ldap://10.0.70.1';
const LDAP_EMAIL_DOMAIN = process.env.LDAP_EMAIL_DOMAIN || 'prosuma.ci';
const LDAP_BIND_DOMAIN = process.env.LDAP_BIND_DOMAIN?.trim() || LDAP_EMAIL_DOMAIN;
const LDAP_BIND_FORMAT = process.env.LDAP_BIND_FORMAT || '{username}@{domain}';
const LDAP_ADMIN_USERNAMES = (process.env.LDAP_ADMIN_USERNAMES || '')
  .split(',')
  .map((u) => u.trim().toLowerCase())
  .filter(Boolean);

function isLdapEnabled() {
  return LDAP_ENABLED;
}

function isLdapAdminUsername(username) {
  return LDAP_ADMIN_USERNAMES.includes(username.trim().toLowerCase());
}

// Email « prosuma.ci » d'un compte : toujours basé sur LDAP_EMAIL_DOMAIN (suffixe mail),
// indépendant du suffixe UPN utilisé pour le bind (LDAP_BIND_DOMAIN).
function ldapEmailFor(username) {
  return `${username.trim().toLowerCase()}@${LDAP_EMAIL_DOMAIN}`;
}

function buildBindDn(username) {
  return LDAP_BIND_FORMAT
    .replace('{username}', username)
    .replace('{domain}', LDAP_BIND_DOMAIN);
}

// Tente l'authentification LDAP/Active Directory. Retourne null si refusée.
async function authenticateLdap(username, password) {
  const client = new Client({ url: LDAP_URL, connectTimeout: 5000, timeout: 10000 });
  const bindDn = buildBindDn(username.trim());
  logger.info(`[ldapAuth] Tentative de connexion AD sur ${LDAP_URL} avec ${bindDn}`);

  try {
    // Les DC durcis (Microsoft 2022+, erreur 0x8 « requires binds to turn on
    // integrity checking ») refusent les binds en clair : on monte en TLS sur la
    // connexion 389 via StartTLS, comme dans ldapDirectory.js (synchro annuaire).
    // Inutile si l'URL est déjà ldaps://. LDAP_STARTTLS=false pour désactiver,
    // LDAP_TLS_STRICT=true pour exiger un certificat signé par une CA de confiance
    // (défaut : tolérant, CA interne AD).
    if (!/^ldaps:/i.test(LDAP_URL) && process.env.LDAP_STARTTLS !== 'false') {
      logger.info(`[ldapAuth] Montée en StartTLS sur ${LDAP_URL} (LDAP_STARTTLS != false)`);
      await client.startTLS({ rejectUnauthorized: process.env.LDAP_TLS_STRICT === 'true' });
    }
    await client.bind(bindDn, password);
    return { username: username.trim(), email: ldapEmailFor(username) };
  } catch (error) {
    // Journalisé via le logger winston (stdout + error.log) pour que le code/name LDAP
    // soient visibles : 0x31 invalidCredentials = mot de passe ou UPN invalides (vérifier
    // LDAP_BIND_DOMAIN) ; erreur TLS/certificat ; timeout = réseau/port.
    logger.error(
      `[ldapAuth] Échec de connexion AD (${bindDn} sur ${LDAP_URL}): ` +
        `code=${error?.code ?? error?.name ?? '?'} message=${error?.message}`,
    );
    return null;
  } finally {
    try {
      await client.unbind();
    } catch {
      // socket déjà fermée — sans importance
    }
  }
}

if (isLdapEnabled()) {
  logger.info(
    `[ldapAuth] LDAP ACTIVÉ — URL: ${LDAP_URL}, bind domain: ${LDAP_BIND_DOMAIN}, ` +
      `email domain: ${LDAP_EMAIL_DOMAIN}, format: ${LDAP_BIND_FORMAT}, admins: [${LDAP_ADMIN_USERNAMES.join(', ')}]`,
  );
} else {
  logger.warn('[ldapAuth] LDAP désactivé (LDAP_ENABLED != "true") — la connexion AD est ignorée');
}

module.exports = { isLdapEnabled, isLdapAdminUsername, ldapEmailFor, authenticateLdap };
