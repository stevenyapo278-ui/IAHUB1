const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { auditLog } = require('../services/auditLogService');
const cacheStore = require('../services/cacheStore');
const { statusToCondition } = require('../services/ticketQueryService');
const { TICKET_EXPORT_SELECT, sendTicketsExport } = require('../services/ticketReportService');
const { sendTableExport } = require('../services/tableExportService');

// Invalider le cache des catégories après chaque mutation
function invalidateCategoriesCache() {
  cacheStore.clear('GET /api/categories');
}

const router = express.Router();
router.use(authenticate);

// Lister toutes les catégories (arbre)
router.get('/', async (req, res) => {
  const categories = await prisma.ticketCategory.findMany({
    orderBy: { name: 'asc' },
    include: {
      children: { orderBy: { name: 'asc' } },
      createdBy: { select: { id: true, fullName: true, avatarUrl: true } },
      _count: { select: { customFields: true } },
    },
  });
  res.json(categories);
});

// ── Tickets rattachés aux catégories ───────────────────────────────────────
// Ticket.category stocke le NOM de la catégorie (unique dans l'arbre), pas son id :
// il n'existe donc aucune clé étrangère entre Ticket et TicketCategory et la
// suppression d'une catégorie n'efface aucun ticket. On agrège les comptes par nom
// puis on les remonte vers le haut de l'arbre (parent = direct + sous-catégories).

function buildCategoryIndex(categories) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const childrenOf = new Map();
  for (const c of categories) {
    const pid = c.parentId == null ? null : Number(c.parentId);
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid).push(c.id);
  }
  return { byId, childrenOf };
}

// Noms de la catégorie + de tous ses descendants (garde-fou anti-cycle)
function subtreeNames(startId, { byId, childrenOf }) {
  const names = [];
  const seen = new Set();
  const stack = [startId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const cat = byId.get(id);
    if (cat?.name) names.push(cat.name);
    for (const childId of childrenOf.get(id) || []) stack.push(childId);
  }
  return names;
}

// { [categoryId]: nombre de tickets } — sous-catégories incluses, corbeille et
// suggestions en attente/rejetées exclues (même périmètre que la vue tickets)
async function ticketCountsByCategory(categories, query = {}) {
  const { byId, childrenOf } = buildCategoryIndex(categories);
  const subtreeByCat = new Map(
    categories.map((c) => [c.id, subtreeNames(c.id, { byId, childrenOf })])
  );
  const allNames = [...new Set([...subtreeByCat.values()].flat())];

  const grouped = allNames.length === 0 ? [] : await prisma.ticket.groupBy({
    by: ['category'],
    where: {
      deletedAt: null,
      category: { in: allNames },
      // Même périmètre que buildTicketWhereClause : masquer par défaut les tickets en
      // attente d'approbation ou rejetés par la Hotline (un approvalStatus explicite
      // dans la requête le remplace, comme sur la liste principale des tickets).
      approvalStatus: query.approvalStatus || { notIn: ['PENDING', 'REJECTED'] },
    },
    _count: true,
  });
  const countByName = new Map(grouped.map((g) => [g.category, g._count]));

  const counts = {};
  for (const c of categories) {
    counts[c.id] = subtreeByCat.get(c.id).reduce((sum, n) => sum + (countByName.get(n) || 0), 0);
  }
  return counts;
}

