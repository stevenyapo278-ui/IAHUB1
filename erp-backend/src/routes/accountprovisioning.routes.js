// ── Routes du module « Création de comptes applicatifs » ────────────────────
// Montées sur /api/account-provisioning. Le module est activable/désactivable par
// le SUPERADMIN via SystemSettings.accountProvisioningEnabled ; ces routes restent
// disponibles quand il est désactivé (consultation/administration), mais le blocage
// de la résolution SOLVED n'est appliqué que lorsqu'il est actif.
const express = require('express');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requireSuperAdmin, requirePermission } = require('../middleware/permissions');
const {
  ProvisioningError,
  getProvisioningState,
  listCatalog,
  saveProvisioningRecord,
  syncRecordToBudibase,
  retryPendingBudibase,
  findAliasConflicts,
  getProvisioningStats,
} = require('../services/accountProvisioning');
const { suggestProvisioning } = require('../services/accountProvisioningAi');
const {
  recordApplicationCandidates,
  listApplicationCandidates,
  promoteApplicationCandidate,
  ignoreApplicationCandidate,
} = require('../services/accountProvisioningCandidates');

const router = express.Router();
router.use(authenticate);

const DECLARE_ROLES = new Set(['TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN']);

function canDeclare(user) {
  return Boolean(user && DECLARE_ROLES.has(user.role));
}

function sendError(res, err, fallbackMessage = 'Erreur lors du traitement de la déclaration.') {
  if (err instanceof ProvisioningError) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      ...(err.details ? { details: err.details } : {}),
    });
  }
  if (err?.statusCode) {
    return res.status(err.statusCode).json({ error: err.statusCode === 404 ? 'Ticket introuvable.' : err.message });
  }
  console.error('[account-provisioning]', err);
  return res.status(500).json({ error: fallbackMessage });
}

function normalizeCatalogPayload(body = {}) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120) {
    throw new ProvisioningError('Le nom de l’application est obligatoire (120 caractères max).');
  }
  const aliases = Array.isArray(body.aliases)
    ? body.aliases.map((a) => String(a).trim()).filter(Boolean).slice(0, 30)
    : [];
  const fields = body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields)
    ? body.fields
    : Array.isArray(body.fields) ? body.fields : null;

  return {
    name,
    aliases,
    fields,
    isActive: body.isActive === undefined ? true : Boolean(body.isActive),
  };
}

/**
 * Contrôle les alias avant écriture :
 *   • `duplicate` → refus 409 (deux applications ne peuvent pas partager un alias) ;
 *   • `contained`/`redundant` → avertissements renvoyés avec la réponse (l'alias est
 *     accepté mais signalé, car il peut provoquer une double détection).
 */
async function assertAliasesUsable(data, excludeId = null) {
  const others = await prisma.applicationCatalog.findMany({ select: { id: true, name: true, aliases: true } });
  const conflicts = findAliasConflicts(data, others, excludeId);

  const duplicates = conflicts.filter((conflict) => conflict.type === 'duplicate');
  if (duplicates.length > 0) {
    throw new ProvisioningError(duplicates[0].message, {
      statusCode: 409,
      code: 'ACCOUNT_PROVISIONING_ALIAS_DUPLICATE',
      details: { conflicts: duplicates },
    });
  }

  return conflicts.map((conflict) => conflict.message);
}

// ── Catalogue des applications ──────────────────────────────────────────────

// Lecture ouverte à tout utilisateur authentifié : le formulaire en a besoin.
router.get('/catalog', async (req, res) => {
  try {
    const catalog = await listCatalog({ activeOnly: true });
    return res.json(catalog);
  } catch (err) {
    return sendError(res, err, 'Impossible de charger le catalogue des applications.');
  }
});

// Vue complète (y compris désactivées) réservée au SUPERADMIN.
router.get('/catalog/all', requireSuperAdmin, async (req, res) => {
  try {
    const catalog = await listCatalog({ activeOnly: false });
    return res.json(catalog);
  } catch (err) {
    return sendError(res, err, 'Impossible de charger le catalogue des applications.');
  }
});

