// ── Module « Création de comptes applicatifs » ───────────────────────────────
// Objectif métier : quand un technicien a créé un ou plusieurs comptes sur une
// application (Sage, M365, Odoo…), il doit déclarer ces comptes avant de pouvoir
// marquer le ticket SOLVED. La déclaration est conservée en base (source de vérité)
// puis poussée vers Budibase qui n'est qu'un miroir.
//
// Règles de conception :
//   • Jamais de mot de passe stocké (ni en base, ni dans Budibase) — uniquement le
//     login, l'email, le profil et le canal de transmission du secret.
//   • L'écriture locale ne dépend jamais de la disponibilité de Budibase : en cas
//     d'échec, l'enregistrement reste PENDING/FAILED et un scheduler rejoue.
//   • Un seul enregistrement par ticket (upsert par ticketId) et une clé
//     d'idempotence déterministe pour ne jamais dupliquer une ligne Budibase.
const crypto = require('crypto');
const prisma = require('../prismaClient');
const { getSystemSettings } = require('./systemSettings');
const { getBreaker } = require('../utils/circuitBreaker');
const { fetchWithTimeout } = require('../utils/fetchWithTimeout');
const { auditLog } = require('./auditLogService');
const { logger } = require('../utils/logger');

const BUDIBASE_SERVICE = 'budibase';
const BUDIBASE_TIMEOUT_MS = 10000;
const MAX_ACCOUNTS = 50;
const MAX_QUANTITY_PER_ACCOUNT = 500;
const MAX_SYNC_ATTEMPTS = 20;

// Toute clé ressemblant à un secret est refusée : le module ne doit jamais devenir
// un stockage de mots de passe parallèle.
const FORBIDDEN_KEYS = new Set([
  'password', 'passwords', 'motdepasse', 'mot_de_passe', 'mot-de-passe',
  'pwd', 'secret', 'secrets', 'token', 'apikey', 'api_key',
]);

class ProvisioningError extends Error {
  constructor(message, { statusCode = 400, code = 'ACCOUNT_PROVISIONING_INVALID', details = null } = {}) {
    super(message);
    this.name = 'ProvisioningError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function assertNoSecret(value, path = 'accounts') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = String(key).toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (FORBIDDEN_KEYS.has(normalizedKey)) {
      throw new ProvisioningError(
        `Le champ « ${path}.${key} » est interdit : aucun mot de passe ou secret ne doit être enregistré.`,
        { code: 'ACCOUNT_PROVISIONING_SECRET_FORBIDDEN' }
      );
    }
    if (child && typeof child === 'object') assertNoSecret(child, `${path}.${key}`);
  }
}

function cleanString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function normalizeEmail(value) {
  const email = cleanString(value, 254);
  if (!email) return '';
  // Validation volontairement souple : le but est d'éviter les fautes évidentes,
  // pas de rejeter une adresse interne exotique.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ProvisioningError(`Adresse email invalide : ${email}`);
  }
  return email;
}

function findApplication(raw, catalog) {
  const id = Number(raw?.applicationId);
  if (Number.isInteger(id) && id > 0) {
    const byId = catalog.find((a) => a.id === id);
    if (!byId) throw new ProvisioningError(`Application inconnue (id ${id}) — choisissez une application du catalogue.`);
    return byId;
  }

  const name = cleanString(raw?.applicationName || raw?.application, 120).toLowerCase();
  if (!name) return null;

  const byName = catalog.find((a) => a.name.toLowerCase() === name);
  if (byName) return byName;

  // Alias : uniquement en correspondance exacte (pas de fuzzy) pour éviter les
  // faux positifs type « Sage » vs « Sage Paie ».
  const byAlias = catalog.find((a) =>
    (Array.isArray(a.aliases) ? a.aliases : []).some((alias) => String(alias).trim().toLowerCase() === name)
  );
  return byAlias || null;
}

