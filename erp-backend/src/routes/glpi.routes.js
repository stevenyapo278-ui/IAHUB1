const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { syncGlpiTickets, fullReimportFromGlpi, getActiveGlpiConfig, glpiInitSession, glpiKillSession } = require('../utils/glpiSync');
const { syncLocationsFromGlpi, syncUsersFromGlpi, getImportableGlpiUsers, importGlpiUsers } = require('../services/glpiTicketCreator');

const router = express.Router();
router.use(authenticate);

// Liste les instances GLPI configurées
router.get('/instances', requirePermission('glpi.manage', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const configs = await prisma.apiConfig.findMany({
    where: { serviceName: { in: ['glpi', 'glpi_dev'] } },
    select: { serviceName: true, baseUrl: true, isActive: true, extra: true },
  });

  const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });

  res.json({
    instances: configs.map((c) => ({
      id: c.serviceName,
      label: c.serviceName === 'glpi' ? 'GLPI Production' : 'GLPI Développement',
      baseUrl: c.baseUrl,
      isActive: c.isActive,
      isConfigured: !!(c.baseUrl && c.extra?.appToken),
    })),
    activeInstance: settings?.activeGlpiInstance || 'glpi',
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
      if (!result) {
        return res.status(422).json({ error: 'GLPI non configuré ou inactif' });
      }
      return res.json(result);
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
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Erreur de synchronisation des lieux GLPI' });
  }
});

// Synchronisation des "Utilisateurs" depuis GLPI — met à jour le glpiId sur les comptes ERP
// existants en les rapprochant par email ou par nom. Appelée manuellement depuis les réglages.
// Body optionnel { createMissing: true } pour créer automatiquement les comptes manquants.
router.post('/sync-users', requirePermission('glpi.manage', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  try {
    const createMissing = req.body?.createMissing === true;
    const result = await syncUsersFromGlpi({ createMissing });
    if (result === null) {
      return res.status(422).json({ error: 'GLPI non configuré' });
    }
    return res.json({ synced: result });
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

// Récupère la liste des catégories synchronisées depuis GLPI (table TicketCategory)
// pour le sélecteur de catégorie dynamique dans le formulaire de ticket.
router.get('/categories', async (req, res) => {
  const categories = await prisma.ticketCategory.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, glpiCategoryId: true, name: true },
  });
  res.json(categories);
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