// ── Extraction du tableau des catégories (colonnes identiques à la grille) ───
// Ordre et filtrage repris de l'UI : arbre trié (localeCompare fr), recherche =
// correspondances + leurs parents + leurs descendants, puis descente récursive
// complète depuis les racines visibles — comme le fait Categories.jsx.
function buildCategoryGridRows(categories, rawSearch) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const childrenOf = new Map();
  for (const c of categories) {
    if (c.parentId == null) continue;
    const pid = Number(c.parentId);
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid).push(c);
  }
  const sortList = (list) => list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  let roots = sortList(categories.filter((c) => c.parentId == null));

  const search = String(rawSearch || '').trim().toLowerCase();
  if (search) {
    const matched = categories.filter((c) => c.name?.toLowerCase().includes(search));
    const visible = new Set(matched.map((c) => c.id));
    for (const cat of matched) {
      let current = cat;
      const seen = new Set([cat.id]);
      while (current.parentId != null) {
        const parentId = Number(current.parentId);
        if (visible.has(parentId) || seen.has(parentId)) break;
        seen.add(parentId);
        visible.add(parentId);
        current = byId.get(parentId);
        if (!current) break;
      }
    }
    const addDescendants = (id, ancestors) => {
      for (const kid of childrenOf.get(id) || []) {
        if (ancestors.has(kid.id)) continue;
        visible.add(kid.id);
        addDescendants(kid.id, new Set([...ancestors, kid.id]));
      }
    };
    for (const cat of matched) addDescendants(cat.id, new Set([cat.id]));
    roots = roots.filter((r) => visible.has(r.id));
  }

  const rows = [];
  const visited = new Set();
  const walk = (nodes, parentName) => {
    for (const node of nodes) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      rows.push({ node, parentName });
      const kids = childrenOf.get(node.id);
      if (kids?.length) walk(sortList([...kids]), node.name);
    }
  };
  walk(roots, null);
  return rows;
}

// Extraction du tableau (une ligne par catégorie), recherche incluse
router.get('/export', async (req, res) => {
  const categories = await prisma.ticketCategory.findMany({
    orderBy: { name: 'asc' },
    include: { createdBy: { select: { fullName: true } } },
  });
  const ticketCounts = await ticketCountsByCategory(categories, req.query);

  const childrenCount = new Map();
  for (const c of categories) {
    if (c.parentId == null) continue;
    const pid = Number(c.parentId);
    childrenCount.set(pid, (childrenCount.get(pid) || 0) + 1);
  }

  const rows = buildCategoryGridRows(categories, req.query.search).map(({ node, parentName }) => ({
    name: node.name,
    parent: parentName || '',
    source: node.isCustom ? 'Locale' : 'Sync',
    children: childrenCount.get(node.id) || 0,
    tickets: ticketCounts[node.id] ?? 0,
    createdAt: node.createdAt,
    createdBy: node.createdBy?.fullName || '',
  }));

  await sendTableExport(res, {
    columns: [
      { header: 'Nom', key: 'name', width: 32 },
      { header: 'Parent', key: 'parent', width: 22 },
      { header: 'Source', key: 'source', width: 12 },
      { header: 'Sous-catégories', key: 'children', width: 16 },
      { header: 'Tickets', key: 'tickets', width: 10 },
      { header: 'Créé le', key: 'createdAt', width: 14, numFmt: 'dd/mm/yyyy' },
      { header: 'Créé par', key: 'createdBy', width: 24 },
    ],
    rows,
    format: req.query.format,
    filenamePrefix: 'categories',
    sheetName: 'Catégories',
  });
});

// Nombre de tickets par catégorie (une seule requête GROUP BY pour tout l'arbre)
router.get('/counts', async (req, res) => {
  const categories = await prisma.ticketCategory.findMany({ select: { id: true, name: true, parentId: true } });
  res.json(await ticketCountsByCategory(categories, req.query));
});

// Catégorie + where des tickets de son sous-arbre, filtre statut optionnel
// (le même statut sert à la liste affichée et à l'extraction).
const slugify = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();

async function resolveCategoryTickets(id, query = {}) {
  const categories = await prisma.ticketCategory.findMany({ select: { id: true, name: true, parentId: true } });
  const cat = categories.find((c) => c.id === id);
  if (!cat) return null;

  const names = subtreeNames(id, buildCategoryIndex(categories));
  const where = {
    deletedAt: null,
    category: { in: names },
    // Même périmètre que buildTicketWhereClause : masquer par défaut les tickets en
    // attente d'approbation ou rejetés par la Hotline (un approvalStatus explicite
    // dans la requête le remplace, comme sur la liste principale des tickets).
    approvalStatus: query.approvalStatus || { notIn: ['PENDING', 'REJECTED'] },
  };
  const statusCond = statusToCondition(query.status);
  if (statusCond) Object.assign(where, statusCond);
  return { cat, where };
}