// ── Qualité du catalogue ────────────────────────────────────────────────────
// Normalisation commune (accents/casse/espaces) pour comparer alias et valeurs.
function normalizeValue(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Détecte les alias problématiques d'une application :
 *   • `duplicate` : alias déjà utilisé par une autre application → ambiguïté totale ;
 *   • `contained` : alias contenu dans le nom/alias d'une autre application → risque
 *     de double détection (cas réel « sage » ⊂ « sage paie »).
 * Fonction pure, testée unitairement.
 */
function findAliasConflicts({ name, aliases } = {}, otherApps = [], excludeId = null) {
  const ownName = normalizeValue(name);
  const ownAliases = [...new Set((Array.isArray(aliases) ? aliases : []).map(normalizeValue).filter(Boolean))];
  const conflicts = [];

  for (const alias of ownAliases) {
    if (alias === ownName) {
      conflicts.push({ type: 'redundant', alias, message: `L’alias « ${alias} » est identique au nom de l’application.` });
    }
  }

  for (const other of otherApps) {
    if (!other || (excludeId != null && Number(other.id) === Number(excludeId))) continue;
    const otherName = normalizeValue(other.name);
    const otherAliases = (Array.isArray(other.aliases) ? other.aliases : []).map(normalizeValue).filter(Boolean);

    for (const alias of ownAliases) {
      const duplicated = alias === otherName || otherAliases.includes(alias);
      if (duplicated) {
        conflicts.push({
          type: 'duplicate',
          alias,
          application: other.name,
          message: `L’alias « ${alias} » est déjà utilisé par « ${other.name} ».`,
        });
        continue;
      }
      const contained = otherName.includes(alias) || otherAliases.some((candidate) => candidate.includes(alias));
      if (contained) {
        conflicts.push({
          type: 'contained',
          alias,
          application: other.name,
          message: `L’alias « ${alias} » est contenu dans « ${other.name} » : risque de double détection.`,
        });
      }
    }
  }

  return conflicts;
}

// Champs métier reconnus sur un compte : tout autre champ d'un schéma `fields`
// est ignoré (jamais stocké), pour éviter la dérive du modèle de données.
const ACCOUNT_FIELD_KEYS = new Set(['login', 'email', 'profile', 'note', 'passwordDeliveryChannel', 'quantity', 'type', 'rights']);

// Nature de l'opération déclarée sur une ligne :
//   • CREATION : un compte a été créé (ou activé) ;
//   • DROITS   : les droits/profils d'un compte EXISTANT ont été modifiés.
// Les deux sont tracés, mais seuls les CREATION entrent dans la détection de doublons.
const ACCOUNT_OPERATIONS = ['CREATION', 'DROITS'];

function resolveCatalogFields(application) {
  const raw = application?.fields;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.fields)) return raw.fields;
  return [];
}

/**
 * Applique le schéma `ApplicationCatalog.fields` de l'application choisie :
 * champs obligatoires et listes de valeurs fermées (ex. profils Sage X3).
 * C'est ce qui empêche « Comptable », « comptable » et « Compta » de coexister.
 */
function assertFieldsCompliance(account, application, index) {
  const fields = resolveCatalogFields(application);
  for (const field of fields) {
    if (!field || typeof field !== 'object') continue;
    const key = String(field.key || '').trim();
    if (!ACCOUNT_FIELD_KEYS.has(key)) continue;

    const value = account[key];
    const isEmpty = value === '' || value === undefined || value === null;
    const label = field.label || key;
    // Une liste fermée n'a de sens que si l'on doit y choisir une valeur : on la
    // considère donc comme obligatoire, sauf `required: false` explicite.
    const isRequired = field.required === true || (
      field.required !== false &&
      field.type === 'select' &&
      Array.isArray(field.options) &&
      field.options.length > 0
    );

    // Mise à jour de droits : le profil peut être remplacé par le droit en texte
    // libre, sinon une liste fermée de profils forcerait un choix qui ne décrit
    // pas forcément ce qui a été accordé.
    const satisfiedByRights = key === 'profile'
      && account.operation === 'DROITS'
      && Boolean(account.rights);

    if (isRequired && isEmpty && !satisfiedByRights) {
      throw new ProvisioningError(
        `Ligne ${index + 1} : le champ « ${label} » est obligatoire pour ${application.name}.`,
        { code: 'ACCOUNT_PROVISIONING_FIELD_REQUIRED' }
      );
    }

    if (field.type === 'select' && Array.isArray(field.options) && field.options.length > 0 && !isEmpty) {
      const allowed = field.options.map((option) => String(option));
      const normalizedAllowed = allowed.map(normalizeValue);
      if (!normalizedAllowed.includes(normalizeValue(value))) {
        throw new ProvisioningError(
          `Ligne ${index + 1} : « ${value} » n’est pas un ${label.toLowerCase()} valide pour ${application.name}. Valeurs autorisées : ${allowed.join(', ')}.`,
          { code: 'ACCOUNT_PROVISIONING_FIELD_INVALID', details: { field: key, allowed } }
        );
      }
      // On stocke la valeur canonique du catalogue, pas la saisie libre.
      account[key] = allowed[normalizedAllowed.indexOf(normalizeValue(value))];
    }
  }
}

/** Refuse deux lignes qui désignent le même compte (même application + même identifiant/email). */
function assertNoDuplicateAccounts(accounts) {
  const seen = new Map();
  accounts.forEach((account, index) => {
    // L'identifiant peut être un login ou, à défaut, l'email (boîte partagée).
    const identifier = account.login || account.email;
    if (!identifier) return;
    // La création et la mise à jour de droits d'un même compte sont deux
    // opérations distinctes : elles peuvent légitimement coexister.
    const key = `${account.applicationId}|${account.operation}|${normalizeValue(identifier)}`;
    if (seen.has(key)) {
      const first = seen.get(key);
      throw new ProvisioningError(
        `Lignes ${first + 1} et ${index + 1} : le compte « ${identifier} » est déclaré deux fois sur ${account.applicationName}.`,
        { code: 'ACCOUNT_PROVISIONING_DUPLICATE_ACCOUNT' }
      );
    }
    seen.set(key, index);
  });
}

