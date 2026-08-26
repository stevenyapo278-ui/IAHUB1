// Authentification LDAP / Active Directory — même patron que le projet GESTION_ACCESS :
// bind en userPrincipalName (UPN) « username@domaine » (ou style NTLM « domaine\username » via
// LDAP_BIND_FORMAT). Utilisé comme fallback après l'authentification locale.
const { Client } = require('ldapts');

const LDAP_ENABLED = process.env.LDAP_ENABLED === 'true';
const LDAP_URL = process.env.LDAP_URL || 'ldap://10.0.70.1';
const LDAP_EMAIL_DOMAIN = process.env.LDAP_EMAIL_DOMAIN || 'prosuma.ci';
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

function ldapEmailFor(username) {
  return `${username.trim().toLowerCase()}@${LDAP_EMAIL_DOMAIN}`;
}

function buildBindDn(username) {
  return LDAP_BIND_FORMAT
    .replace('{username}', username)
    .replace('{domain}', LDAP_EMAIL_DOMAIN);
}

// Tente l'authentification LDAP/Active Directory. Retourne null si refusée.
async function authenticateLdap(username, password) {
  const client = new Client({ url: LDAP_URL, connectTimeout: 5000, timeout: 10000 });
  const bindDn = buildBindDn(username.trim());
  console.log(`[ldapAuth] Tentative de connexion LDAP sur ${LDAP_URL} avec ${bindDn}`);

  try {
    // Les DC durcis (Microsoft 2022+, erreur 0x8 « requires binds to turn on
    // integrity checking ») refusent les binds en clair : on monte en TLS sur la
    // connexion 389 via StartTLS, comme dans ldapDirectory.js (synchro annuaire).
    // Inutile si l'URL est déjà ldaps://. LDAP_STARTTLS=false pour désactiver,
    // LDAP_TLS_STRICT=true pour exiger un certificat signé par une CA de confiance
    // (défaut : tolérant, CA interne AD).
    if (!/^ldaps:/i.test(LDAP_URL) && process.env.LDAP_STARTTLS !== 'false') {
      console.log(`[ldapAuth] Montée en StartTLS sur ${LDAP_URL} (LDAP_STARTTLS != false)`);
      await client.startTLS({ rejectUnauthorized: process.env.LDAP_TLS_STRICT === 'true' });
    }
    await client.bind(bindDn, password);
    return { username: username.trim(), email: ldapEmailFor(username) };
  } catch (error) {
    console.error(`[ldapAuth] Échec du bind LDAP (${bindDn} sur ${LDAP_URL}):`, error.message);
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
  console.log(`[ldapAuth] LDAP ACTIVÉ — URL: ${LDAP_URL}, domaine: ${LDAP_EMAIL_DOMAIN}, format bind: ${LDAP_BIND_FORMAT}, admins: [${LDAP_ADMIN_USERNAMES.join(', ')}]`);
} else {
  console.log('[ldapAuth] LDAP désactivé (LDAP_ENABLED != "true") — la connexion AD est ignorée');
}

module.exports = { isLdapEnabled, isLdapAdminUsername, ldapEmailFor, authenticateLdap };