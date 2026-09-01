const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { auditLog } = require('../services/auditLogService');

const router = express.Router();
router.use(authenticate);

// Liste tous les lieux
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

// Créer un lieu
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

    const location = await prisma.glpiLocation.create({
      data: {
        name,
        completename: completename || name,
        isCustom: true,
        address: address || null,
        postcode: postcode || null,
        town: town || null,
        country: country || null,
        building: building || null,
        room: room || null,
      },
    });

    res.status(201).json(location);
    auditLog('LOCATION_CREATED', { actor: req.user, targetType: 'GlpiLocation', targetId: location.id, targetLabel: name, metadata: { town } }).catch(() => {});
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

    const location = await prisma.glpiLocation.update({ where: { id }, data });
    res.json(location);
    auditLog('LOCATION_UPDATED', { actor: req.user, targetType: 'GlpiLocation', targetId: id, targetLabel: existing.name, metadata: { changedFields: Object.keys(data) } }).catch(() => {});
  }
);



// ── Associations expéditeur ↔ lieu ─────────────────────────────────────

// Liste des demandeurs potentiels (utilisateurs ERP + expéditeurs d'emails connus)
// DOIT être AVANT /:id/requesters pour éviter le conflit de route
router.get('/potential-requesters', async (req, res) => {
  const { search } = req.query;
  const q = search?.trim().toLowerCase() || '';

  // 1. Utilisateurs ERP
  const userWhere = q ? {
    OR: [
      { fullName: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
    ],
  } : {};
  const users = await prisma.user.findMany({
    where: userWhere,
    select: { id: true, fullName: true, email: true, role: true },
    orderBy: { fullName: 'asc' },
    take: 50,
  });

  // 2. Expéditeurs d'emails connus (depuis les tickets/email entrants, distincts)
  const emailWhere = q ? {
    OR: [
      { fromEmail: { contains: q, mode: 'insensitive' } },
      { fromName: { contains: q, mode: 'insensitive' } },
    ],
  } : {};
  const knownEmails = await prisma.incomingEmail.groupBy({
    by: ['fromEmail'],
    where: emailWhere,
    _count: { fromEmail: true },
    _max: { fromName: true, receivedAt: true },
    orderBy: { _count: { fromEmail: 'desc' } },
    take: 50,
  });

  // 3. Combiner et dédupliquer
  const seen = new Set();
  const result = [];

  for (const u of users) {
    const key = u.email?.toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push({
        type: 'user',
        label: u.fullName || u.email,
        email: u.email,
        subLabel: u.role,
        id: u.id,
      });
    }
  }

  for (const e of knownEmails) {
    const key = e.fromEmail?.toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push({
        type: 'requester',
        label: e._max.fromName || e.fromEmail,
        email: e.fromEmail,
        subLabel: `${e._count.fromEmail} email(s) reçu(s)`,
        lastSeen: e._max.receivedAt,
      });
    }
  }

  res.json(result);
});

// Liste toutes les associations expéditeur-lieu (pour la vue globale)
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

// Liste les demandeurs d'un lieu spécifique
router.get('/:id/requesters', async (req, res) => {
  const locationId = Number(req.params.id);
  const location = await prisma.glpiLocation.findUnique({ where: { id: locationId }, select: { id: true, name: true } });
  if (!location) return res.status(404).json({ error: 'Lieu introuvable' });

  const links = await prisma.requesterLocation.findMany({
    where: { glpiLocationId: locationId },
    include: {
      assignedBy: { select: { id: true, fullName: true, email: true } },
    },
    orderBy: [{ assignmentCount: 'desc' }, { lastUsedAt: 'desc' }],
  });
  res.json({ location, requesters: links });
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

// Supprimer une association demandeur↔lieu
router.delete('/requesters/:id', requirePermission('locations.manage', ['ADMIN']), async (req, res) => {
  const id = Number(req.params.id);
  await prisma.requesterLocation.delete({ where: { id } }).catch(() => {});
  res.status(204).send();
});

// Réassigner les demandeurs d'un lieu vers un autre lieu (avant suppression)
router.post('/:id/reassign', requirePermission('locations.manage', ['ADMIN']), async (req, res) => {
  const sourceId = Number(req.params.id);
  const { targetLocationId } = req.body;

  if (!targetLocationId || targetLocationId === sourceId) {
    return res.status(400).json({ error: 'Lieu cible invalide' });
  }

  const source = await prisma.glpiLocation.findUnique({ where: { id: sourceId } });
  if (!source) return res.status(404).json({ error: 'Lieu source introuvable' });

  const target = await prisma.glpiLocation.findUnique({ where: { id: Number(targetLocationId) } });
  if (!target) return res.status(404).json({ error: 'Lieu cible introuvable' });

  // Déplacer toutes les associations du lieu source vers le lieu cible
  const requesters = await prisma.requesterLocation.findMany({ where: { glpiLocationId: sourceId } });
  let moved = 0;
  let skipped = 0;

  for (const r of requesters) {
    try {
      await prisma.requesterLocation.upsert({
        where: { email_glpiLocationId: { email: r.email, glpiLocationId: Number(targetLocationId) } },
        update: { assignmentCount: { increment: r.assignmentCount }, lastUsedAt: r.lastUsedAt },
        create: {
          email: r.email,
          glpiLocationId: Number(targetLocationId),
          assignedById: req.user.sub,
          assignmentCount: r.assignmentCount,
          lastUsedAt: r.lastUsedAt,
        },
      });
      await prisma.requesterLocation.delete({ where: { id: r.id } });
      moved++;
    } catch {
      // Si l'association existe déjà dans le lieu cible, on supprime simplement la source
      await prisma.requesterLocation.delete({ where: { id: r.id } });
      skipped++;
    }
  }

  // Aussi mettre à jour les tickets existants qui pointent vers ce lieu
  const ticketsUpdated = await prisma.ticket.updateMany({
    where: { glpiLocationId: sourceId },
    data: { glpiLocationId: Number(targetLocationId) },
  });

  res.json({ moved, skipped, ticketsUpdated: ticketsUpdated.count, source: source.name, target: target.name });
  auditLog('LOCATION_REASSIGNED', {
    actor: req.user, targetType: 'GlpiLocation', targetId: sourceId, targetLabel: source.name,
    metadata: { targetId: Number(targetLocationId), targetName: target.name, moved, skipped, ticketsUpdated: ticketsUpdated.count },
  }).catch(() => {});
});

// Supprimer définitivement un lieu (après réassignation)
router.delete('/:id', requirePermission('locations.manage', ['ADMIN']), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.glpiLocation.findUnique({ where: { id }, include: { _count: { select: { requesterLinks: true } } } });
  if (!existing) return res.status(404).json({ error: 'Lieu introuvable' });

  // S'il reste des demandeurs associés, refuser la suppression
  if (existing._count.requesterLinks > 0) {
    return res.status(409).json({
      error: `Ce lieu a encore ${existing._count.requesterLinks} demandeur(s) associé(s). Réassignez-les avant de supprimer.`,
      requesterCount: existing._count.requesterLinks,
    });
  }

  await prisma.glpiLocation.delete({ where: { id } });
  await auditLog('LOCATION_DELETED', { actor: req.user, targetType: 'GlpiLocation', targetId: id, targetLabel: existing.name });
  res.status(204).send();
});

module.exports = router;