/**
 * Valide et normalise les comptes déclarés par le technicien.
 * @param {Array} rawAccounts
 * @param {Array} catalog applications actives
 */
function normalizeAccounts(rawAccounts, catalog) {
  if (!Array.isArray(rawAccounts) || rawAccounts.length === 0) {
    throw new ProvisioningError('Au moins un compte créé doit être déclaré.');
  }
  if (rawAccounts.length > MAX_ACCOUNTS) {
    throw new ProvisioningError(`Maximum ${MAX_ACCOUNTS} lignes de comptes par déclaration.`);
  }

  const accounts = rawAccounts.map((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      throw new ProvisioningError(`Ligne de compte ${index + 1} invalide.`);
    }
    assertNoSecret(raw, `accounts[${index}]`);

    const application = findApplication(raw, catalog);
    if (!application) {
      throw new ProvisioningError(
        `Ligne ${index + 1} : application manquante ou hors catalogue. Choisissez une application dans la liste.`,
        { code: 'ACCOUNT_PROVISIONING_UNKNOWN_APPLICATION' }
      );
    }

    const operation = cleanString(raw.operation, 20).toUpperCase() || 'CREATION';
    if (!ACCOUNT_OPERATIONS.includes(operation)) {
      throw new ProvisioningError(
        `Ligne ${index + 1} : opération invalide (${operation}). Valeurs autorisées : ${ACCOUNT_OPERATIONS.join(', ')}.`,
        { code: 'ACCOUNT_PROVISIONING_INVALID_OPERATION' }
      );
    }

    const quantityRaw = raw.quantity === undefined || raw.quantity === null || raw.quantity === ''
      ? 1
      : Number(raw.quantity);
    if (!Number.isInteger(quantityRaw) || quantityRaw < 1 || quantityRaw > MAX_QUANTITY_PER_ACCOUNT) {
      throw new ProvisioningError(
        `Ligne ${index + 1} : la quantité doit être un entier entre 1 et ${MAX_QUANTITY_PER_ACCOUNT}.`
      );
    }
    // Une modification de droits porte sur un compte nommé : la notion de quantité
    // n'a pas de sens, sinon le décompte ne correspondrait à aucun identifiant.
    if (operation === 'DROITS' && quantityRaw !== 1) {
      throw new ProvisioningError(
        `Ligne ${index + 1} : une mise à jour de droits concerne un compte précis (quantité 1). Ajoutez une ligne par compte.`,
        { code: 'ACCOUNT_PROVISIONING_RIGHTS_QUANTITY' }
      );
    }

    const type = cleanString(raw.type, 40).toUpperCase() || 'NOMINAL';
    if (!['NOMINAL', 'ADMIN', 'SERVICE', 'PARTAGE', 'AUTRE'].includes(type)) {
      throw new ProvisioningError(`Ligne ${index + 1} : type de compte invalide (${type}).`);
    }

    const account = {
      applicationId: application.id,
      applicationName: application.name,
      operation,
      login: cleanString(raw.login, 120),
      email: normalizeEmail(raw.email),
      profile: cleanString(raw.profile, 120),
      // Droit précis accordé lors d'une mise à jour (ex. « accès module Paie »).
      rights: cleanString(raw.rights, 200),
      type,
      quantity: quantityRaw,
      // Canal de transmission du mot de passe : on trace le « comment », jamais le secret.
      passwordDeliveryChannel: cleanString(raw.passwordDeliveryChannel, 80),
      note: cleanString(raw.note, 500),
    };

    // Un compte non identifiable ne vaut rien pour l'audit : on exige au moins
    // l'identifiant de connexion ou l'adresse email (une boîte partagée peut
    // n'avoir qu'un email, d'où le « ou » plutôt qu'un login strictement requis).
    // Pour une mise à jour de droits, c'est le compte CIBLE qui est exigé.
    if (!account.login && !account.email) {
      throw new ProvisioningError(
        `Ligne ${index + 1} : renseignez au moins l’identifiant de connexion ou l’email du ${operation === 'DROITS' ? 'compte cible' : 'compte'}.`,
        { code: 'ACCOUNT_PROVISIONING_IDENTIFIER_REQUIRED', details: { line: index + 1, field: 'login' } }
      );
    }

    assertFieldsCompliance(account, application, index);
    return account;
  });

  assertNoDuplicateAccounts(accounts);

  const applicationsMap = new Map();
  for (const account of accounts) {
    applicationsMap.set(account.applicationId, { id: account.applicationId, name: account.applicationName });
  }

  return {
    accounts,
    applications: Array.from(applicationsMap.values()),
    accountsCount: accounts.reduce((sum, a) => sum + a.quantity, 0),
    primaryApplicationId: accounts[0].applicationId,
  };
}

