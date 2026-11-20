// ── File de validation des applications hors catalogue ──────────────────────
// L'IA ne crée jamais une application : elle peut seulement signaler un nom
// inconnu. Ce service conserve ces noms (une ligne par nom normalisé) pour que
// le SUPERADMIN les promeuve en application du catalogue, les fusionne avec une
// application existante, ou les ignore.
//
// Aucune écriture ici n'est bloquante pour le pré-remplissage : un échec est
// journalisé et le technicien continue avec sa saisie manuelle.
const prisma = require('../prismaClient');
const { ProvisioningError } = require('./accountProvisioning');
const { logger } = require('../utils/logger');

const MAX_NAME_LENGTH = 120;
const MAX_ALIASES = 30;
const MAX_PROFILES = 50;
const STATUSES = new Set(['PENDING', 'PROMOTED', 'IGNORED']);

/**
 * Clé de comparaison : accents supprimés, casse neutralisée, ponctuation
 * ramenée à des espaces. « Sage-X3 », « sage x3 » et « SAGE  X3 » se rejoignent.
 */
function normalizeCandidateName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

function cleanAliases(values) {
  // Déduplication insensible à la casse/ponctuation : « Zoho Test » et
  // « zoho test » désignent le même alias.
  const seen = new Set();
  const aliases = [];
  for (const value of Array.isArray(values) ? values : []) {
    const alias = cleanName(value);
    if (!alias) continue;
    const key = normalizeCandidateName(alias);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
    if (aliases.length >= MAX_ALIASES) break;
  }
  return aliases;
}

/** Retire les alias identiques au nom de l'application (redondants). */
function withoutSelfAlias(aliases, appName) {
  const key = normalizeCandidateName(appName);
  return aliases.filter((alias) => normalizeCandidateName(alias) !== key);
}

/** Construit le schéma `fields` du catalogue à partir des profils saisis. */
function fieldsFromProfiles(profiles) {
  // Déduplication insensible à la casse : « Comptable » et « comptable » sont le
  // même profil et ne doivent pas apparaître deux fois dans la liste fermée.
  const seen = new Set();
  const options = [];
  for (const raw of Array.isArray(profiles) ? profiles : []) {
    const label = cleanName(raw);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(label);
    if (options.length >= MAX_PROFILES) break;
  }
  return options.length > 0
    ? [{ key: 'profile', label: 'Profil', type: 'select', options }]
    : [];
}

async function knownApplicationKeys() {
  const catalog = await prisma.applicationCatalog.findMany({ select: { name: true, aliases: true } });
  const keys = new Set();
  for (const app of catalog) {
    keys.add(normalizeCandidateName(app.name));
    for (const alias of app.aliases || []) keys.add(normalizeCandidateName(alias));
  }
  return keys;
}

/**
 * Enregistre (ou incrémente) les applications vues hors catalogue.
 * Les noms déjà connus du catalogue et les candidats déjà promus/ignorés sont
 * écartés. Renvoie le nombre de noms traités.
 */
async function recordApplicationCandidates(names, { ticketId = null } = {}) {
  const unique = new Map();
  for (const raw of Array.isArray(names) ? names : []) {
    const name = cleanName(raw);
    const normalizedName = normalizeCandidateName(name);
    if (!normalizedName || normalizedName.length < 2) continue;
    if (!unique.has(normalizedName)) unique.set(normalizedName, name);
  }
  if (unique.size === 0) return 0;

  let known = new Set();
  try {
    known = await knownApplicationKeys();
  } catch (err) {
    logger.warn(`[accountProvisioning] Catalogue indisponible pour filtrer les candidats: ${err.message}`);
  }

  let recorded = 0;
  for (const [normalizedName, name] of unique) {
    if (known.has(normalizedName)) continue;
    try {
      const existing = await prisma.applicationCandidate.findUnique({ where: { normalizedName } });
      if (!existing) {
        await prisma.applicationCandidate.create({
          data: { name, normalizedName, lastTicketId: ticketId ?? null },
        });
        recorded += 1;
      } else if (existing.status === 'PENDING') {
        await prisma.applicationCandidate.update({
          where: { id: existing.id },
          data: {
            occurrences: { increment: 1 },
            lastTicketId: ticketId ?? existing.lastTicketId,
            lastSeenAt: new Date(),
          },
        });
        recorded += 1;
      }
    } catch (err) {
      // Deux pré-remplissages simultanés : l'index unique tranche, on ignore.
      if (err?.code !== 'P2002') {
        logger.warn(`[accountProvisioning] Candidat « ${name} » non enregistré: ${err.message}`);
      }
    }
  }
  return recorded;
}