router.post('/catalog', requireSuperAdmin, async (req, res) => {
  try {
    const data = normalizeCatalogPayload(req.body);
    const existing = await prisma.applicationCatalog.findUnique({ where: { name: data.name } });
    if (existing) {
      return res.status(409).json({ error: `L’application « ${data.name} » existe déjà.` });
    }
    const warnings = await assertAliasesUsable(data);
    const created = await prisma.applicationCatalog.create({ data });
    return res.status(201).json({ ...created, warnings });
  } catch (err) {
    return sendError(res, err, 'Impossible de créer l’application.');
  }
});

router.patch('/catalog/:id', requireSuperAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Identifiant invalide.' });

    const existing = await prisma.applicationCatalog.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Application introuvable.' });

    const data = normalizeCatalogPayload({ ...existing, ...req.body });
    const warnings = await assertAliasesUsable(data, id);
    const updated = await prisma.applicationCatalog.update({ where: { id }, data });
    return res.json({ ...updated, warnings });
  } catch (err) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'Une application portant ce nom existe déjà.' });
    }
    return sendError(res, err, 'Impossible de mettre à jour l’application.');
  }
});

// Désactivation logique : les déclarations historiques restent lisibles.
router.delete('/catalog/:id', requireSuperAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Identifiant invalide.' });
    const existing = await prisma.applicationCatalog.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Application introuvable.' });
    const updated = await prisma.applicationCatalog.update({ where: { id }, data: { isActive: false } });
    return res.json(updated);
  } catch (err) {
    return sendError(res, err, 'Impossible de désactiver l’application.');
  }
});

// Suppression définitive : uniquement si aucune déclaration ne référence
// l'application comme application principale (sinon l'historique et les stats
// perdraient leur lien). Les snapshots JSON des comptes restent lisibles.
router.delete('/catalog/:id/permanent', requireSuperAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Identifiant invalide.' });
    const existing = await prisma.applicationCatalog.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Application introuvable.' });

    const referenced = await prisma.accountProvisioningRecord.count({ where: { applicationId: id } });
    if (referenced > 0) {
      return res.status(409).json({
        error: `« ${existing.name} » est référencée par ${referenced} déclaration(s) : désactivez-la au lieu de la supprimer.`,
        code: 'ACCOUNT_PROVISIONING_APP_IN_USE',
        details: { records: referenced },
      });
    }

    await prisma.applicationCatalog.delete({ where: { id } });
    return res.json({ deleted: true, id });
  } catch (err) {
    return sendError(res, err, 'Impossible de supprimer définitivement l’application.');
  }
});

// ── Applications détectées hors catalogue ───────────────────────────────────
// File de validation : l'IA ne crée jamais une application, elle propose un nom.
router.get('/candidates', requireSuperAdmin, async (req, res) => {
  try {
    const candidates = await listApplicationCandidates({
      status: req.query.status || 'PENDING',
      limit: req.query.limit,
    });
    return res.json(candidates);
  } catch (err) {
    return sendError(res, err, 'Impossible de charger les applications candidates.');
  }
});

router.post('/candidates/:id/promote', requireSuperAdmin, async (req, res) => {
  try {
    const result = await promoteApplicationCandidate(req.params.id, req.body || {});
    return res.json(result);
  } catch (err) {
    return sendError(res, err, 'Impossible d’ajouter l’application au catalogue.');
  }
});

router.post('/candidates/:id/ignore', requireSuperAdmin, async (req, res) => {
  try {
    const candidate = await ignoreApplicationCandidate(req.params.id);
    return res.json(candidate);
  } catch (err) {
    return sendError(res, err, 'Impossible d’ignorer l’application candidate.');
  }
});

// ── Déclaration par ticket ──────────────────────────────────────────────────

// État du module pour un ticket : le frontend s'en sert pour décider d'ouvrir
// la modale avant d'envoyer le PATCH de statut.
router.get('/ticket/:ticketId', async (req, res) => {
  try {
    const state = await getProvisioningState(req.params.ticketId, req.user);
    return res.json(state);
  } catch (err) {
    return sendError(res, err, 'Impossible de charger l’état de la déclaration.');
  }
});