/**
 * Recherche (non bloquante) des identifiants déjà déclarés sur d'autres tickets.
 * Renvoie une liste d'avertissements affichés au technicien : la donnée reste
 * valide, mais un doublon inter-tickets mérite souvent une vérification.
 * Échoue silencieusement (télémétrie d'aide, jamais un motif de refus).
 */
async function findCrossTicketDuplicates(accounts, ticketId) {
  // Seules les créations sont concernées : une mise à jour de droits vise par
  // définition un compte déjà existant, donc déjà présent ailleurs.
  const withLogin = (Array.isArray(accounts) ? accounts : []).filter((a) => a && a.login && a.operation !== 'DROITS');
  if (withLogin.length === 0) return [];

  const logins = [...new Set(withLogin.map((a) => a.login.toLowerCase()))];
  try {
    const rows = await prisma.$queryRaw`
      SELECT r."ticketId" AS "ticketId",
             a->>'login' AS login,
             a->>'applicationId' AS "applicationId",
             a->>'applicationName' AS "applicationName"
      FROM "AccountProvisioningRecord" r
      CROSS JOIN LATERAL jsonb_array_elements(r."accounts") a
      WHERE r."ticketId" <> ${Number(ticketId)}
        AND lower(a->>'login') = ANY(${logins}::text[])
      LIMIT 20
    `;

    return rows
      .map((row) => {
        const match = withLogin.find(
          (account) =>
            account.login.toLowerCase() === String(row.login || '').toLowerCase() &&
            Number(account.applicationId) === Number(row.applicationId)
        );
        if (!match) return null;
        return {
          code: 'DUPLICATE_LOGIN_OTHER_TICKET',
          ticketId: Number(row.ticketId),
          applicationName: match.applicationName,
          login: match.login,
          message: `Le compte « ${match.login} » sur ${match.applicationName} est déjà déclaré sur le ticket #${row.ticketId}.`,
        };
      })
      .filter(Boolean);
  } catch (err) {
    logger.warn(`[accountProvisioning] Vérification doublons inter-tickets ignorée: ${err.message}`);
    return [];
  }
}

/** Prépare la télémétrie de pré-remplissage stockée avec la déclaration. */
function sanitizePrefillMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;

  const sanitizeAccount = (account) => ({
    applicationId: Number.isInteger(Number(account?.applicationId)) ? Number(account.applicationId) : null,
    applicationName: cleanString(account?.applicationName, 120),
    operation: ACCOUNT_OPERATIONS.includes(cleanString(account?.operation, 20).toUpperCase())
      ? cleanString(account.operation, 20).toUpperCase()
      : 'CREATION',
    login: cleanString(account?.login, 120),
    profile: cleanString(account?.profile, 120),
    quantity: Number.isInteger(Number(account?.quantity)) ? Number(account.quantity) : 1,
  });

  return {
    aiUsed: Boolean(meta.aiUsed),
    classifier: meta.classifier === 'AI' ? 'AI' : 'DETERMINISTIC',
    confidence: Number.isFinite(Number(meta.confidence)) ? Math.max(0, Math.min(1, Number(meta.confidence))) : null,
    evidence: cleanString(meta.evidence, 500),
    suggestedAccounts: Array.isArray(meta.accounts) ? meta.accounts.slice(0, MAX_ACCOUNTS).map(sanitizeAccount) : [],
    suggestedApplications: Array.isArray(meta.applications)
      ? meta.applications.slice(0, MAX_ACCOUNTS).map((app) => ({
          id: Number.isInteger(Number(app?.id)) ? Number(app.id) : null,
          name: cleanString(app?.name, 120),
        }))
      : [],
    ignoredApplications: Array.isArray(meta.ignoredApplications)
      ? meta.ignoredApplications.map((name) => cleanString(name, 120)).filter(Boolean).slice(0, 30)
      : [],
  };
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function buildIdempotencyKey(ticketId, accounts) {
  return crypto
    .createHash('sha256')
    .update(stableStringify({ ticketId: Number(ticketId), accounts }))
    .digest('hex');
}

/**
 * État du module pour un ticket et un utilisateur donné.
 * `required` ne vaut true que pour un technicien quand le module est actif.
 */
async function getProvisioningState(ticketId, user) {
  const [settings, record] = await Promise.all([
    getSystemSettings(),
    prisma.accountProvisioningRecord.findUnique({ where: { ticketId: Number(ticketId) } }),
  ]);

  return {
    moduleEnabled: Boolean(settings.accountProvisioningEnabled),
    aiPrefillEnabled: Boolean(settings.accountProvisioningAiPrefill),
    required: Boolean(settings.accountProvisioningEnabled && user?.role === 'TECHNICIAN'),
    completed: Boolean(record),
    record: record ? serializeRecord(record) : null,
  };
}

