const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { syncGlpiTickets, fullReimportFromGlpi, getActiveGlpiConfig, glpiInitSession, glpiKillSession } = require('../utils/glpiSync');
const { syncLocationsFromGlpi, syncUsersFromGlpi, getImportableGlpiUsers, importGlpiUsers } = require('../services/glpiTicketCreator');
const { auditLog } = require('../services/auditLogService');
const cacheStore = require('../services/cacheStore');

const router = express.Router();
router.use(authenticate);

// Liste l'instance GLPI configurée
router.get('/instances', requirePermission('glpi.manage', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const configs = await prisma.apiConfig.findMany({
    where: { serviceName: 'glpi' },
    select: { serviceName: true, baseUrl: true, isActive: true, extra: true },
  });

  res.json({
    instances: configs.map((c) => ({
      id: c.serviceName,
      label: 'GLPI Production',
      baseUrl: c.baseUrl,
      isActive: c.isActive,
      isConfigured: !!(c.baseUrl && c.extra?.appToken),
    })),
    activeInstance: 'glpi',
  });
});

// Sync standard (incrémental)
router.post('/sync', requirePermission('glpi.manage', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  try {
    const result = await syncGlpiTickets();
    if (!result) {
      return res.status(422).json({ error: 'GLPI non configuré ou inactif' });
    }
    return res.json(result);
    auditLog('GLPI_TICKETS_SYNCED', { actor: req.user, targetType: 'Ticket', targetLabel: 'Synchronisation incrémentale GLPI', metadata: result }).catch(() => {});
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Erreur de synchronisation GLPI' });
  }
});

// Réimport complet depuis GLPI (supprime les tickets GLPI-syncés de l'ERP, puis réimporte)
// body.dateFrom : YYYY-MM-DD (optionnel)
// body.dateTo   : YYYY-MM-DD (optionnel)
router.post(
  '/reimport',
  requirePermission('glpi.manage', ['ADMIN', 'TECHNICIAN']),
  [
    body('dateFrom').optional({ nullable: true }).isISO8601().withMessage('Format YYYY-MM-DD requis'),
    body('dateTo').optional({ nullable: true }).isISO8601().withMessage('Format YYYY-MM-DD requis'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { dateFrom, dateTo } = req.body;
      const result = await fullReimportFromGlpi({ dateFrom, dateTo });
      // Le réimport réécrit aussi les utilisateurs : invalide leur liste mise en cache
      cacheStore.clear('GET /api/users');
      return res.json(result);
      auditLog('GLPI_TICKETS_SYNCED', { actor: req.user, targetType: 'Ticket', targetLabel: 'Réimport complet GLPI', metadata: { dateFrom, dateTo, ...result } }).catch(() => {});
    } catch (err) {
      return res.status(502).json({ error: err.message || 'Erreur de réimport GLPI' });
    }
  }
);

// Synchronisation des "Lieux" depuis GLPI — stocke les locations dans la table GlpiLocation
// pour résoudre les locations_id des tickets en noms de lieux complets. Appelée automatiquement
// avant les syncs de tickets, mais peut être déclenchée manuellement depuis les réglages.
router.post('/sync-locations', requirePermission('glpi.manage', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  try {
    const result = await syncLocationsFromGlpi();
    if (result === null) {
      return res.status(422).json({ error: 'GLPI non configuré' });
    }
    return res.json({ synced: result });
    auditLog('GLPI_LOCATIONS_SYNCED', { actor: req.user, targetType: 'GlpiLocation', targetLabel: 'Synchronisation des lieux GLPI', metadata: { synced: result } }).catch(() => {});
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Erreur de synchronisation des lieux GLPI' });
  }
});

