// Synchro périodique de l'annuaire Active Directory vers IA Hub.
// Remplace la « vue LDAP » que la hotline utilisait dans GLPI : chaque exécution
// reflète l'AD dans la base locale — création des nouveaux comptes, mise à jour
// du nom complet, activation/désactivation selon userAccountControl.
//
// Différences volontaires avec le JIT du login (auth.routes.js) :
// - n'utilise JAMAIS le bind d'un utilisateur final : compte de service dédié ;
// - ne touche qu'aux comptes authProvider='ldap' : les comptes locaux et les
//   rôles attribués manuellement restent intouchables ;
// - crée uniquement des REQUESTER : les rôles restent gérés côté IA Hub.
//
// Configuration (.env) — valeurs par défaut issues de la conf LDAP de GLPI :
//   LDAP_DIRECTORY_URL   ldap://prosuma.lan:389
//   LDAP_BIND_DN         CN=glpi,OU=informatique,OU=centrale,OU=prosuma,DC=prosuma,DC=lan
//   LDAP_BIND_PASSWORD   (mot de passe du compte de service)
//   LDAP_BASE_DN         OU=prosuma,DC=prosuma,DC=lan
//   LDAP_USER_FILTER     (&(objectClass=user)(objectCategory=person))
//                        (sans l'exclusion userAccountControl : on veut aussi voir
//                         les comptes désactivés pour pouvoir les désactiver ici)
//   LDAP_EMAIL_DOMAIN    prosuma.ci  (déjà utilisé par ldapAuth)
const { Client } = require('ldapts');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../prismaClient');
const { logger } = require('../utils/logger');

const LDAP_DIRECTORY_URL = process.env.LDAP_DIRECTORY_URL || 'ldap://prosuma.lan:389';
const LDAP_BIND_DN = process.env.LDAP_BIND_DN || 'CN=glpi,OU=informatique,OU=centrale,OU=prosuma,DC=prosuma,DC=lan';
const LDAP_BIND_PASSWORD = process.env.LDAP_BIND_PASSWORD || '';
const LDAP_BASE_DN = process.env.LDAP_BASE_DN || 'OU=prosuma,DC=prosuma,DC=lan';
const LDAP_USER_FILTER = process.env.LDAP_USER_FILTER || '(&(objectClass=user)(objectCategory=person))';
const LDAP_EMAIL_DOMAIN = process.env.LDAP_EMAIL_DOMAIN || 'prosuma.ci';

// Bit 2 de userAccountControl = ACCOUNTDISABLE (norme Microsoft)
function isAdAccountDisabled(userAccountControl) {
  const flags = parseInt(userAccountControl, 10);
  if (Number.isNaN(flags)) return false;
  return (flags & 2) !== 0;
}

// Le compte de service (ex. « glpi » extrait du BindDN) est un compte machine :
// on ne doit jamais créer de compte IA Hub exploitable avec son identifiant.
const SERVICE_ACCOUNT_USERNAME = (LDAP_BIND_DN.match(/^CN=([^,]+)/i)?.[1] || '').trim().toLowerCase();

function isServiceAccount(username) {
  const u = (username || '').trim().toLowerCase();
  return Boolean(u) && u === SERVICE_ACCOUNT_USERNAME;
}

function isLdapSyncConfigured() {
  return Boolean(LDAP_BIND_PASSWORD && LDAP_BASE_DN);
}