// Pré-remplissage IA (jamais bloquant) : applications probables + comptes suggérés.
router.get('/ticket/:ticketId/prefill', async (req, res) => {
  try {
    if (!canDeclare(req.user)) return res.status(403).json({ error: 'Accès refusé.' });
    // `force=1` : utilisé par le pré-vol de résolution pour obtenir une vraie
    // analyse (l'IA est sollicitée même si le pré-filtre déterministe ne voit
    // aucun mot-clé « compte »).
    const force = req.query.force === '1' || req.query.force === 'true';
    const suggestion = await suggestProvisioning({ ticketId: req.params.ticketId, user: req.user, force });

    // File de validation : les noms hors catalogue sont conservés pour que le
    // SUPERADMIN puisse enrichir le référentiel. Jamais bloquant.
    try {
      if (Array.isArray(suggestion.ignoredApplications) && suggestion.ignoredApplications.length > 0) {
        await recordApplicationCandidates(suggestion.ignoredApplications, {
          ticketId: Number(req.params.ticketId) || null,
        });
      }
    } catch (err) {
      console.error('[account-provisioning] enregistrement des candidats:', err.message);
    }

    return res.json(suggestion);
  } catch (err) {
    return sendError(res, err, 'Impossible de générer la proposition de pré-remplissage.');
  }
});

router.post('/ticket/:ticketId', async (req, res) => {
  try {
    if (!canDeclare(req.user)) return res.status(403).json({ error: 'Accès refusé.' });

    const { accounts, noAccountCreated, source, aiConfidence, prefillMeta } = req.body || {};
    const result = await saveProvisioningRecord({
      ticketId: req.params.ticketId,
      accounts,
      noAccountCreated: Boolean(noAccountCreated),
      source,
      aiConfidence,
      prefillMeta,
      user: req.user,
      ipAddress: req.ip,
    });
    return res.status(result.replayed ? 200 : 201).json(result);
  } catch (err) {
    return sendError(res, err);
  }
});

// ── Administration / supervision ────────────────────────────────────────────

// Indicateurs de qualité du pré-remplissage (applications acceptées/corrigées,
// applications hors catalogue récurrentes). Réservé à la supervision.
router.get('/stats', requirePermission('automation.manage'), async (req, res) => {
  try {
    const stats = await getProvisioningStats({ sampleSize: Number(req.query.sampleSize) || 500 });
    return res.json(stats);
  } catch (err) {
    return sendError(res, err, 'Impossible de calculer les indicateurs du module.');
  }
});

router.get('/records', requirePermission('automation.manage'), async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
    const where = {};
    if (req.query.status) where.budibaseStatus = String(req.query.status);
    if (req.query.applicationId) where.applicationId = Number(req.query.applicationId);
    if (req.query.ticketId) where.ticketId = Number(req.query.ticketId);
    if (req.query.source) where.source = String(req.query.source);

    const [records, total] = await Promise.all([
      prisma.accountProvisioningRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          ticket: { select: { id: true, title: true, status: true } },
          createdBy: { select: { id: true, fullName: true, email: true } },
        },
      }),
      prisma.accountProvisioningRecord.count({ where }),
    ]);

    return res.json({
      records,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    return sendError(res, err, 'Impossible de charger les déclarations.');
  }
});

router.post('/records/:id/retry', requirePermission('automation.manage'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Identifiant invalide.' });
    const record = await syncRecordToBudibase(id);
    return res.json(record);
  } catch (err) {
    return sendError(res, err, 'Impossible de relancer la synchronisation Budibase.');
  }
});

// Relance globale (bouton de supervision ; le scheduler fait la même chose en tâche de fond).
router.post('/records/retry-pending', requireSuperAdmin, async (req, res) => {
  try {
    const result = await retryPendingBudibase(Number(req.body?.limit) || 20);
    return res.json(result);
  } catch (err) {
    return sendError(res, err, 'Impossible de relancer les synchronisations en attente.');
  }
});

module.exports = router;