function serializeRecord(record) {
  if (!record) return null;
  const accounts = record.accounts || [];
  return {
    id: record.id,
    ticketId: record.ticketId,
    applicationId: record.applicationId,
    applications: record.applications || [],
    accounts,
    accountsCount: record.accountsCount,
    hasRightsUpdate: accounts.some((account) => account?.operation === 'DROITS'),
    source: record.source,
    aiConfidence: record.aiConfidence,
    prefillSource: record.prefillSource || null,
    prefillConfidence: record.prefillConfidence ?? null,
    prefillSnapshot: record.prefillSnapshot || null,
    ignoredApplications: Array.isArray(record.ignoredApplications) ? record.ignoredApplications : [],
    budibaseStatus: record.budibaseStatus,
    budibaseRowId: record.budibaseRowId,
    budibaseSyncedAt: record.budibaseSyncedAt,
    syncAttempts: record.syncAttempts,
    lastError: record.lastError,
    createdById: record.createdById,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Vérifie qu'un technicien peut résoudre un ticket. Lève une erreur 409
 * `ACCOUNT_PROVISIONING_REQUIRED` si la déclaration manque. Les autres rôles
 * (ADMIN, SUPERADMIN, HOTLINE) ne sont jamais bloqués.
 */
async function assertProvisioningComplete(user, ticketId) {
  if (!user || user.role !== 'TECHNICIAN') return;
  const settings = await getSystemSettings();
  if (!settings.accountProvisioningEnabled) return;

  const record = await prisma.accountProvisioningRecord.findUnique({
    where: { ticketId: Number(ticketId) },
    select: { id: true },
  });
  if (!record) {
    throw new ProvisioningError(
      'Déclarez les opérations réalisées sur les comptes applicatifs (création ou mise à jour de droits) avant de marquer ce ticket comme résolu.',
      { statusCode: 409, code: 'ACCOUNT_PROVISIONING_REQUIRED' }
    );
  }
}

/**
 * Variante bulk : renvoie les ids de tickets sans déclaration. Utilisée par
 * POST /tickets/bulk-update pour éviter un contournement par action groupée.
 */
async function findTicketsMissingProvisioning(user, ticketIds) {
  if (!user || user.role !== 'TECHNICIAN') return [];
  const settings = await getSystemSettings();
  if (!settings.accountProvisioningEnabled) return [];

  const ids = (Array.isArray(ticketIds) ? ticketIds : []).map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return [];

  const declared = await prisma.accountProvisioningRecord.findMany({
    where: { ticketId: { in: ids } },
    select: { ticketId: true },
  });
  const declaredSet = new Set(declared.map((r) => r.ticketId));
  return ids.filter((id) => !declaredSet.has(id));
}

async function listCatalog({ activeOnly = true } = {}) {
  return prisma.applicationCatalog.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: { name: 'asc' },
  });
}

/**
 * Enregistre (ou met à jour) la déclaration de comptes d'un ticket.
 * L'écriture en base réussit même si Budibase est indisponible.
 */
