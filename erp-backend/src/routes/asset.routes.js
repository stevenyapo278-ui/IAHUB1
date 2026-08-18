// Inventaire d'assets (équipements IT) : CRUD local + import GLPI optionnel.
// Les assets peuvent être créés manuellement ou synchronisés depuis GLPI (glpiAssetId unique).

const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { syncAssetsFromGlpi } = require('../services/glpiTicketCreator');

const router = express.Router();
router.use(authenticate);

const ASSET_TYPES = ['COMPUTER', 'PRINTER', 'NETWORK', 'SOFTWARE', 'PHONE', 'OTHER'];
const ASSET_STATUSES = ['IN_USE', 'STOCK', 'BROKEN', 'OUT_OF_SERVICE'];

// Liste + recherche + filtres + pagination
router.get('/', async (req, res) => {
  const { q, assetType, status, locationId, ownerId, ticketId, page = 1, pageSize = 25 } = req.query;
  const where = {};

  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { serialNumber: { contains: q, mode: 'insensitive' } },
      { inventoryNumber: { contains: q, mode: 'insensitive' } },
      { model: { contains: q, mode: 'insensitive' } },
      { manufacturer: { contains: q, mode: 'insensitive' } },
    ];
  }
  if (assetType) where.assetType = assetType;
  if (status) where.status = status;
  if (locationId) where.glpiLocationId = Number(locationId);
  if (ownerId) where.ownerId = Number(ownerId);
  if (ticketId) where.tickets = { some: { ticketId: Number(ticketId) } };

  const skip = (Math.max(1, Number(page)) - 1) * Math.min(200, Math.max(1, Number(pageSize)));
  const take = Math.min(200, Math.max(1, Number(pageSize)));

  const [assets, total] = await Promise.all([
    prisma.asset.findMany({
      where,
      orderBy: [{ assetType: 'asc' }, { name: 'asc' }],
      skip,
      take,
      include: {
        glpiLocation: { select: { id: true, name: true, completename: true } },
        owner: { select: { id: true, fullName: true, email: true } },
        team: { select: { id: true, name: true } },
        _count: { select: { tickets: true } },
      },
    }),
    prisma.asset.count({ where }),
  ]);

  res.json({ assets, total, page: Number(page), pageSize: take });
});

// Autocomplétion légère pour le sélecteur d'assets du formulaire de ticket
router.get('/search', async (req, res) => {
  const { q, ticketId } = req.query;
  const where = {};
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { serialNumber: { contains: q, mode: 'insensitive' } },
      { inventoryNumber: { contains: q, mode: 'insensitive' } },
    ];
  }
  // assets déjà liés au ticket → marqués selected côté client
  if (ticketId) {
    const linked = await prisma.assetTicket.findMany({ where: { ticketId: Number(ticketId) }, select: { assetId: true } });
    where.id = { in: linked.map((l) => l.assetId) };
  }

  const assets = await prisma.asset.findMany({
    where,
    orderBy: [{ assetType: 'asc' }, { name: 'asc' }],
    take: 50,
    include: {
      glpiLocation: { select: { name: true, completename: true } },
    },
  });
  res.json(assets);
});

// Créer un asset (manuel)
router.post(
  '/',
  requirePermission('assets.manage'),
  [body('name').notEmpty().trim().withMessage('Le nom est requis')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { name, assetType, serialNumber, inventoryNumber, status, manufacturer, model, locationId, ownerId, teamId, purchaseDate, warrantyEnd, notes } = req.body;

    const asset = await prisma.asset.create({
      data: {
        name: name.trim(),
        assetType: ASSET_TYPES.includes(assetType) ? assetType : 'COMPUTER',
        serialNumber: serialNumber || null,
        inventoryNumber: inventoryNumber || null,
        status: ASSET_STATUSES.includes(status) ? status : 'IN_USE',
        manufacturer: manufacturer || null,
        model: model || null,
        glpiLocationId: locationId ? Number(locationId) : null,
        ownerId: ownerId ? Number(ownerId) : null,
        teamId: teamId ? Number(teamId) : null,
        purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
        warrantyEnd: warrantyEnd ? new Date(warrantyEnd) : null,
        notes: notes || null,
      },
      include: {
        glpiLocation: { select: { id: true, name: true, completename: true } },
        owner: { select: { id: true, fullName: true, email: true } },
        team: { select: { id: true, name: true } },
      },
    });
    return res.status(201).json(asset);
  }
);

// Modifier un asset
router.patch('/:id', requirePermission('assets.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.asset.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Équipement introuvable' });

  const { name, assetType, serialNumber, inventoryNumber, status, manufacturer, model, locationId, ownerId, teamId, purchaseDate, warrantyEnd, notes } = req.body;

  const data = {};
  if (name !== undefined) data.name = name.trim();
  if (assetType !== undefined) data.assetType = assetType;
  if (serialNumber !== undefined) data.serialNumber = serialNumber;
  if (inventoryNumber !== undefined) data.inventoryNumber = inventoryNumber;
  if (status !== undefined) data.status = status;
  if (manufacturer !== undefined) data.manufacturer = manufacturer;
  if (model !== undefined) data.model = model;
  if (locationId !== undefined) data.glpiLocationId = locationId ? Number(locationId) : null;
  if (ownerId !== undefined) data.ownerId = ownerId ? Number(ownerId) : null;
  if (teamId !== undefined) data.teamId = teamId ? Number(teamId) : null;
  if (purchaseDate !== undefined) data.purchaseDate = purchaseDate ? new Date(purchaseDate) : null;
  if (warrantyEnd !== undefined) data.warrantyEnd = warrantyEnd ? new Date(warrantyEnd) : null;
  if (notes !== undefined) data.notes = notes;

  const asset = await prisma.asset.update({
    where: { id },
    data,
    include: {
      glpiLocation: { select: { id: true, name: true, completename: true } },
      owner: { select: { id: true, fullName: true, email: true } },
      team: { select: { id: true, name: true } },
    },
  });
  return res.json(asset);
});

// Supprimer un asset
router.delete('/:id', requirePermission('assets.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.asset.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Équipement introuvable' });

  // La liaison AssetTicket est supprimée en cascade (onDelete: Cascade)
  await prisma.asset.delete({ where: { id } });
  return res.json({ deleted: true });
});

// Sync manuelle depuis GLPI (bouton de la page Inventaire)
router.post('/sync-glpi', requirePermission('assets.manage'), async (req, res) => {
  try {
    const result = await syncAssetsFromGlpi();
    if (result === null) return res.status(422).json({ error: 'GLPI non configuré' });
    res.json({ synced: result });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Erreur de synchronisation GLPI' });
  }
});

module.exports = router;