async function syncLdapDirectory() {
  if (!isLdapSyncConfigured()) {
    logger.warn('[ldapDirectory] Synchro annuaire ignorée : LDAP_BIND_PASSWORD/LDAP_BASE_DN non configurés');
    return null;
  }

  const client = new Client({ url: LDAP_DIRECTORY_URL, connectTimeout: 5000, timeout: 30000 });
  const stats = { adTotal: 0, created: 0, updated: 0, reactivated: 0, deactivated: 0 };

  try {
    await client.bind(LDAP_BIND_DN, LDAP_BIND_PASSWORD);
    const { searchEntries } = await client.search(LDAP_BASE_DN, {
      scope: 'sub',
      filter: LDAP_USER_FILTER,
      attributes: ['sAMAccountName', 'displayName', 'cn', 'mail', 'userAccountControl'],
      paged: { pageSize: 500 },
    });

    // Map de l'AD : email normalisé → { fullName, enabled }
    const directory = new Map();
    for (const entry of searchEntries) {
      const username = entry.sAMAccountName;
      if (!username || isServiceAccount(username)) continue;
      const rawMail = typeof entry.mail === 'string' ? entry.mail.trim() : '';
      const email = (rawMail.includes('@') ? rawMail.toLowerCase() : `${username.toLowerCase()}@${LDAP_EMAIL_DOMAIN}`);
      directory.set(email, {
        fullName: (entry.displayName || entry.cn || username).trim(),
        enabled: !isAdAccountDisabled(entry.userAccountControl),
      });
    }
    stats.adTotal = directory.size;

    // Tous les comptes locaux, quel que soit leur provider : des comptes créés à la main
    // ou via l'ancien import GLPI (authProvider='local') peuvent porter le même email qu'un
    // compte AD — il faut les ADOPTER plutôt que de créer un doublon (contrainte unique email).
    const localUsers = await prisma.user.findMany({
      select: { id: true, email: true, fullName: true, isActive: true, authProvider: true },
    });
    const localsByEmail = new Map(localUsers.map((u) => [u.email.toLowerCase(), u]));

    // Passe 1 : chaque entrée AD → création ou mise à jour du compte correspondant
    for (const [email, adEntry] of directory) {
      const existing = localsByEmail.get(email);

      if (!existing) {
        await prisma.user.create({
          data: {
            email,
            // Mot de passe aléatoire : connexion locale impossible, l'utilisateur
            // passe par son mot de passe AD (fallback LDAP du login).
            passwordHash: bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10),
            fullName: adEntry.fullName,
            role: 'REQUESTER',
            isActive: adEntry.enabled,
            mustChangePassword: false,
            authProvider: 'ldap',
          },
        });
        stats.created += 1;
        logger.info(`[ldapDirectory] ${email} créé depuis l'AD (${adEntry.fullName})`);
        continue;
      }

      // Compte existant (local ou déjà ldap) → rattaché au cycle de vie de l'AD
      const changes = {};
      if (adEntry.fullName && existing.fullName !== adEntry.fullName) changes.fullName = adEntry.fullName;
      const shouldBeActive = adEntry.enabled;
      if (existing.isActive !== shouldBeActive) changes.isActive = shouldBeActive;
      if (existing.authProvider !== 'ldap') changes.authProvider = 'ldap';

      if (Object.keys(changes).length > 0) {
        await prisma.user.update({ where: { id: existing.id }, data: changes });
        if (changes.isActive === true) stats.reactivated += 1;
        else if (changes.isActive === false) stats.deactivated += 1;
        else stats.updated += 1;
      }
    }

    // Passe 2 : comptes gérés par l'AD mais absents de l'annuaire → désactivés
    // (tickets et historique conservés). Les comptes locaux ne sont jamais touchés.
    for (const user of localLdapOnlyUsers(localUsers, directory)) {
      if (user.isActive) {
        await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
        stats.deactivated += 1;
        logger.info(`[ldapDirectory] ${user.email} absent de l'AD → désactivé`);
      }
    }

    logger.info(`[ldapDirectory] Synchro terminée : ${stats.adTotal} entrées AD, ${stats.created} créées, ${stats.updated} mises à jour, ${stats.reactivated} réactivées, ${stats.deactivated} désactivées`);
    return stats;
  } finally {
    try { await client.unbind(); } catch { /* socket déjà fermée */ }
  }
}

// Comptes dont authProvider='ldap' et dont l'email ne figure plus dans l'annuaire
function localLdapOnlyUsers(localUsers, directory) {
  return localUsers.filter(
    (u) => u.authProvider === 'ldap' && !directory.has(u.email.toLowerCase())
  );
}

module.exports = { isLdapSyncConfigured, syncLdapDirectory };