async function saveProvisioningRecord({ ticketId, accounts, noAccountCreated = false, source = 'MANUAL', aiConfidence = null, prefillMeta = null, user, ipAddress = null }) {
  const numericTicketId = Number(ticketId);
  if (!Number.isInteger(numericTicketId) || numericTicketId <= 0) {
    throw new ProvisioningError('Ticket invalide.');
  }

  const createdByIdRaw = Number(user?.sub);
  const createdById = Number.isInteger(createdByIdRaw) && createdByIdRaw > 0 ? createdByIdRaw : null;

  const ticket = await prisma.ticket.findUnique({
    where: { id: numericTicketId },
    select: { id: true, title: true, status: true, deletedAt: true },
  });
  if (!ticket || ticket.deletedAt) {
    throw new ProvisioningError('Ticket introuvable.', { statusCode: 404, code: 'TICKET_NOT_FOUND' });
  }

  const catalog = await listCatalog({ activeOnly: true });
  if (!noAccountCreated && catalog.length === 0) {
    throw new ProvisioningError(
      'Aucune application active dans le catalogue : un administrateur doit d’abord en configurer une.',
      { code: 'ACCOUNT_PROVISIONING_NO_CATALOG' }
    );
  }

  const normalized = noAccountCreated
    ? { accounts: [], applications: [], accountsCount: 0, primaryApplicationId: null }
    : normalizeAccounts(accounts, catalog);
  const meta = sanitizePrefillMeta(prefillMeta);
  // Aide non bloquante : un identifiant déjà déclaré ailleurs est signalé, pas refusé.
  const warnings = noAccountCreated ? [] : await findCrossTicketDuplicates(normalized.accounts, numericTicketId);
  const idempotencyKey = buildIdempotencyKey(
    numericTicketId,
    noAccountCreated ? [{ noAccountCreated: true }] : normalized.accounts
  );

  const existing = await prisma.accountProvisioningRecord.findUnique({ where: { ticketId: numericTicketId } });
  if (existing && existing.idempotencyKey === idempotencyKey) {
    // Même payload : on rejoue la réponse sans réécrire ni re-pousser vers Budibase.
    return { record: serializeRecord(existing), replayed: true, warnings };
  }

  const data = {
    applicationId: normalized.primaryApplicationId,
    applications: normalized.applications,
    accounts: normalized.accounts,
    accountsCount: normalized.accountsCount,
    source: noAccountCreated ? 'NOT_APPLICABLE' : source === 'AI_PREFILL' ? 'AI_PREFILL' : 'MANUAL',
    aiConfidence: Number.isFinite(Number(aiConfidence)) ? Math.max(0, Math.min(1, Number(aiConfidence))) : null,
    // Télémétrie : ce que le pré-remplissage proposait, pour mesurer la qualité
    // (taux d'acceptation, applications corrigées, applications ignorées).
    prefillSource: meta ? (meta.aiUsed ? 'AI' : 'DETERMINISTIC') : null,
    prefillConfidence: meta?.confidence ?? null,
    prefillSnapshot: meta,
    ignoredApplications: meta?.ignoredApplications || [],
    createdById,
    idempotencyKey,
    // Toute modification du contenu repart en synchronisation.
    budibaseStatus: 'PENDING',
    budibaseRowId: null,
    budibaseSyncedAt: null,
    lastError: null,
    syncAttempts: 0,
  };

  const record = existing
    ? await prisma.accountProvisioningRecord.update({ where: { ticketId: numericTicketId }, data })
    : await prisma.accountProvisioningRecord.create({ data: { ...data, ticketId: numericTicketId } });

  try {
    await auditLog(existing ? 'ACCOUNT_PROVISIONING_UPDATED' : 'ACCOUNT_PROVISIONING_DECLARED', {
      actor: user,
      targetType: 'Ticket',
      targetId: numericTicketId,
      targetLabel: ticket.title,
      ipAddress,
      metadata: {
        recordId: record.id,
        applications: normalized.applications,
        accountsCount: normalized.accountsCount,
        source: data.source,
      },
    });
  } catch (err) {
    logger.warn(`[accountProvisioning] Audit log échoué: ${err.message}`);
  }

  // Note interne : trace lisible dans le fil du ticket, sans dupliquer les données
  // sensibles (aucun mot de passe n'existe ici par construction).
  if (!existing) {
    try {
      const summary = normalized.applications.map((a) => a.name).join(', ');
      const rightsCount = normalized.accounts.filter((a) => a.operation === 'DROITS').length;
      const creationCount = normalized.accounts.length - rightsCount;
      let content;
      if (noAccountCreated) {
        content = 'Aucun compte applicatif déclaré pour la résolution de ce ticket.';
      } else if (rightsCount === 0) {
        content = `Comptes applicatifs déclarés pour la résolution : ${normalized.accountsCount} compte(s) — ${summary}.`;
      } else if (creationCount === 0) {
        content = `Mises à jour de droits déclarées pour la résolution : ${rightsCount} compte(s) — ${summary}.`;
      } else {
        content = `Déclaration pour la résolution : ${creationCount} création(s) de compte et ${rightsCount} mise(s) à jour de droits — ${summary}.`;
      }
      await prisma.followup.create({
        data: {
          ticketId: numericTicketId,
          authorId: createdById,
          content,
          source: 'erp',
          isPrivate: true,
        },
      });
    } catch (err) {
      logger.warn(`[accountProvisioning] Note interne échouée: ${err.message}`);
    }
  }

  // La synchronisation est tentée immédiatement pour que l'UI affiche un statut
  // fiable, mais ses erreurs ne remontent jamais : la déclaration locale est acquise.
  const synced = await syncRecordToBudibase(record.id);
  return { record: serializeRecord(synced), replayed: false, warnings };
}

// L'API publique v4 expose les lignes sous /api/public/v1 (l'ancien /api/v1 renvoie 404).
const DEFAULT_BUDIBASE_ROWS_PATH = '/api/public/v1/tables/{tableId}/rows';

function resolveBudibaseEndpoint(config) {
  const baseUrl = String(config.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) return null;
  const extra = config.extra && typeof config.extra === 'object' ? config.extra : {};
  const tableId = String(extra.tableId || '').trim();
  const pathTemplate = String(extra.rowsPath || DEFAULT_BUDIBASE_ROWS_PATH).trim();
  if (!tableId) return null;
  return `${baseUrl}${pathTemplate.replace('{tableId}', encodeURIComponent(tableId))}`;
}

// Depuis Budibase v4, chaque appel public est scopé à une application : sans
// `x-budibase-app-id`, l'API répond 400 « Invalid app ID provided ». L'en-tête
// n'est envoyé que si l'App ID est configuré (compatibilité anciennes versions).
function getBudibaseAppId(config) {
  const extra = config?.extra && typeof config.extra === 'object' ? config.extra : {};
  return String(extra.appId || '').trim();
}

function buildBudibaseHeaders(config) {
  const headers = {
    'Content-Type': 'application/json',
    'x-budibase-api-key': config.apiKey,
  };
  const appId = getBudibaseAppId(config);
  if (appId) headers['x-budibase-app-id'] = appId;
  return headers;
}

