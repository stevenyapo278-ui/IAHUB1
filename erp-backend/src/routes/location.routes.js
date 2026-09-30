const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { auditLog } = require('../services/auditLogService');
const { statusToCondition } = require('../services/ticketQueryService');
const { TICKET_EXPORT_SELECT, sendTicketsExport } = require('../services/ticketReportService');
const { sendTableExport } = require('../services/tableExportService');

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

  const locations = await prisma.location.findMany({
    where,
    orderBy: [{ isCustom: 'asc' }, { completename: 'asc' }],
    include: {
      _count: { select: { requesterLinks: true } },
    },
  });
  res.json(locations);
});

// ── Tickets rattachés aux lieux ─────────────────────────────────────────────
// Ticket.locationId est une colonne simple (aucune clé étrangère, aucune cascade) et
// Ticket.locationName conserve le libellé complet : supprimer un lieu n'efface aucun
// ticket, il coupe seulement le lien vers le lieu. On compte donc directement les
// tickets vivants (corbeille exclue) groupés par locationId.

// ── Extraction du tableau des lieux (colonnes identiques à la grille) ────────
// Le filtrage reprend les champs cherchés par la grille : nom, chemin complet,
// ville, bâtiment et pays.
function buildLocationGridRows(locations, rawSearch) {
  const search = String(rawSearch || '').trim().toLowerCase();
  if (!search) return locations;
  return locations.filter((l) => [l.name, l.completename, l.town, l.building, l.country]
    .some((field) => field?.toLowerCase().includes(search)));
}

// Extraction du tableau (une ligne par lieu), recherche incluse
router.get('/export', async (req, res) => {
  const locations = await prisma.location.findMany({
    orderBy: [{ isCustom: 'asc' }, { completename: 'asc' }],
    include: { _count: { select: { requesterLinks: true } } },
  });
  const grouped = await prisma.ticket.groupBy({
    by: ['locationId'],
    where: { deletedAt: null, locationId: { not: null } },
    _count: true,
  });
  const countByLocation = new Map(grouped.map((g) => [g.locationId, g._count]));

  const rows = buildLocationGridRows(locations, req.query.search).map((l) => ({
    name: l.name,
    completename: l.completename || '',
    townBuilding: [l.town, l.building].filter(Boolean).join(' · '),
    country: l.country || '',
    tickets: countByLocation.get(l.id) ?? 0,
    requesters: l._count?.requesterLinks ?? 0,
  }));

  await sendTableExport(res, {
    columns: [
      { header: 'Lieu', key: 'name', width: 30 },
      { header: 'Chemin complet', key: 'completename', width: 40 },
      { header: 'Ville / Bâtiment', key: 'townBuilding', width: 24 },
      { header: 'Pays', key: 'country', width: 16 },
      { header: 'Tickets', key: 'tickets', width: 10 },
      { header: 'Demandeurs', key: 'requesters', width: 12 },
    ],
    rows,
    format: req.query.format,
    filenamePrefix: 'lieux',
    sheetName: 'Lieux',
  });
});

// { [locationId]: nombre de tickets }
router.get('/counts', async (req, res) => {
  const locations = await prisma.location.findMany({ select: { id: true } });
  const grouped = await prisma.ticket.groupBy({
    by: ['locationId'],
    where: { deletedAt: null, locationId: { not: null } },
    _count: true,
  });
  const countByLocation = new Map(grouped.map((g) => [g.locationId, g._count]));
  res.json(Object.fromEntries(locations.map((l) => [l.id, countByLocation.get(l.id) || 0])));
});

// Lieu + where de ses tickets, filtre statut optionnel (le même statut sert à
// la liste affichée et à l'extraction).
const slugify = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();

async function resolveLocationTickets(id, query = {}) {
  const location = await prisma.location.findUnique({ where: { id } });
  if (!location) return null;

  const where = { deletedAt: null, locationId: id };
  const statusCond = statusToCondition(query.status);
  if (statusCond) Object.assign(where, statusCond);
  return { location, where };
}

// Tickets rattachés à un lieu
router.get('/:id/tickets', async (req, res) => {
  const resolved = await resolveLocationTickets(Number(req.params.id), req.query);
  if (!resolved) return res.status(404).json({ error: 'Lieu introuvable' });

  const { location, where } = resolved;
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));

  const [items, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      select: {
        id: true, title: true, status: true, priority: true, category: true, locationName: true, createdAt: true,
        requester: { select: { id: true, fullName: true } },
        assignedTo: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.ticket.count({ where }),
  ]);

  res.json({ location: location.name, total, limit, status: req.query.status || '', items });
});

