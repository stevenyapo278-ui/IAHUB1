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

// Helper : cherche un item par nom dans le nouveau GLPI (évite les doublons en re-run)
async function findItemByName(baseUrl, sessionToken, appToken, endpoint, name) {
  const encoded = encodeURIComponent(name);
  const url = `${baseUrl}/${endpoint.replace(/^\/+/, '')}?range=0-100&is_deleted=0&searchText=${encoded}&criteria[0][field]=name&criteria[0][searchtype]=equals&criteria[0][value]=${encoded}`;
  try {
    const res = await fetch(url, {
      headers: { 'App-Token': appToken, 'Session-Token': sessionToken },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => []);
    const items = Array.isArray(data) ? data : data.data || [];
    return items.length > 0 ? items[0] : null;
  } catch {
    return null;
  }
}

// Helper : récupère tous les items d'un endpoint GLPI avec pagination
async function fetchAllItems(baseUrl, sessionToken, appToken, endpoint) {
  const PAGE_SIZE = 100;
  const allItems = [];
  let offset = 0;
  while (true) {
    const url = `${baseUrl}/${endpoint.replace(/^\/+/, '')}?range=${offset}-${offset + PAGE_SIZE - 1}`;
    let res;
    try {
      res = await fetch(url, {
        headers: { 'App-Token': appToken, 'Session-Token': sessionToken },
      });
    } catch (e) {
      throw new Error(`GET ${url} — ${e.message}`);
    }
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
  const url = `${baseUrl}/${endpoint.replace(/^\/+/, '')}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'App-Token': appToken,
        'Session-Token': sessionToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input }),
    });
  } catch (e) {
    throw new Error(`POST ${url} — ${e.message}`);
  }
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
    let sessionRes;
    try {
      sessionRes = await fetch(`${baseUrl}/initSession`, {
        headers: { 'App-Token': appToken, Authorization: `user_token ${userToken}` },
      });
    } catch (e) {
      throw new Error(`Ancien GLPI inaccessible (${baseUrl}/initSession): ${e.message}`);
    }
    if (!sessionRes.ok) throw new Error(`Impossible de se connecter à l'ancien GLPI (${baseUrl}): ${sessionRes.status}`);
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

// ── Helpers internes à la migration ────────────────────────────────────────

async function migrateEntityType({ oldUrl, oldSession, oldAppToken, newUrl, newSession, newAppToken, endpoint, filter, buildInput, idMapKey, label, findExisting }) {
  let items;
  try {
    items = await fetchAllItems(oldUrl, oldSession, oldAppToken, endpoint);
  } catch (e) {
    return { idMapKey, results: [], fetchError: `${label} (fetch depuis ancien GLPI): ${e.message}` };
  }
  const results = [];
  for (const item of items) {
    if (filter && !filter(item)) continue;
    try {
      // Éviter les doublons en re-run : chercher si l'entité existe déjà dans le nouveau GLPI
      let newId = null;
      if (findExisting) {
        const existing = await findExisting(item);
        if (existing) {
          newId = existing.id;
        }
      }
      if (!newId) {
        newId = await createItem(newUrl, newSession, newAppToken, endpoint, buildInput(item));
      }
      results.push({ oldId: item.id, newId });
    } catch (e) {
      results.push({ oldId: item.id, error: `${label} #${item.id}: ${e.message}` });
    }
  }
  return { idMapKey, results };
}

function buildIdMap(migratedTypes) {
  const idMap = { users: {}, categories: {}, locations: {}, groups: {} };
  const errors = [];
  for (const { idMapKey, results, fetchError } of migratedTypes) {
    if (fetchError) {
      errors.push(fetchError);
      continue;
    }
    for (const r of results) {
      if (r.error) {
        errors.push(r.error);
      } else {
        idMap[idMapKey][r.oldId] = r.newId;
      }
    }
  }
  return { idMap, errors };
}

async function applyIdMapToErp(idMap) {
  const errors = [];

  async function migrateIdField({ model, uniqueField, oldId, newId, label }) {
    // 1. Vérifier si l'ancien ID existe dans l'ERP
    const record = await model.findUnique({ where: { [uniqueField]: Number(oldId) } });
    if (!record) return;

    // 2. Vérifier si le nouvel ID est déjà pris par un AUTRE enregistrement
    const conflict = await model.findUnique({ where: { [uniqueField]: newId } }).catch(() => null);
    if (conflict && conflict.id !== record.id) {
      errors.push(`${label} ${oldId}→${newId}: conflit avec #${conflict.id}`);
      return;
    }

    // 3. Appliquer la mise à jour
    await model.update({ where: { id: record.id }, data: { [uniqueField]: newId } });
  }

  for (const [oldId, newId] of Object.entries(idMap.users)) {
    await migrateIdField({ model: prisma.user, uniqueField: 'glpiId', oldId, newId, label: 'Utilisateur' });
  }
  for (const [oldId, newId] of Object.entries(idMap.locations)) {
    await migrateIdField({ model: prisma.glpiLocation, uniqueField: 'glpiLocationId', oldId, newId, label: 'Lieu' });
  }
  for (const [oldId, newId] of Object.entries(idMap.groups)) {
    await migrateIdField({ model: prisma.team, uniqueField: 'glpiGroupId', oldId, newId, label: 'Groupe' });
  }
  for (const [oldId, newId] of Object.entries(idMap.categories)) {
    await migrateIdField({ model: prisma.ticketCategory, uniqueField: 'glpiCategoryId', oldId, newId, label: 'Catégorie' });
  }

  return errors;
}

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
      // ── 1. Lire l'ancienne config ──
      const oldConfig = await prisma.apiConfig.findUnique({ where: { serviceName: 'glpi' } });
      if (!oldConfig || !oldConfig.isActive) {
        return res.status(422).json({ error: 'Ancien GLPI non configuré ou inactif' });
      }
      const oldUrl = oldConfig.baseUrl.replace(/\/+$/, '');
      const oldAppToken = oldConfig.extra?.appToken;
      const oldUserToken = oldConfig.apiKey;

      // ── 2. Connexion aux deux GLPI en parallèle ──
      const [oldSettled, newSettled] = await Promise.allSettled([
        fetch(`${oldUrl}/initSession`, {
          headers: { 'App-Token': oldAppToken, Authorization: `user_token ${oldUserToken}` },
        }),
        fetch(`${newUrl}/initSession`, {
          headers: { 'App-Token': newAppToken, Authorization: `user_token ${newUserToken}` },
        }),
      ]);
      if (oldSettled.status === 'rejected') throw new Error(`Ancien GLPI inaccessible (${oldUrl}): ${oldSettled.reason?.message}`);
      if (newSettled.status === 'rejected') throw new Error(`Nouveau GLPI inaccessible (${newUrl}): ${newSettled.reason?.message}`);
      const oldSessionRes = oldSettled.value;
      const newSessionRes = newSettled.value;
      if (!oldSessionRes.ok) throw new Error(`Connexion à l'ancien GLPI impossible (${oldUrl}): ${oldSessionRes.status}`);
      if (!newSessionRes.ok) throw new Error(`Connexion au nouveau GLPI impossible (${newUrl}): ${newSessionRes.status}`);
      const { session_token: oldSession } = await oldSessionRes.json();
      const { session_token: newSession } = await newSessionRes.json();

      try {
        // ── 3. Migrer tous les types d'entités en parallèle ──
        const migratedTypes = await Promise.all([
          migrateEntityType({
            oldUrl, oldSession, oldAppToken, newUrl, newSession, newAppToken,
            endpoint: 'User', idMapKey: 'users',
            filter: (u) => u.name || u.realname || u.firstname,
            buildInput: (u) => ({
              name: u.name || `user_${u.id}`,
              realname: u.realname || '',
              firstname: u.firstname || '',
              email: (u.name?.includes('@') ? u.name : `${u.name || u.id}@migrated.local`),
              is_active: 1,
            }),
            findExisting: (u) => findItemByName(newUrl, newSession, newAppToken, 'User', u.name || u.realname || u.firstname),
            label: 'Utilisateur',
          }),
          migrateEntityType({
            oldUrl, oldSession, oldAppToken, newUrl, newSession, newAppToken,
            endpoint: 'ITILCategory', idMapKey: 'categories',
            filter: (c) => c.name,
            buildInput: (c) => ({
              name: c.name,
              completename: c.completename || c.name,
              comment: c.comment || '',
            }),
            findExisting: (c) => findItemByName(newUrl, newSession, newAppToken, 'ITILCategory', c.name),
            label: 'Catégorie',
          }),
          migrateEntityType({
            oldUrl, oldSession, oldAppToken, newUrl, newSession, newAppToken,
            endpoint: 'Location', idMapKey: 'locations',
            filter: (l) => l.name || l.completename,
            buildInput: (l) => ({
              name: l.name || l.completename,
              completename: l.completename || l.name,
              address: l.address || '',
              postcode: l.postcode || '',
              town: l.town || '',
              country: l.country || '',
              building: l.building || '',
              room: l.room || '',
            }),
            findExisting: (l) => findItemByName(newUrl, newSession, newAppToken, 'Location', l.name || l.completename),
            label: 'Lieu',
          }),
          migrateEntityType({
            oldUrl, oldSession, oldAppToken, newUrl, newSession, newAppToken,
            endpoint: 'Group', idMapKey: 'groups',
            filter: (g) => g.name,
            buildInput: (g) => ({
              name: g.name,
              comment: g.comment || '',
              is_requester: g.is_requester ?? 1,
              is_assign: g.is_assign ?? 1,
              is_task: g.is_task ?? 1,
              is_notify: g.is_notify ?? 1,
            }),
            findExisting: (g) => findItemByName(newUrl, newSession, newAppToken, 'Group', g.name),
            label: 'Groupe',
          }),
        ]);

        const { idMap, errors: migErrors } = buildIdMap(migratedTypes);
        const totalMigrated =
          Object.keys(idMap.users).length +
          Object.keys(idMap.categories).length +
          Object.keys(idMap.locations).length +
          Object.keys(idMap.groups).length;
        const results = {
          users: Object.keys(idMap.users).length,
          categories: Object.keys(idMap.categories).length,
          locations: Object.keys(idMap.locations).length,
          groups: Object.keys(idMap.groups).length,
          errors: migErrors,
        };

        if (totalMigrated === 0 && migErrors.length > 0) {
          throw new Error(`Aucune entité migrée — premiers erreurs: ${migErrors.slice(0, 3).join('; ')}`);
        }

        // ── 4. Sauvegarder la config actuelle pour rollback ──
        const configBackup = {
          baseUrl: oldConfig.baseUrl,
          apiKey: oldConfig.apiKey,
          extra: { ...oldConfig.extra },
        };

        // ── 5. Basculer la config vers le nouveau GLPI ──
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
              dateFrom: oldConfig.extra?.dateFrom || null,
              dateTo: oldConfig.extra?.dateTo || null,
            },
          },
        });

        // ── 6. Mettre à jour les IDs ERP via l'idMap (au lieu de tout détruire) ──
        let idMapErrors;
        try {
          idMapErrors = await applyIdMapToErp(idMap);
          if (idMapErrors.length > 0) {
            results.errors.push(...idMapErrors);
          }
        } catch (applyErr) {
          // Rollback : restaurer l'ancienne config
          await prisma.apiConfig.update({
            where: { serviceName: 'glpi' },
            data: configBackup,
          }).catch(() => {});
          throw new Error(`Échec mise à jour des IDs ERP — config restaurée: ${applyErr.message}`);
        }

        // ── 7. Détacher les tickets ERP de l'ancien GLPI (non migrés) ──
        const detachTickets = await prisma.ticket.updateMany({
          where: { glpiTicketId: { not: null } },
          data: { glpiTicketId: null },
        });

        // ── 8. Post-migration : synchroniser depuis le nouveau GLPI ──
        try {
          const [syncedLocs, syncedUsers] = await Promise.allSettled([
            syncLocationsFromGlpi(),
            syncUsersFromGlpi({ createMissing: false }),
          ]);
          results.postSync = {
            locations: syncedLocs.status === 'fulfilled' ? syncedLocs.value : -1,
            users: syncedUsers.status === 'fulfilled' ? syncedUsers.value : -1,
          };
          if (syncedLocs.status === 'rejected') results.errors.push(`Synchro lieux: ${syncedLocs.reason?.message}`);
          if (syncedUsers.status === 'rejected') results.errors.push(`Synchro utilisateurs: ${syncedUsers.reason?.message}`);
        } catch (syncErr) {
          results.errors.push(`Synchro post-migration: ${syncErr.message}`);
        }

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
