const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { syncLocationsFromGlpi, createGlpiLocation, updateGlpiLocation } = require('../services/glpiTicketCreator');
const { auditLog } = require('../services/auditLogService');

const router = express.Router();
router.use(authenticate);

// Liste tous les lieux (GLPI + customs)
router.get('/', async (req, res) => {
  const { active, search } = req.query;
  const where = {};
  if (active === 'true') where.isActive = true;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { completename: { contains: search, mode: 'insensitive' } },
      { town: { contains: search, mode: 'insensitive' } },
    ];
  }

  const locations = await prisma.glpiLocation.findMany({
    where,
    orderBy: [{ isCustom: 'asc' }, { completename: 'asc' }],
    include: {
      _count: { select: { requesterLinks: true } },
    },
  });
  res.json(locations);
});

// Créer un lieu custom (et le push vers GLPI si configuré)
router.post(
  '/',
  requirePermission('locations.manage', ['ADMIN', 'HOTLINE']),
  [body('name').notEmpty().trim()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, completename, address, postcode, town, country, building, room } = req.body;

    const existing = await prisma.glpiLocation.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) return res.status(409).json({ error: 'Un lieu avec ce nom existe déjà' });

    let glpiLocationId = null;
    try {
      glpiLocationId = await createGlpiLocation({ name, completename, address, postcode, town, country, building, room });
    } catch (err) {
      console.error('[location.routes] Échec création lieu GLPI:', err.message);
    }

    const location = await prisma.glpiLocation.create({
      data: {
        name,
        completename: completename || name,
        glpiLocationId: glpiLocationId || null,
        isCustom: true,
        address: address || null,
        postcode: postcode || null,
        town: town || null,
        country: country || null,
        building: building || null,
        room: room || null,
      },
    });

    res.status(201).json({
      ...location,
      glpiSyncStatus: glpiLocationId ? 'synced' : 'pending',
    });

    auditLog('LOCATION_CREATED', { actor: req.user, targetType: 'GlpiLocation', targetId: location.id, targetLabel: name, metadata: { glpiLocationId, town } }).catch(() => {});
  }
);

// Modifier un lieu
router.patch(
  '/:id',
  requirePermission('locations.manage', ['ADMIN', 'HOTLINE']),
  async (req, res) => {
    const id = Number(req.params.id);
    const { name, completename, address, postcode, town, country, building, room, isActive } = req.body;

    const existing = await prisma.glpiLocation.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Lieu introuvable' });

    const data = {};
    if (name !== undefined) data.name = name;
    if (completename !== undefined) data.completename = completename;
    if (address !== undefined) data.address = address;
    if (postcode !== undefined) data.postcode = postcode;
    if (town !== undefined) data.town = town;
    if (country !== undefined) data.country = country;
    if (building !== undefined) data.building = building;
    if (room !== undefined) data.room = room;
    if (isActive !== undefined) data.isActive = isActive;

    // Push les modifs vers GLPI si le lieu est synced
    if (existing.glpiLocationId && Object.keys(data).some((k) => k !== 'isActive')) {
      try {
        await updateGlpiLocation(existing.glpiLocationId, data);
      } catch (err) {
        console.error('[location.routes] Échec mise à jour lieu GLPI:', err.message);
      }
    }

    const location = await prisma.glpiLocation.update({ where: { id }, data });
    res.json(location);
    auditLog('LOCATION_UPDATED', { actor: req.user, targetType: 'GlpiLocation', targetId: id, targetLabel: existing.name, metadata: { changedFields: Object.keys(data) } }).catch(() => {});
  }
);

// Supprimer (désactiver) un lieu
router.delete('/:id', requirePermission('locations.manage', ['ADMIN']), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.glpiLocation.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Lieu introuvable' });

  await prisma.glpiLocation.update({ where: { id }, data: { isActive: false } });
  await auditLog('LOCATION_DEACTIVATED', { actor: req.user, targetType: 'GlpiLocation', targetId: id, targetLabel: existing.name });
  res.status(204).send();
});

