// Authentification LDAP / Active Directory — même patron que le projet GESTION_ACCESS :
// bind en userPrincipalName (UPN) « username@domaine » (ou style NTLM « domaine\username » via
// LDAP_BIND_FORMAT). Utilisé comme fallback après l'authentification locale.
//
// IMPORTANT — retrouver le BON compte IA Hub :
// Le suffixe UPN d'un compte AD est souvent DIFFÉRENT du domaine mail (ex. email
// steven.yapo@prosuma.ci mais UPN styapo@prosuma.lan). Une fois le bind validé, on RELIT
// l'entrée AD de l'utilisateur pour récupérer son vrai champ « mail » (comme le fait la
// synchro annuaire ldapDirectory.js). C'est cette adresse réelle qui permet de tomber
// EXACTEMENT sur le compte déjà créé/paramétré dans IA Hub — et de préserver son rôle
// (SUPERADMIN, ADMIN…). Sans cela, le login tenterait « username@domaine » et créerait
// un doublon REQUESTER qui ferait perdre le rôle.
const { Client } = require('ldapts');
const { logger } = require('../utils/logger');

const LDAP_ENABLED = process.env.LDAP_ENABLED === 'true';
const LDAP_URL = process.env.LDAP_URL || 'ldap://10.0.70.1';
const LDAP_EMAIL_DOMAIN = process.env.LDAP_EMAIL_DOMAIN || 'prosuma.ci';
const LDAP_BIND_DOMAIN = process.env.LDAP_BIND_DOMAIN?.trim() || LDAP_EMAIL_DOMAIN;
const LDAP_BIND_FORMAT = process.env.LDAP_BIND_FORMAT || '{username}@{domain}';
// Base de recherche pour relire « mail » / « displayName » après le bind — même base que la
// synchro annuaire (ldapDirectory.js) pour retomber exactement sur le compte existant.
const LDAP_BASE_DN = process.env.LDAP_BASE_DN || 'OU=prosuma,DC=prosuma,DC=lan';
const LDAP_ADMIN_USERNAMES = (process.env.LDAP_ADMIN_USERNAMES || '')
  .split(',')
  .map((u) => u.trim().toLowerCase())
  .filter(Boolean);

// Accès insensible à la casse aux attributs LDAP (l'AD renvoie une casse variable).
function attr(entry, name) {
  const lower = name.toLowerCase();
  const key = Object.keys(entry).find((k) => k.toLowerCase() === lower);
  return key ? entry[key] : undefined;
}

// Échappe les caractères spéciaux d'un filtre LDAP.
function ldapEscape(v) {
  return String(v).replace(/([\\()*\x00])/g, '\\$1');
}

// Construit l'objet utilisateur depuis l'entrée AD lue après le bind.
function resolveLdapUser(entry, username) {
  const rawMail = typeof attr(entry, 'mail') === 'string' ? attr(entry, 'mail').trim() : '';
  const email = rawMail.includes('@') ? rawMail.toLowerCase() : fallbackEmail(username);
const display = attr(entry, 'displayName') || attr(entry, 'cn') || username;
  return {
    username: username.trim(),
    email,
    fullName: display.toString().trim(),
  };
}
function isLdapEnabled() {
  return LDAP_ENABLED;
}

function isLdapAdminUsername(username) {
  return LDAP_ADMIN_USERNAMES.includes(username.trim().toLowerCase());
}

// Email « prosuma.ci » : solution de repli si l'AD n'expose pas de champ « mail ».
const ldapEmailFor = (username) => `${username.trim().toLowerCase()}@${LDAP_EMAIL_DOMAIN}`;
const fallbackEmail = ldapEmailFor;

// Suffixes UPN candidats (sans doublon) à essayer pour le bind.
function candidateBindDns(username) {
  const u = username.trim();
  const domains = [];
  const add = (d) => { if (d && !domains.includes(d)) domains.push(d); };
  add(LDAP_BIND_DOMAIN);
  add(LDAP_EMAIL_DOMAIN);
  return domains.map((domain) =>
    LDAP_BIND_FORMAT
      .replace('{username}', u)
      .replace('{domain}', domain),
  );
}

// Tente l'authentification LDAP/Active Directory sur chaque domaine candidat.
async function authenticateLdap(username, password) {
  const client = new Client({ url: LDAP_URL, connectTimeout: 5000, timeout: 10000 });
  const candidates = candidateBindDns(username);
  let lastError = null;

  logger.info(`[ldapAuth] Tentative de connexion AD sur ${LDAP_URL} — ${candidates.length} suffixe(s) à tester`);

  try {
    // DC durcis (Microsoft 2022+, erreur 0x8) : bind via StartTLS, comme ldapDirectory.js.
    if (!/^ldaps:/i.test(LDAP_URL) && process.env.LDAP_STARTTLS !== 'false') {
      logger.info(`[ldapAuth] Montée en StartTLS sur ${LDAP_URL} (LDAP_STARTTLS != false)`);
      await client.startTLS({ rejectUnauthorized: process.env.LDAP_TLS_STRICT === 'true' });
    }

    for (const bindDn of candidates) {
      try {
        await client.bind(bindDn, password);
        logger.info(`[ldapAuth] Bind AD réussi avec ${bindDn}`);

        // Relit l'entrée AD de l'utilisateur pour retrouver son vrai « mail » (et son nom).
        let ldapUser = null;
        try {
          const { searchEntries } = await client.search(LDAP_BASE_DN, {
            scope: 'sub',
            filter: `(&(objectClass=user)(sAMAccountName=${ldapEscape(username.trim())}))`,
            attributes: ['sAMAccountName', 'mail', 'displayName', 'cn', 'userPrincipalName'],
          });
          const found = searchEntries.find((e) => attr(e, 'sAMAccountName'));
          if (found) {
            ldapUser = resolveLdapUser(found, username);
            logger.info(
              `[ldapAuth] Entrée AD résolue pour ${username.trim()} → email=${ldapUser.email} ` +
                `(mail='${attr(found, 'mail') || ''}')`,
            );
          } else {
            logger.warn(`[ldapAuth] Aucune entrée AD détaillée pour ${username.trim()} — repli sur ${ldapEmailFor(username)}`);
          }
        } catch (searchErr) {
          logger.warn(`[ldapAuth] Recherche AD indisponible (${searchErr?.message}) — repli sur ${ldapEmailFor(username)}`);
        }

        return ldapUser || {
          username: username.trim(),
          email: ldapEmailFor(username),
          fullName: username.trim(),
        };
      } catch (error) {
        lastError = error;
        logger.warn(
          `[ldapAuth] Bind refusé pour ${bindDn}: code=${error?.code ?? error?.name ?? '?'} ` +
            `message=${error?.message}`,
        );
      }
    }

    // Toutes les tentatives ont échoué : remonte le dernier code pour le diagnostic.
    logger.error(
      `[ldapAuth] Aucun bind AD n'a abouti sur ${LDAP_URL} pour ${username.trim()} — ` +
        `dernier code=${lastError?.code ?? lastError?.name ?? '?'} message=${lastError?.message}`,
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
      `email domain: ${LDAP_EMAIL_DOMAIN}, format: ${LDAP_BIND_FORMAT}, base: ${LDAP_BASE_DN}, ` +
      `admins: [${LDAP_ADMIN_USERNAMES.join(', ')}]`,
  );
} else {
  logger.warn('[ldapAuth] LDAP désactivé (LDAP_ENABLED != "true") — la connexion AD est ignorée');
}

module.exports = { isLdapEnabled, isLdapAdminUsername, ldapEmailFor, authenticateLdap };
