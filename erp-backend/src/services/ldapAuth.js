// Authentification LDAP / Active Directory — même patron que le projet GESTION_ACCESS :
// bind en userPrincipalName (UPN) « username@domaine » (ou style NTLM « domaine\\username » via
// LDAP_BIND_FORMAT). Utilisé comme fallback après l'authentification locale.
//
// Le suffixe UPN d'un compte AD est souvent DIFFÉRENT du domaine mail (ex. email
// styapo@prosuma.ci mais UPN styapo@prosuma.lan). On ne devine donc jamais un seul
// suffixe : on essaie, dans l'ordre, tous les « domaines » candidats :
//   - LDAP_BIND_DOMAIN  (suffixe UPN du bind, défaut : prosuma.lan)
//   - LDAP_EMAIL_DOMAIN (suffixe email, défaut : prosuma.ci)
// Le premier bind qui aboutit valide la connexion. En cas d'échec, on journalise le
// code AD exact (0x31 invalidCredentials = mauvais mot de passe OU mauvais suffixe UPN).
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

// Email « prosuma.ci » d'un compte : toujours basé sur LDAP_EMAIL_DOMAIN.
function ldapEmailFor(username) {
  return `${username.trim().toLowerCase()}@${LDAP_EMAIL_DOMAIN}`;
}

// Liste (sans doublon) des suffixes UPN à essayer au moment du bind.
function candidateBindDns(username) {
  const u = username.trim();
  const domains = [];
  const add = (d) => { if (d && !domains.includes(d)) domains.push(d); };
  add(LDAP_BIND_DOMAIN);
  add(LDAP_EMAIL_DOMAIN);
  // Format NTLM (domaine\utilisateur) : le domaine est placé avant le username.
  return domains.map((domain) =>
    LDAP_BIND_FORMAT
      .replace('{username}', u)
      .replace('{domain}', domain),
  );
}

// Tente l'authentification LDAP/Active Directory sur chaque domaine candidat.
// Retourne null si toutes les tentatives échouent.
async function authenticateLdap(username, password) {
  const client = new Client({ url: LDAP_URL, connectTimeout: 5000, timeout: 10000 });
  const candidates = candidateBindDns(username);
  let lastError = null;

  logger.info(`[ldapAuth] Tentative de connexion AD sur ${LDAP_URL} — ${candidates.length} suffixe(s) à tester`);

  try {
    // DC durcis (Microsoft 2022+, erreur 0x8) : bind via StartTLS, comme ldapDirectory.js.
    // LDAP_STARTTLS=false pour désactiver ; LDAP_TLS_STRICT=true = certificat CA exigé.
    if (!/^ldaps:/i.test(LDAP_URL) && process.env.LDAP_STARTTLS !== 'false') {
      logger.info(`[ldapAuth] Montée en StartTLS sur ${LDAP_URL} (LDAP_STARTTLS != false)`);
      await client.startTLS({ rejectUnauthorized: process.env.LDAP_TLS_STRICT === 'true' });
    }

    for (const bindDn of candidates) {
      try {
        await client.bind(bindDn, password);
        logger.info(`[ldapAuth] Bind AD réussi avec ${bindDn}`);
        return { username: username.trim(), email: ldapEmailFor(username) };
      } catch (error) {
        lastError = error;
        logger.warn(
          `[ldapAuth] Bind refusé pour ${bindDn}: code=${error?.code ?? error?.name ?? '?'} ` +
            `message=${error?.message}`,
        );
      }
    }

    // Toutes les tentatives ont échoué : remonte le dernier code AD pour le diagnostic.
    // 0x31/invalidCredentials = mauvais mot de passe OU UPN inconnue — à creuser si
    // plusieurs suffixes UPN coexistent dans l'AD.
    logger.error(
      `[ldapAuth] Aucun bind AD n'a abouti sur ${LDAP_URL} pour ${username.trim()} — ` +
        `dernier code=${lastError?.code ?? lastError?.name ?? '?'} ` +
        `message=${lastError?.message}`,
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