// Pousser un lieu custom vers GLPI (rattrapage si la création initiale a échoué)
router.post('/:id/push-to-glpi', requirePermission('locations.manage', ['ADMIN', 'HOTLINE']), async (req, res) => {
  const id = Number(req.params.id);
  const location = await prisma.glpiLocation.findUnique({ where: { id } });
  if (!location) return res.status(404).json({ error: 'Lieu introuvable' });
  if (location.glpiLocationId) return res.status(400).json({ error: 'Ce lieu est déjà synchronisé avec GLPI' });

  try {
    const glpiLocationId = await createGlpiLocation({
      name: location.name,
      completename: location.completename,
      address: location.address,
      postcode: location.postcode,
      town: location.town,
      country: location.country,
      building: location.building,
      room: location.room,
    });

    await prisma.glpiLocation.update({ where: { id }, data: { glpiLocationId } });
    await auditLog('LOCATION_PUSHED_TO_GLPI', { actor: req.user, targetType: 'GlpiLocation', targetId: id, targetLabel: location.name, metadata: { glpiLocationId } });
    res.json({ glpiLocationId });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Erreur de push vers GLPI' });
  }
});

// Sync manuelle depuis GLPI
router.post('/sync-glpi', requirePermission('locations.manage', ['ADMIN']), async (req, res) => {
  try {
    const result = await syncLocationsFromGlpi();
    if (result === null) return res.status(422).json({ error: 'GLPI non configuré' });
    res.json({ synced: result });
    auditLog('LOCATIONS_SYNCED_FROM_GLPI', { actor: req.user, targetType: 'GlpiLocation', targetLabel: 'Synchronisation manuelle des lieux GLPI', metadata: { synced: result } }).catch(() => {});
  } catch (err) {
    res.status(502).json({ error: err.message || 'Erreur de synchronisation GLPI' });
  }
});

// ── Associations expéditeur ↔ lieu ─────────────────────────────────────

// Liste les associations expéditeur-lieu
router.get('/requesters', async (req, res) => {
  const { email } = req.query;
  const where = {};
  if (email) where.email = email.toLowerCase().trim();

  const links = await prisma.requesterLocation.findMany({
    where,
    include: {
      glpiLocation: { select: { id: true, name: true, completename: true, town: true } },
      assignedBy: { select: { id: true, fullName: true, email: true } },
    },
    orderBy: { lastUsedAt: 'desc' },
  });
  res.json(links);
});

// Associer manuellement un expéditeur à un lieu
router.post(
  '/requesters',
  requirePermission('locations.manage', ['ADMIN', 'HOTLINE']),
  [body('email').isEmail().normalizeEmail(), body('glpiLocationId').isInt()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const email = req.body.email.toLowerCase().trim();
    const glpiLocationId = Number(req.body.glpiLocationId);

    const location = await prisma.glpiLocation.findUnique({ where: { id: glpiLocationId } });
    if (!location) return res.status(404).json({ error: 'Lieu introuvable' });

    const link = await prisma.requesterLocation.upsert({
      where: { email_glpiLocationId: { email, glpiLocationId } },
      update: {
        assignmentCount: { increment: 1 },
        lastUsedAt: new Date(),
        assignedById: req.user.sub,
      },
      create: {
        email,
        glpiLocationId,
        assignedById: req.user.sub,
      },
      include: {
        glpiLocation: { select: { id: true, name: true, completename: true } },
      },
    });

    res.status(201).json(link);
  }
);

// Supprimer une association
router.delete('/requesters/:id', requirePermission('locations.manage', ['ADMIN']), async (req, res) => {
  const id = Number(req.params.id);
  await prisma.requesterLocation.delete({ where: { id } }).catch(() => {});
  res.status(204).send();
});

module.exports = router;