// Synchronisation des "Utilisateurs" depuis GLPI — crée ou met à jour les comptes ERP
// depuis GLPI / Active Directory. Par défaut createMissing est true.
router.post('/sync-users', requirePermission('glpi.manage', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  try {
    const createMissing = req.body?.createMissing !== false;
    const result = await syncUsersFromGlpi({ createMissing });
    if (result === null) {
      return res.status(422).json({ error: 'GLPI non configuré' });
    }
    return res.json({ synced: result });
    auditLog('GLPI_USERS_SYNCED', { actor: req.user, targetType: 'User', targetLabel: 'Synchronisation des utilisateurs GLPI', metadata: { synced: result } }).catch(() => {});
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Erreur de synchronisation des utilisateurs GLPI' });
  }
});

// Récupère la liste des utilisateurs ayant un glpiId (synchronisés avec GLPI)
// Pour les sélecteurs d'assignation et le mapping ERP ↔ GLPI.
router.get('/users', async (req, res) => {
  const users = await prisma.user.findMany({
    where: { glpiId: { not: null } },
    select: { id: true, glpiId: true, fullName: true, email: true },
    orderBy: { fullName: 'asc' },
  });
  res.json(users);
});

// Récupère la liste des lieux synchronisés depuis GLPI (table GlpiLocation)
// pour le sélecteur de lieu dans le formulaire de création de ticket.
router.get('/locations', async (req, res) => {
  const locations = await prisma.glpiLocation.findMany({
    orderBy: { completename: 'asc' },
    select: { id: true, glpiLocationId: true, name: true, completename: true, town: true, building: true, room: true },
  });
  res.json(locations);
});

// Récupère la liste des catégories (table TicketCategory) pour le sélecteur de catégorie
// dynamique dans le formulaire de ticket. Fonctionne en autonomie : les catégories peuvent être
// créées localement (isCustom=true) sans GLPI, ou synchronisées depuis GLPI (glpiCategoryId != null).
router.get('/categories', async (req, res) => {
  const categories = await prisma.ticketCategory.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, glpiCategoryId: true, name: true, isCustom: true, parentId: true },
  });
  res.json(categories);
});

// Crée une catégorie locale (mode autonome ou complément aux catégories GLPI),
// optionnellement en sous-catégorie d'une catégorie existante (parentId).
router.post('/categories', requirePermission('glpi.manage', ['ADMIN', 'TECHNICIAN']), [body('name').notEmpty().trim(), body('parentId').optional().isInt()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const name = req.body.name.trim();
  const parentId = req.body.parentId ? Number(req.body.parentId) : null;
  if (parentId) {
    const parent = await prisma.ticketCategory.findUnique({ where: { id: parentId } });
    if (!parent) return res.status(404).json({ error: 'Catégorie parente introuvable' });
  }

  try {
    const category = await prisma.ticketCategory.create({
      data: { name, isCustom: true, parentId }, // glpiCategoryId = null : catégorie purement locale
    });
    return res.status(201).json(category);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Une catégorie avec ce nom existe déjà' });
    throw err;
  }
});

// Renomme ou déplace une catégorie (locale ou GLPI). Empêche de créer un cycle
// (parent = soi-même ou un de ses descendants).
router.patch('/categories/:id', requirePermission('glpi.manage', ['ADMIN', 'TECHNICIAN']), [body('name').optional().notEmpty().trim(), body('parentId').optional({ nullable: true }).isInt()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const id = Number(req.params.id);
  const existing = await prisma.ticketCategory.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Catégorie introuvable' });

  const data = {};
  if (req.body.name !== undefined) data.name = req.body.name.trim();
  if (req.body.parentId !== undefined) {
    const parentId = req.body.parentId ? Number(req.body.parentId) : null;
    // Anti-cycle : le nouveau parent ne doit pas se trouver dans le sous-arbre de la catégorie
    // déplacée (sinon 7→8 et 8→7 formeraient une boucle). On parcourt les descendants de `id`
    // et on vérifie que parentId n'en fait pas partie.
    if (parentId && parentId !== id) {
      const all = await prisma.ticketCategory.findMany({ select: { id: true, parentId: true } });
      const children = new Map();
      for (const c of all) {
        if (!children.has(c.parentId)) children.set(c.parentId, []);
        children.get(c.parentId).push(c.id);
      }
      const stack = [...(children.get(id) || [])];
      const descendants = new Set();
      while (stack.length) {
        const cur = stack.pop();
        if (descendants.has(cur)) continue;
        descendants.add(cur);
        stack.push(...(children.get(cur) || []));
      }
      if (descendants.has(parentId)) {
        return res.status(400).json({ error: 'Une catégorie ne peut pas être déplacée sous l\'une de ses propres sous-catégories (cycle)' });
      }
    }
    data.parentId = parentId;
  }

  try {
    const category = await prisma.ticketCategory.update({ where: { id }, data });
    return res.json(category);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Une catégorie avec ce nom existe déjà' });
    throw err;
  }
});

