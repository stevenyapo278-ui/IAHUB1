const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { syncGlpiTickets, fullReimportFromGlpi, getActiveGlpiConfig, glpiInitSession, glpiKillSession } = require('../utils/glpiSync');
const { syncLocationsFromGlpi, syncUsersFromGlpi, getImportableGlpiUsers, importGlpiUsers } = require('../services/glpiTicketCreator');
const { auditLog } = require('../services/auditLogService');

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

// ──────────────────────────────────────────────────────────────────────────────
// MIGRATION VERS UNE NOUVELLE INSTANCE GLPI
// ──────────────────────────────────────────────────────────────────────────────

// Helper : récupère tous les items d'un endpoint GLPI avec pagination
async function fetchAllItems(baseUrl, sessionToken, appToken, endpoint) {
  const PAGE_SIZE = 100;
  const allItems = [];
  let offset = 0;
  while (true) {
    const url = `${baseUrl}/${endpoint.replace(/^\/+/, '')}?range=${offset}-${offset + PAGE_SIZE - 1}`;
    const res = await fetch(url, {
      headers: { 'App-Token': appToken, 'Session-Token': sessionToken },
    });
    if (!res.ok) break;
    const data = await res.json().catch(() => []);
    const items = Array.isArray(data) ? data : data.data || [];
    if (items.length === 0) break;
    allItems.push(...items);
    if (items.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return allItems;
}

// Helper : crée un item dans GLPI via POST /:endpoint
async function createItem(baseUrl, sessionToken, appToken, endpoint, input) {
  const res = await fetch(`${baseUrl}/${endpoint.replace(/^\/+/, '')}`, {
    method: 'POST',
    headers: {
      'App-Token': appToken,
      'Session-Token': sessionToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GLPI création ${endpoint} échoué (${res.status}): ${body.slice(0, 200)}`);
  }
  const rawBody = await res.text();
  const parsed = JSON.parse(rawBody);
  return parsed.id || (Array.isArray(parsed) ? parsed[0]?.id : null);
}

// Aperçu des données à migrer depuis l'ancien GLPI
router.get('/migration-preview', requirePermission('glpi.manage', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  try {
    const config = await prisma.apiConfig.findUnique({ where: { serviceName: 'glpi' } });
    if (!config || !config.isActive || !config.baseUrl || !config.apiKey || !config.extra?.appToken) {
      return res.status(422).json({ error: 'GLPI actuel non configuré ou inactif' });
    }

    const baseUrl = config.baseUrl.replace(/\/+$/, '');
    const appToken = config.extra.appToken;
    const userToken = config.apiKey;

    // Init session
    const sessionRes = await fetch(`${baseUrl}/initSession`, {
      headers: { 'App-Token': appToken, Authorization: `user_token ${userToken}` },
    });
    if (!sessionRes.ok) throw new Error('Impossible de se connecter à l\'ancien GLPI');
    const { session_token } = await sessionRes.json();

    try {
      // Récupérer les compteurs
      const [users, categories, locations, groups] = await Promise.all([
        fetchAllItems(baseUrl, session_token, appToken, 'User'),
        fetchAllItems(baseUrl, session_token, appToken, 'ITILCategory'),
        fetchAllItems(baseUrl, session_token, appToken, 'Location'),
        fetchAllItems(baseUrl, session_token, appToken, 'Group'),
      ]);

      // Compter les items valides (avec un nom)
      const validUsers = users.filter((u) => u.name || u.realname || u.firstname);
      const validCategories = categories.filter((c) => c.name);
      const validLocations = locations.filter((l) => l.name || l.completename);
      const validGroups = groups.filter((g) => g.name);

      return res.json({
        oldGlpiUrl: baseUrl,
        users: validUsers.length,
        categories: validCategories.length,
        locations: validLocations.length,
        groups: validGroups.length,
        erpTickets: await prisma.ticket.count({ where: { glpiTicketId: { not: null } } }),
      });
    } finally {
      await fetch(`${baseUrl}/killSession`, {
        headers: { 'App-Token': appToken, 'Session-Token': session_token },
      }).catch(() => {});
    }
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Erreur de prévisualisation' });
  }
});

// LANCER LA MIGRATION : lit depuis l'ancien GLPI, crée dans le nouveau, met à jour l'ERP
router.post(
  '/migrate',
  requirePermission('glpi.manage', ['ADMIN', 'TECHNICIAN']),
  [
    body('newBaseUrl').notEmpty().withMessage('URL du nouveau GLPI requise'),
    body('newAppToken').notEmpty().withMessage('App Token du nouveau GLPI requis'),
    body('newUserToken').notEmpty().withMessage('User Token du nouveau GLPI requis'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { newBaseUrl, newAppToken, newUserToken } = req.body;
    const newUrl = newBaseUrl.replace(/\/+$/, '');

    try {
      // ── 1. Connexion à l'ANCIEN GLPI ──
      const oldConfig = await prisma.apiConfig.findUnique({ where: { serviceName: 'glpi' } });
      if (!oldConfig || !oldConfig.isActive) {
        return res.status(422).json({ error: 'Ancien GLPI non configuré ou inactif' });
      }
      const oldUrl = oldConfig.baseUrl.replace(/\/+$/, '');
      const oldAppToken = oldConfig.extra?.appToken;
      const oldUserToken = oldConfig.apiKey;

      const oldSessionRes = await fetch(`${oldUrl}/initSession`, {
        headers: { 'App-Token': oldAppToken, Authorization: `user_token ${oldUserToken}` },
      });
      if (!oldSessionRes.ok) throw new Error('Connexion à l\'ancien GLPI impossible');
      const { session_token: oldSession } = await oldSessionRes.json();

      // ── 2. Connexion au NOUVEAU GLPI ──
      const newSessionRes = await fetch(`${newUrl}/initSession`, {
        headers: { 'App-Token': newAppToken, Authorization: `user_token ${newUserToken}` },
      });
      if (!newSessionRes.ok) throw new Error('Connexion au nouveau GLPI impossible — vérifiez les tokens');
      const { session_token: newSession } = await newSessionRes.json();

      const results = { users: 0, categories: 0, locations: 0, groups: 0, errors: [] };
      const idMap = { users: {}, categories: {}, locations: {}, groups: {} };

      try {
        // ── 3. MIGRATION DES UTILISATEURS ──
        const oldUsers = await fetchAllItems(oldUrl, oldSession, oldAppToken, 'User');
        for (const u of oldUsers) {
          if (!u.name && !u.realname && !u.firstname) continue;
          try {
            // Chercher si un utilisateur avec le même nom existe déjà dans le nouveau GLPI
            const newId = await createItem(newUrl, newSession, newAppToken, 'User', {
              name: u.name || `user_${u.id}`,
              realname: u.realname || '',
              firstname: u.firstname || '',
              email: (u.name?.includes('@') ? u.name : `${u.name || u.id}@migrated.local`),
              is_active: 1,
            });
            idMap.users[u.id] = newId;
            results.users++;
          } catch (e) {
            results.errors.push(`Utilisateur #${u.id} (${u.name || u.realname}): ${e.message}`);
          }
        }

        // ── 4. MIGRATION DES CATÉGORIES ──
        const oldCats = await fetchAllItems(oldUrl, oldSession, oldAppToken, 'ITILCategory');
        for (const c of oldCats) {
          if (!c.name) continue;
          try {
            const newId = await createItem(newUrl, newSession, newAppToken, 'ITILCategory', {
              name: c.name,
              completename: c.completename || c.name,
              comment: c.comment || '',
            });
            idMap.categories[c.id] = newId;
            results.categories++;
          } catch (e) {
            results.errors.push(`Catégorie #${c.id} (${c.name}): ${e.message}`);
          }
        }

        // ── 5. MIGRATION DES LIEUX ──
        const oldLocs = await fetchAllItems(oldUrl, oldSession, oldAppToken, 'Location');
        for (const l of oldLocs) {
          if (!l.name && !l.completename) continue;
          try {
            const newId = await createItem(newUrl, newSession, newAppToken, 'Location', {
              name: l.name || l.completename,
              completename: l.completename || l.name,
              address: l.address || '',
              postcode: l.postcode || '',
              town: l.town || '',
              country: l.country || '',
              building: l.building || '',
              room: l.room || '',
            });
            idMap.locations[l.id] = newId;
            results.locations++;
          } catch (e) {
            results.errors.push(`Lieu #${l.id} (${l.name}): ${e.message}`);
          }
        }

        // ── 6. MIGRATION DES GROUPES ──
        const oldGroups = await fetchAllItems(oldUrl, oldSession, oldAppToken, 'Group');
        for (const g of oldGroups) {
          if (!g.name) continue;
          try {
            const newId = await createItem(newUrl, newSession, newAppToken, 'Group', {
              name: g.name,
              comment: g.comment || '',
              is_requester: g.is_requester ?? 1,
              is_assign: g.is_assign ?? 1,
              is_task: g.is_task ?? 1,
              is_notify: g.is_notify ?? 1,
            });
            idMap.groups[g.id] = newId;
            results.groups++;
          } catch (e) {
            results.errors.push(`Groupe #${g.id} (${g.name}): ${e.message}`);
          }
        }

        // ── 7. METTRE À JOUR L'ERP ──
        // Détacher les liens vers l'ancien GLPI
        const detachTickets = await prisma.ticket.updateMany({
          where: { glpiTicketId: { not: null } },
          data: { glpiTicketId: null },
        });
        await prisma.team.updateMany({
          where: { glpiGroupId: { not: null } },
          data: { glpiGroupId: null },
        });
        await prisma.ticketCategory.deleteMany({});

        // Enregistrer les mappings old→new dans la config du nouveau GLPI
        await prisma.apiConfig.update({
          where: { serviceName: 'glpi' },
          data: {
            baseUrl: newUrl,
            apiKey: newUserToken,
            extra: {
              appToken: newAppToken,
              migrationIdMap: idMap,
              migratedFrom: oldUrl,
              migratedAt: new Date().toISOString(),
              dateFrom: null,
              dateTo: null,
            },
          },
        });

        results.detachedTickets = detachTickets.count;
        results.idMap = idMap;

        return res.json(results);
      } finally {
        await Promise.all([
          fetch(`${oldUrl}/killSession`, {
            headers: { 'App-Token': oldAppToken, 'Session-Token': oldSession },
          }).catch(() => {}),
          fetch(`${newUrl}/killSession`, {
            headers: { 'App-Token': newAppToken, 'Session-Token': newSession },
          }).catch(() => {}),
        ]);
      }
    } catch (err) {
      return res.status(502).json({ error: err.message || 'Erreur lors de la migration' });
    }
  }
);

module.exports = router;