function buildBudibasePayload(record, ticket, createdBy) {
  const accounts = record.accounts || [];
  return {
    ticketId: record.ticketId,
    ticketTitle: ticket?.title || null,
    ticketStatus: ticket?.status || null,
    applicationNames: (record.applications || []).map((a) => a.name).join(', '),
    applications: record.applications || [],
    accounts,
    accountsCount: record.accountsCount,
    // Ventilation explicite : Budibase peut filtrer les créations et les mises à
    // jour de droits sans avoir à parcourir le JSON `accounts`.
    operations: [...new Set(accounts.map((account) => account?.operation || 'CREATION'))],
    hasRightsUpdate: accounts.some((account) => account?.operation === 'DROITS'),
    source: record.source,
    aiConfidence: record.aiConfidence,
    createdByEmail: createdBy?.email || null,
    declaredAt: record.createdAt?.toISOString?.() || null,
    idempotencyKey: record.idempotencyKey,
  };
}

/**
 * Pousse un enregistrement vers Budibase. Ne lève jamais : renvoie l'enregistrement
 * avec son statut (`SYNCED`, `FAILED`, `SKIPPED`).
 */
async function syncRecordToBudibase(recordId) {
  const record = await prisma.accountProvisioningRecord.findUnique({
    where: { id: Number(recordId) },
    include: {
      ticket: { select: { id: true, title: true, status: true } },
      createdBy: { select: { id: true, email: true } },
    },
  });
  if (!record) throw new ProvisioningError('Déclaration introuvable.', { statusCode: 404 });

  const config = await prisma.apiConfig.findUnique({ where: { serviceName: BUDIBASE_SERVICE } });
  const endpoint = config && config.isActive ? resolveBudibaseEndpoint(config) : null;

  // Budibase n'est pas configuré : le module reste utilisable en local, sans erreur
  // alarmante. Le statut SKIPPED le distingue clairement d'un échec de synchronisation.
  if (!endpoint) {
    return prisma.accountProvisioningRecord.update({
      where: { id: record.id },
      data: {
        budibaseStatus: 'SKIPPED',
        lastError: 'Intégration Budibase non configurée (enregistrement local uniquement).',
      },
    });
  }

  const breaker = getBreaker('budibase-api', { maxFailures: 5, resetTimeoutMs: 60000 });

  try {
    const payload = buildBudibasePayload(record, record.ticket, record.createdBy);
    const response = await breaker.call(() =>
      fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: {
            ...buildBudibaseHeaders(config),
            // Idempotence côté Budibase/automation : un rejeu ne doit pas dupliquer la ligne.
            'Idempotency-Key': record.idempotencyKey,
          },
          body: JSON.stringify(payload),
        },
        BUDIBASE_TIMEOUT_MS
      )
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const err = new Error(`Budibase HTTP ${response.status}${body ? ` — ${body.slice(0, 300)}` : ''}`);
      err.status = response.status;
      throw err;
    }

    const json = await response.json().catch(() => ({}));
    const rowId =
      json?._id || json?.id || json?.data?._id || json?.data?.id || json?.row?._id || json?.row?.id || null;

    return prisma.accountProvisioningRecord.update({
      where: { id: record.id },
      data: {
        budibaseStatus: 'SYNCED',
        budibaseRowId: rowId ? String(rowId) : null,
        budibaseSyncedAt: new Date(),
        lastError: null,
        syncAttempts: { increment: 1 },
      },
    });
  } catch (err) {
    logger.warn(`[accountProvisioning] Sync Budibase échouée (ticket ${record.ticketId}): ${err.message}`);
    return prisma.accountProvisioningRecord.update({
      where: { id: record.id },
      data: {
        budibaseStatus: 'FAILED',
        lastError: String(err.message || err).slice(0, 2000),
        syncAttempts: { increment: 1 },
      },
    });
  }
}

/** Rejoue les écritures Budibase en attente ou en échec (appelé par le scheduler). */
async function retryPendingBudibase(limit = 20) {
  const rows = await prisma.accountProvisioningRecord.findMany({
    where: {
      budibaseStatus: { in: ['PENDING', 'FAILED'] },
      syncAttempts: { lt: MAX_SYNC_ATTEMPTS },
    },
    orderBy: { createdAt: 'asc' },
    take: Math.max(1, Math.min(100, Number(limit) || 20)),
    select: { id: true },
  });

  let synced = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await syncRecordToBudibase(row.id);
    if (result.budibaseStatus === 'SYNCED') synced += 1;
    else if (result.budibaseStatus === 'FAILED') failed += 1;
  }
  return { scanned: rows.length, synced, failed };
}

/**
 * Indicateurs de qualité du pré-remplissage (supervision SUPERADMIN).
 * But : mesurer pour corriger — applications proposées puis corrigées, comptes
 * acceptés sans retouche, applications hors catalogue récurrentes.
 */