// Tickets rattachés à une catégorie (et à ses sous-catégories)
router.get('/:id/tickets', async (req, res) => {
  const resolved = await resolveCategoryTickets(Number(req.params.id), req.query);
  if (!resolved) return res.status(404).json({ error: 'Catégorie introuvable' });

  const { cat, where } = resolved;
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

  res.json({ category: cat.name, total, limit, status: req.query.status || '', items });
});

// Extraction des tickets d'une catégorie (CSV / XLSX, mêmes colonnes que
// GET /tickets/export, filtre statut identique à la liste)
router.get('/:id/tickets/export', async (req, res) => {
  const resolved = await resolveCategoryTickets(Number(req.params.id), req.query);
  if (!resolved) return res.status(404).json({ error: 'Catégorie introuvable' });

  const tickets = await prisma.ticket.findMany({
    where: resolved.where,
    select: TICKET_EXPORT_SELECT,
    orderBy: { createdAt: 'desc' },
    take: 10000,
  });

  await sendTicketsExport(res, tickets, {
    format: req.query.format,
    filenamePrefix: `tickets_categorie_${slugify(resolved.cat.name)}`,
  });
});

// Créer une catégorie
router.post(
  '/',
  requirePermission('tickets.manage', ['ADMIN']),
  [body('name').notEmpty().trim()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, parentId } = req.body;

    const existing = await prisma.ticketCategory.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) return res.status(409).json({ error: 'Une catégorie avec ce nom existe déjà' });

    const category = await prisma.ticketCategory.create({
      data: {
        name: name.trim(),
        isCustom: true,
        parentId: parentId ? Number(parentId) : null,
        createdById: req.user.sub,
      },
    });

    await auditLog('CATEGORY_CREATED', { actor: req.user, targetType: 'TicketCategory', targetId: category.id, targetLabel: name });
    invalidateCategoriesCache();
    res.status(201).json(category);
  }
);

// Modifier une catégorie
router.patch(
  '/:id',
  requirePermission('tickets.manage', ['ADMIN']),
  async (req, res) => {
    const id = Number(req.params.id);
    const { name, parentId } = req.body;

    const existing = await prisma.ticketCategory.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Catégorie introuvable' });

    const data = {};
    if (name !== undefined) data.name = name.trim();
    if (parentId !== undefined) {
      const newParentId = parentId ? Number(parentId) : null;
      // Empêcher les cycles : vérifier que le nouveau parent n'est pas un descendant de cette catégorie
      if (newParentId && newParentId !== id) {
        const allCategories = await prisma.ticketCategory.findMany({ select: { id: true, parentId: true } });
        const childrenOfId = new Set();
        const queue = [id];
        while (queue.length > 0) {
          const current = queue.pop();
          for (const c of allCategories) {
            if (c.parentId != null && Number(c.parentId) === current && !childrenOfId.has(c.id)) {
              childrenOfId.add(c.id);
              queue.push(c.id);
            }
          }
        }
        if (childrenOfId.has(newParentId)) {
          return res.status(400).json({ error: 'Impossible de définir ce parent : cela créerait un cycle hiérarchique.' });
        }
      }
      data.parentId = newParentId;
    }

    const category = await prisma.ticketCategory.update({ where: { id }, data });
    await auditLog('CATEGORY_UPDATED', { actor: req.user, targetType: 'TicketCategory', targetId: id, targetLabel: existing.name });
    invalidateCategoriesCache();
    res.json(category);
  }
);

// Supprimer une catégorie
router.delete(
  '/:id',
  requirePermission('tickets.manage', ['ADMIN']),
  async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.ticketCategory.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Catégorie introuvable' });

    await prisma.ticketCategory.delete({ where: { id } });
    await auditLog('CATEGORY_DELETED', { actor: req.user, targetType: 'TicketCategory', targetId: id, targetLabel: existing.name });
    invalidateCategoriesCache();
    res.status(204).send();
  }
);

module.exports = router;