// Supprime une catégorie. Refusée si la catégorie a des sous-catégories (les déplacer
// ou les supprimer d'abord). Les tickets existants conservent leur libellé (le champ
// category du ticket est une chaîne, pas une clé étrangère).
router.delete('/categories/:id', requirePermission('glpi.manage', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.ticketCategory.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Catégorie introuvable' });

  const children = await prisma.ticketCategory.count({ where: { parentId: id } });
  if (children > 0) {
    return res.status(400).json({ error: `Impossible de supprimer : ${children} sous-catégorie(s) dépendent de celle-ci` });
  }

  await prisma.ticketCategory.delete({ where: { id } });
  return res.json({ deleted: true });
});

// Récupère la liste des utilisateurs GLPI non encore importés dans l'ERP
// pour le bouton "Importer de GLPI" dans la vue utilisateurs.
router.get('/importable-users', requirePermission('glpi.manage', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  try {
    const glpiUsers = await getImportableGlpiUsers();
    return res.json(glpiUsers);
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Erreur de récupération des utilisateurs GLPI' });
  }
});

// Importe sélectivement des utilisateurs GLPI dans l'ERP (body: { userIds: [1,2,3] })
// Crée les comptes avec mot de passe aléatoire + mustChangePassword: true.
router.post('/import-users', requirePermission('glpi.manage', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  try {
    const { userIds } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'La liste userIds est requise' });
    }
    const result = await importGlpiUsers(userIds);
    // La liste des utilisateurs est mise en cache (TTL 30s) : on l'invalide après l'import
    cacheStore.clear('GET /api/users');
    return res.json(result);
  } catch (err) {
    return res.status(502).json({ error: err.message || "Erreur d'import des utilisateurs GLPI" });
  }
});

// Proxy un document GLPI (image, PDF, etc.) via l'API REST — utilisé pour les URLs d'images
// embarquées dans les suivis (ITILFollowup) qui contiennent des références à des documents
// GLPI. Sans ce proxy, ces images seraient brisées dans l'ERP car les URLs originales
// pointent vers l'interface web de GLPI, inaccessible depuis le navigateur de l'utilisateur.
// Le document est téléchargé depuis GLPI et renvoyé avec son Content-Type original.
router.get('/document/:docId/file', requirePermission('tickets.view', ['ADMIN', 'TECHNICIAN', 'REQUESTER']), async (req, res) => {
  const docId = Number(req.params.docId);
  if (!docId) return res.status(400).json({ error: 'docId invalide' });

  // Cherche le document dans nos pièces jointes pour vérifier qu'il existe bien
  const attachment = await prisma.ticketAttachment.findFirst({
    where: { glpiDocumentId: docId },
  });

  const config = await getActiveGlpiConfig();
  if (!config) return res.status(422).json({ error: 'GLPI non configuré' });

  const sessionToken = await glpiInitSession(config);
  try {
    const fileRes = await fetch(
      `${config.baseUrl}/Document/${docId}?alt=media`,
      { headers: { 'App-Token': config.appToken, 'Session-Token': sessionToken } }
    );
    if (!fileRes.ok) return res.status(502).json({ error: 'Téléchargement GLPI échoué' });

    res.setHeader('Content-Type', attachment?.mimeType || fileRes.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Content-Disposition', attachment?.filename ? `inline; filename="${attachment.filename}"` : 'inline');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    return res.send(buffer);
  } finally {
    await glpiKillSession(config, sessionToken);
  }
});

module.exports = router;