async function listApplicationCandidates({ status = 'PENDING', limit = 50 } = {}) {
  const normalizedStatus = STATUSES.has(String(status).toUpperCase())
    ? String(status).toUpperCase()
    : 'PENDING';
  const take = Math.max(1, Math.min(200, Number(limit) || 50));
  return prisma.applicationCandidate.findMany({
    where: { status: normalizedStatus },
    orderBy: [{ occurrences: 'desc' }, { lastSeenAt: 'desc' }],
    take,
  });
}

async function getCandidateOrThrow(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new ProvisioningError('Identifiant de candidat invalide.', { statusCode: 400, code: 'ACCOUNT_PROVISIONING_INVALID_ID' });
  }
  const candidate = await prisma.applicationCandidate.findUnique({ where: { id: numericId } });
  if (!candidate) {
    throw new ProvisioningError('Candidat introuvable.', { statusCode: 404, code: 'ACCOUNT_PROVISIONING_CANDIDATE_NOT_FOUND' });
  }
  return candidate;
}

/**
 * Promeut un candidat :
 *   • `mergeIntoId` renseigné → ajoute le libellé comme alias de cette application ;
 *   • une application de même nom normalisé existe → fusionne aussi (pas de doublon) ;
 *   • sinon → crée l'application avec ses alias et, si fournis, ses profils.
 */
async function promoteApplicationCandidate(id, payload = {}) {
  const candidate = await getCandidateOrThrow(id);
  if (candidate.status === 'PROMOTED') {
    throw new ProvisioningError('Ce candidat a déjà été ajouté au catalogue.', {
      statusCode: 409,
      code: 'ACCOUNT_PROVISIONING_CANDIDATE_PROMOTED',
    });
  }

  const aliases = cleanAliases(payload.aliases);
  const profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
  const requestedName = cleanName(payload.name) || candidate.name;
  const catalog = await prisma.applicationCatalog.findMany();

  const mergeIntoId = payload.mergeIntoId === undefined || payload.mergeIntoId === null || payload.mergeIntoId === ''
    ? null
    : Number(payload.mergeIntoId);

  let target = null;
  if (mergeIntoId) {
    target = catalog.find((app) => app.id === mergeIntoId) || null;
    if (!target) {
      throw new ProvisioningError('Application cible introuvable.', {
        statusCode: 404,
        code: 'ACCOUNT_PROVISIONING_APP_NOT_FOUND',
      });
    }
  } else {
    const wantedKey = normalizeCandidateName(requestedName);
    target = catalog.find((app) => normalizeCandidateName(app.name) === wantedKey) || null;

    if (!target) {
      const aliasOwner = catalog.find((app) =>
        (app.aliases || []).some((alias) => normalizeCandidateName(alias) === wantedKey)
      );
      if (aliasOwner) {
        throw new ProvisioningError(
          `« ${requestedName} » est déjà un alias de « ${aliasOwner.name} » : utilisez la fusion.`,
          { statusCode: 409, code: 'ACCOUNT_PROVISIONING_ALIAS_DUPLICATE', details: { applicationId: aliasOwner.id } }
        );
      }
    }
  }

  if (target) {
    const mergedAliases = withoutSelfAlias(
      cleanAliases([...(target.aliases || []), candidate.name, requestedName, ...aliases]),
      target.name
    );
    const updated = await prisma.applicationCatalog.update({
      where: { id: target.id },
      data: { aliases: mergedAliases, isActive: true },
    });
    const updatedCandidate = await prisma.applicationCandidate.update({
      where: { id: candidate.id },
      data: { status: 'PROMOTED', promotedCatalogId: target.id },
    });
    return { catalog: updated, candidate: updatedCandidate, merged: true };
  }

  const created = await prisma.applicationCatalog.create({
    data: {
      name: requestedName,
      aliases: withoutSelfAlias(cleanAliases([candidate.name, ...aliases]), requestedName),
      fields: fieldsFromProfiles(profiles),
      isActive: true,
    },
  });
  const updatedCandidate = await prisma.applicationCandidate.update({
    where: { id: candidate.id },
    data: { status: 'PROMOTED', promotedCatalogId: created.id },
  });
  return { catalog: created, candidate: updatedCandidate, merged: false };
}

async function ignoreApplicationCandidate(id) {
  const candidate = await getCandidateOrThrow(id);
  if (candidate.status === 'IGNORED') return candidate;
  return prisma.applicationCandidate.update({
    where: { id: candidate.id },
    data: { status: 'IGNORED' },
  });
}

module.exports = {
  normalizeCandidateName,
  cleanAliases,
  fieldsFromProfiles,
  recordApplicationCandidates,
  listApplicationCandidates,
  promoteApplicationCandidate,
  ignoreApplicationCandidate,
};