// Extraction des tickets d'un lieu (CSV / XLSX, mêmes colonnes que
// GET /tickets/export, filtre statut identique à la liste)
router.get('/:id/tickets/export', async (req, res) => {
  const resolved = await resolveLocationTickets(Number(req.params.id), req.query);
  if (!resolved) return res.status(404).json({ error: 'Lieu introuvable' });

  const tickets = await prisma.ticket.findMany({
    where: resolved.where,
    select: TICKET_EXPORT_SELECT,
    orderBy: { createdAt: 'desc' },
    take: 10000,
  });

  await sendTicketsExport(res, tickets, {
    format: req.query.format,
    filenamePrefix: `tickets_lieu_${slugify(resolved.location.name)}`,
  });
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

    const existing = await prisma.location.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) return res.status(409).json({ error: 'Un lieu avec ce nom existe déjà' });

    const location = await prisma.location.create({
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

    const existing = await prisma.location.findUnique({ where: { id } });
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

    const location = await prisma.location.update({ where: { id }, data });
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

  // 1. Utilisateurs ERP (actifs de préférence)
  const userWhere = { isActive: true };
  if (q) {
    userWhere.OR = [
      { fullName: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
    ];
  }
  const users = await prisma.user.findMany({
    where: userWhere,
    select: { id: true, fullName: true, email: true, role: true, avatarUrl: true },
    orderBy: { fullName: 'asc' },
    take: 50,
  });

  // 2. Expéditeurs d'emails connus (depuis la table IncomingEmail)
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
  }).catch(() => []);

  // 3. Expéditeurs depuis la table Ticket (sourceEmail)
  const ticketEmailWhere = { sourceEmail: { not: null } };
  if (q) {
    ticketEmailWhere.OR = [
      { sourceEmail: { contains: q, mode: 'insensitive' } },
      { sourceName: { contains: q, mode: 'insensitive' } },
    ];
  }
  const ticketEmails = await prisma.ticket.groupBy({
    by: ['sourceEmail'],
    where: ticketEmailWhere,
    _count: { sourceEmail: true },
    _max: { sourceName: true, createdAt: true },
    orderBy: { _count: { sourceEmail: 'desc' } },
    take: 50,
  }).catch(() => []);

  // 4. Combiner et dédupliquer
  const seen = new Set();
  const result = [];

  for (const u of users) {
    const key = u.email?.toLowerCase().trim();
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
    const key = e.fromEmail?.toLowerCase().trim();
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

  for (const t of ticketEmails) {
    const key = t.sourceEmail?.toLowerCase().trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push({
        type: 'requester',
        label: t._max.sourceName || t.sourceEmail,
        email: t.sourceEmail,
        subLabel: `${t._count.sourceEmail} ticket(s) créé(s)`,
        lastSeen: t._max.createdAt,
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
      location: { select: { id: true, name: true, completename: true, town: true } },
      assignedBy: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
    },
    orderBy: { lastUsedAt: 'desc' },
  });
  res.json(links);
});

// Liste les demandeurs d'un lieu spécifique
router.get('/:id/requesters', async (req, res) => {
  const locationId = Number(req.params.id);
  const location = await prisma.location.findUnique({ where: { id: locationId }, select: { id: true, name: true } });
  if (!location) return res.status(404).json({ error: 'Lieu introuvable' });

  const links = await prisma.requesterLocation.findMany({
    where: { locationId: locationId },
    include: {
      assignedBy: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
    },
    orderBy: [{ assignmentCount: 'desc' }, { lastUsedAt: 'desc' }],
  });
  res.json({ location, requesters: links });
});

// Associer manuellement un ou plusieurs expéditeurs à un lieu
router.post(
  '/requesters',
  requirePermission('locations.manage', ['ADMIN', 'HOTLINE']),
  [body('email').isString().trim().notEmpty(), body('locationId').isInt()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const rawEmails = req.body.email.split(/[,;\n]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const locationId = Number(req.body.locationId);

    const location = await prisma.location.findUnique({ where: { id: locationId } });
    if (!location) return res.status(404).json({ error: 'Lieu introuvable' });

    const created = [];
    const skipped = [];

    for (const email of rawEmails) {
      // Valider que c'est bien un email
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        skipped.push(email);
        continue;
      }
      try {
        const link = await prisma.requesterLocation.upsert({
          where: { email_locationId: { email, locationId } },
          update: {
            assignmentCount: { increment: 1 },
            lastUsedAt: new Date(),
            assignedById: req.user.sub,
          },
          create: {
            email,
            locationId,
            assignedById: req.user.sub,
          },
        });
        created.push(link);
      } catch {
        skipped.push(email);
      }
    }

    res.status(201).json({ created: created.length, skipped, total: rawEmails.length });
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

  const source = await prisma.location.findUnique({ where: { id: sourceId } });
  if (!source) return res.status(404).json({ error: 'Lieu source introuvable' });

  const target = await prisma.location.findUnique({ where: { id: Number(targetLocationId) } });
  if (!target) return res.status(404).json({ error: 'Lieu cible introuvable' });

  // Déplacer toutes les associations du lieu source vers le lieu cible
  const requesters = await prisma.requesterLocation.findMany({ where: { locationId: sourceId } });
  let moved = 0;
  let skipped = 0;

  for (const r of requesters) {
    try {
      await prisma.requesterLocation.upsert({
        where: { email_locationId: { email: r.email, locationId: Number(targetLocationId) } },
        update: { assignmentCount: { increment: r.assignmentCount }, lastUsedAt: r.lastUsedAt },
        create: {
          email: r.email,
          locationId: Number(targetLocationId),
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
    where: { locationId: sourceId },
    data: { locationId: Number(targetLocationId) },
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
  const existing = await prisma.location.findUnique({ where: { id }, include: { _count: { select: { requesterLinks: true } } } });
  if (!existing) return res.status(404).json({ error: 'Lieu introuvable' });

  // S'il reste des demandeurs associés, refuser la suppression
  if (existing._count.requesterLinks > 0) {
    return res.status(409).json({
      error: `Ce lieu a encore ${existing._count.requesterLinks} demandeur(s) associé(s). Réassignez-les avant de supprimer.`,
      requesterCount: existing._count.requesterLinks,
    });
  }

  await prisma.location.delete({ where: { id } });
  await auditLog('LOCATION_DELETED', { actor: req.user, targetType: 'GlpiLocation', targetId: id, targetLabel: existing.name });
  res.status(204).send();
});

module.exports = router;