async function getProvisioningStats({ sampleSize = 500 } = {}) {
  const take = Math.max(1, Math.min(2000, Number(sampleSize) || 500));

  const [total, bySource, byBudibase, recent] = await Promise.all([
    prisma.accountProvisioningRecord.count(),
    prisma.accountProvisioningRecord.groupBy({ by: ['source'], _count: { _all: true } }),
    prisma.accountProvisioningRecord.groupBy({ by: ['budibaseStatus'], _count: { _all: true } }),
    prisma.accountProvisioningRecord.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        ticketId: true,
        source: true,
        applications: true,
        accounts: true,
        prefillSnapshot: true,
        prefillSource: true,
        prefillConfidence: true,
        ignoredApplications: true,
        budibaseStatus: true,
        createdAt: true,
      },
    }),
  ]);

  const appKey = (apps) =>
    (Array.isArray(apps) ? apps : [])
      .map((app) => Number(app?.id))
      .filter((id) => Number.isInteger(id))
      .sort((a, b) => a - b)
      .join(',');

  const accountKey = (accounts) =>
    (Array.isArray(accounts) ? accounts : [])
      .filter((account) => account && account.login)
      .map((account) => `${Number(account.applicationId)}|${account.operation || 'CREATION'}|${String(account.login).toLowerCase()}`)
      .sort()
      .join(',');

  // Ventilation créations / mises à jour de droits (calculée en base pour ne pas
  // dépendre de l'échantillon). Une erreur ici ne doit jamais casser les stats.
  let byOperation = {};
  try {
    const rows = await prisma.$queryRaw`
      SELECT COALESCE(a->>'operation', 'CREATION') AS operation, count(*)::int AS count
      FROM "AccountProvisioningRecord" r
      CROSS JOIN LATERAL jsonb_array_elements(r."accounts") a
      GROUP BY 1
    `;
    byOperation = Object.fromEntries(rows.map((row) => [row.operation || 'CREATION', Number(row.count) || 0]));
  } catch (err) {
    logger.warn(`[accountProvisioning] Ventilation par opération ignorée: ${err.message}`);
  }

  const prefilled = recent.filter((row) => row.prefillSnapshot && typeof row.prefillSnapshot === 'object');
  const aiPrefilled = prefilled.filter((row) => row.prefillSource === 'AI');

  let applicationsAccepted = 0;
  let applicationsCorrected = 0;
  let accountsAccepted = 0;
  let emptyAfterPrefill = 0;

  for (const row of prefilled) {
    const snapshot = row.prefillSnapshot || {};
    const suggestedApps = appKey(snapshot.suggestedApplications);
    const suggestedAccounts = accountKey(snapshot.suggestedAccounts);

    if (suggestedApps) {
      if (suggestedApps === appKey(row.applications)) applicationsAccepted += 1;
      else applicationsCorrected += 1;
    }
    if (suggestedAccounts && suggestedAccounts === accountKey(row.accounts)) accountsAccepted += 1;
    if ((suggestedApps || suggestedAccounts) && (!Array.isArray(row.accounts) || row.accounts.length === 0)) {
      emptyAfterPrefill += 1;
    }
  }

  const ignoredCounts = new Map();
  for (const row of recent) {
    for (const name of Array.isArray(row.ignoredApplications) ? row.ignoredApplications : []) {
      const key = String(name || '').trim();
      if (!key) continue;
      ignoredCounts.set(key, (ignoredCounts.get(key) || 0) + 1);
    }
  }

  return {
    total,
    bySource: Object.fromEntries(bySource.map((row) => [row.source, row._count._all])),
    byBudibaseStatus: Object.fromEntries(byBudibase.map((row) => [row.budibaseStatus, row._count._all])),
    byOperation,
    rightsUpdates: byOperation.DROITS || 0,
    sampleSize: recent.length,
    prefill: {
      total: prefilled.length,
      ai: aiPrefilled.length,
      deterministic: prefilled.length - aiPrefilled.length,
      applicationsAccepted,
      applicationsCorrected,
      accountsAccepted,
      emptyAfterPrefill,
      acceptanceRate: prefilled.length > 0
        ? Math.round((applicationsAccepted / prefilled.length) * 1000) / 1000
        : null,
    },
    topIgnoredApplications: [...ignoredCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count })),
  };
}

module.exports = {
  ProvisioningError,
  assertNoSecret,
  normalizeAccounts,
  findAliasConflicts,
  findCrossTicketDuplicates,
  buildIdempotencyKey,
  getProvisioningState,
  assertProvisioningComplete,
  findTicketsMissingProvisioning,
  listCatalog,
  saveProvisioningRecord,
  syncRecordToBudibase,
  retryPendingBudibase,
  getProvisioningStats,
  serializeRecord,
  resolveBudibaseEndpoint,
  getBudibaseAppId,
  buildBudibaseHeaders,
  DEFAULT_BUDIBASE_ROWS_PATH,
};
