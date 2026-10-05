const express = require('express');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { apiCache } = require('../middleware/apiCache');
const { callAI } = require('../services/aiTicketComparison');
const {
  NODE_KINDS, neighborhood, OPEN, NOT_DELETED, STAFF_ROLES, parseId,
  ticketItem, TICKET_SELECT, assetItems, FAN_MAX, LIST_MAX, PROBLEM_STATUS_LABEL,
} = require('../services/graphNodes');

// ── Exploration en 3 niveaux (page /explorer) ──────────────────────────────
// Centre → catégories (compteurs) → éléments (éventail). Le registre des kinds
// vit dans services/graphNodes.js (source unique de vérité) : ici on ne fait
// que router, plus de logique métier. Tout est dérivé des tables internes
// (tickets synchronisés depuis GLPI) : COUNT / GROUP BY, chargement des
// enfants au clic, jamais tout d'un coup.

const router = express.Router();
router.use(authenticate);
router.use(requirePermission('tickets.view'));

// ── Handlers partagés (registre graphNodes) ────────────────────────────────
// Centre  : NODE_KINDS[kind].loadCenter(id) → { center, categories[...] }
// Éventail: cat.items(id, { all, take })    → { items, total }

async function handleCenter(req, res, kind) {
  const def = NODE_KINDS[kind];
  if (!def) return res.status(400).json({ error: 'Type de nœud inconnu' });
  const id = def.parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
  const data = await def.loadCenter(id);
  if (!data) return res.status(404).json({ error: def.notFound });
  return res.json(data);
}

async function handleCategory(req, res, kind) {
  const def = NODE_KINDS[kind];
  if (!def) return res.status(400).json({ error: 'Type de nœud inconnu' });
  const id = def.parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
  const cat = def.categories.find((c) => c.key === req.params.category);
  if (!cat) return res.status(400).json({ error: 'Catégorie inconnue' });
  const exists = await def.exists(id);
  if (!exists) return res.status(404).json({ error: def.notFound });
  const all = req.query.all === '1';
  const take = all ? LIST_MAX : FAN_MAX;
  return res.json(await cat.items(id, { all, take }));
}

// ── Sélecteurs de centre ───────────────────────────────────────────────────

// GET /api/graph/techniciens → liste du personnel actif + tickets ouverts
router.get('/techniciens', async (req, res) => {
  const [users, groups] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, role: { in: STAFF_ROLES } },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: 'asc' },
      take: 60,
    }),
    prisma.ticket.groupBy({
      by: ['assignedToId'],
      where: { ...OPEN, assignedToId: { not: null } },
      _count: true,
    }),
  ]);
  const openByUser = new Map(groups.map((g) => [g.assignedToId, g._count]));
  res.json(
    users
      .map((u) => ({ ...u, openCount: openByUser.get(u.id) || 0 }))
      .sort((a, b) => b.openCount - a.openCount || a.fullName.localeCompare(b.fullName))
  );
});

// GET /api/graph/lieux → lieux actifs + tickets ouverts
router.get('/lieux', async (req, res) => {
  const [locations, groups] = await Promise.all([
    prisma.location.findMany({
      where: { isActive: true },
      select: { id: true, name: true, completename: true },
      take: 100,
    }),
    prisma.ticket.groupBy({
      by: ['locationId'],
      where: { ...OPEN, locationId: { not: null } },
      _count: true,
    }),
  ]);
  const openByLocation = new Map(groups.map((g) => [g.locationId, g._count]));
  res.json(
    locations
      .map((l) => ({
        ...l,
        label: l.completename || l.name,
        openCount: openByLocation.get(l.id) || 0,
      }))
      .sort((a, b) => b.openCount - a.openCount || a.label.localeCompare(b.label))
  );
});

// ── Recherche traversante ──────────────────────────────────────────────────

// GET /api/graph/search?q= → chaque match indique OÙ il vit (centre + catégorie)
// pour que le graphe puisse afficher le chemin jusqu'à lui.
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ matches: [] });

  const contains = { contains: q, mode: 'insensitive' };
  const byId = /^\d+$/.test(q) ? Number.parseInt(q, 10) : null;

  const [tickets, users, requesters, locations, assets, problems, teams, categories, skills] = await Promise.all([
    prisma.ticket.findMany({
      where: { ...NOT_DELETED, OR: [{ title: contains }, ...(byId ? [{ id: byId }] : [])] },
      select: {
        id: true, title: true, priority: true, status: true,
        locationId: true, locationName: true, assignedToId: true,
        slaBreachedAt: true,
        assignedTo: { select: { id: true, fullName: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 6,
    }),
    prisma.user.findMany({
      where: { isActive: true, role: { in: STAFF_ROLES }, fullName: contains },
      select: { id: true, fullName: true, role: true },
      take: 4,
    }),
    prisma.user.findMany({
      where: { isActive: true, role: { notIn: STAFF_ROLES }, fullName: contains },
      select: { id: true, fullName: true, role: true, email: true },
      take: 3,
    }),
    prisma.location.findMany({
      where: { OR: [{ name: contains }, { completename: contains }] },
      select: { id: true, name: true, completename: true },
      take: 4,
    }),
    prisma.asset.findMany({
      where: { OR: [{ name: contains }, { serialNumber: contains }, { inventoryNumber: contains }] },
      select: {
        id: true, name: true, serialNumber: true, inventoryNumber: true, locationId: true,
        location: { select: { name: true, completename: true } },
      },
      take: 4,
    }),
    prisma.problem.findMany({
      where: { title: contains },
      select: { id: true, title: true, status: true, priority: true },
      orderBy: { updatedAt: 'desc' },
      take: 3,
    }),
    prisma.team.findMany({
      where: { name: contains },
      select: { id: true, name: true, groupEmail: true },
      take: 3,
    }),
    prisma.ticketCategory.findMany({
      where: { name: contains },
      select: { id: true, name: true },
      take: 3,
    }),
    prisma.skill.findMany({
      where: { name: contains },
      select: { id: true, name: true, category: true },
      take: 3,
    }),
  ]);

  // Un « chemin » = le centre à ouvrir + la catégorie à déployer
  const ticketMatches = tickets.map((t) => {
    let path = null;
    if (t.assignedTo) {
      path = {
        center: { type: 'technicien', id: t.assignedTo.id, label: t.assignedTo.fullName },
        category: t.slaBreachedAt ? 'sla' : 'tickets',
      };
    } else if (t.locationId) {
      path = {
        center: { type: 'lieu', id: t.locationId, label: t.locationName || `Lieu ${t.locationId}` },
        category: t.slaBreachedAt ? 'sla' : 'tickets',
      };
    }
    return {
      kind: 'ticket', id: t.id, ref: `#${t.id}`, label: t.title,
      meta: t.locationName || 'Sans lieu', priority: t.priority, status: t.status,
      path,
    };
  });

  const userMatches = users.map((u) => ({
    kind: 'technicien', id: u.id, label: u.fullName, meta: u.role,
    path: { center: { type: 'technicien', id: u.id, label: u.fullName }, category: 'tickets' },
  }));

  const locationMatches = locations.map((l) => ({
    kind: 'lieu', id: l.id, label: l.completename || l.name, meta: 'Lieu',
    path: { center: { type: 'lieu', id: l.id, label: l.completename || l.name }, category: 'tickets' },
  }));

  // Équipement : lieu s'il en a, sinon premier ticket lié (→ son technicien)
  const assetMatches = await Promise.all(assets.map(async (a) => {
    let path = null;
    if (a.locationId) {
      const placeLabel = a.location?.completename || a.location?.name || `Lieu ${a.locationId}`;
      path = {
        center: { type: 'lieu', id: a.locationId, label: placeLabel },
        category: 'equipements',
      };
    } else {
      const link = await prisma.assetTicket.findFirst({
        where: { assetId: a.id, ticket: { deletedAt: null, assignedToId: { not: null } } },
        include: { ticket: { select: { assignedToId: true, assignedTo: { select: { id: true, fullName: true } } } } },
        orderBy: { ticket: { updatedAt: 'desc' } },
      });
      if (link?.ticket?.assignedTo) {
        path = {
          center: { type: 'technicien', id: link.ticket.assignedTo.id, label: link.ticket.assignedTo.fullName },
          category: 'equipements',
        };
      }
    }
    return {
      kind: 'asset', id: a.id, label: a.name,
      meta: a.serialNumber || a.inventoryNumber || null,
      path,
    };
  }));

  const requesterMatches = requesters.map((u) => ({
    kind: 'demandeur', id: u.id, label: u.fullName, meta: u.email || u.role,
    path: { center: { type: 'demandeur', id: u.id, label: u.fullName }, category: 'tickets' },
  }));

  const problemMatches = problems.map((p) => ({
    kind: 'probleme', id: p.id, ref: `P${p.id}`, label: p.title,
    meta: PROBLEM_STATUS_LABEL[p.status] || p.status, status: p.status, priority: p.priority,
    path: { center: { type: 'probleme', id: p.id, label: p.title }, category: 'tickets' },
  }));

  const teamMatches = teams.map((t) => ({
    kind: 'equipe', id: t.id, label: t.name, meta: t.groupEmail || 'Équipe',
    path: { center: { type: 'equipe', id: t.id, label: t.name }, category: 'membres' },
  }));

  const categoryMatches = categories.map((c) => ({
    kind: 'categorie', id: c.id, label: c.name, meta: 'Catégorie',
    path: { center: { type: 'categorie', id: c.id, label: c.name }, category: 'tickets' },
  }));

  const skillMatches = skills.map((s) => ({
    kind: 'skill', id: s.id, label: s.name, meta: s.category || 'Compétence',
    path: { center: { type: 'skill', id: s.id, label: s.name }, category: 'techniciens' },
  }));

  const order = {
    ticket: 0, technicien: 1, lieu: 2, asset: 3,
    probleme: 4, equipe: 5, categorie: 6, skill: 7, demandeur: 8,
  };
  const matches = [
    ...ticketMatches, ...userMatches, ...locationMatches, ...assetMatches,
    ...problemMatches, ...teamMatches, ...categoryMatches, ...skillMatches, ...requesterMatches,
  ]
    .sort((a, b) => order[a.kind] - order[b.kind])
    .slice(0, 14);

  res.json({ matches });
});

// ── Centre « technicien » (délègue au registre) ────────────────────────────

// GET /api/graph/technicien/:id → centre + catégories (compteurs)
router.get('/technicien/:id', (req, res) => handleCenter(req, res, 'technicien'));

// GET /api/graph/technicien/:id/:category → éléments de l'éventail
router.get('/technicien/:id/:category', (req, res) => handleCategory(req, res, 'technicien'));

// ── Centre « lieu » (délègue au registre) ──────────────────────────────────

// GET /api/graph/lieu/:id → centre + catégories (compteurs)
router.get('/lieu/:id', (req, res) => handleCenter(req, res, 'lieu'));

// GET /api/graph/lieu/:id/:category → éléments de l'éventail
router.get('/lieu/:id/:category', (req, res) => handleCategory(req, res, 'lieu'));

// ── Intersection à 2 centres (centre + centre épinglé) ─────────────────────
// L'éventail ne montre que le croisement des deux centres :
// technicien × lieu = « ses tickets ICI ». Les deux types doivent être différents.

const PAIR_CATEGORIES = ['tickets', 'sla', 'equipements', 'techniciens'];

async function resolvePairCenters(req) {
  const { type1, type2 } = req.params;
  const id1 = parseId(req.params.id1);
  const id2 = parseId(req.params.id2);
  const validType = (t) => t === 'technicien' || t === 'lieu';
  if (!validType(type1) || !validType(type2) || type1 === type2 || !id1 || !id2) return null;

  const load = async (type, id) => {
    if (type === 'technicien') {
      const u = await prisma.user.findUnique({
        where: { id },
        select: { id: true, fullName: true, role: true, isActive: true },
      });
      if (!u || !u.isActive) return null;
      return { type: 'technicien', id: u.id, label: u.fullName, sub: u.role };
    }
    const l = await prisma.location.findUnique({
      where: { id },
      select: { id: true, name: true, completename: true },
    });
    if (!l) return null;
    return { type: 'lieu', id: l.id, label: l.completename || l.name, sub: 'Lieu' };
  };

  const [c1, c2] = await Promise.all([load(type1, id1), load(type2, id2)]);
  if (!c1 || !c2) return null;
  return { center: c1, pin: c2 };
}

// Le where du croisement : technicien × lieu, dans l'ordre quel qu'il soit
function pairWhere(centers) {
  const tech = centers.center.type === 'technicien' ? centers.center : centers.pin;
  const place = centers.center.type === 'lieu' ? centers.center : centers.pin;
  return { ...OPEN, assignedToId: tech.id, locationId: place.id };
}

// GET /api/graph/pair/:type1/:id1/:type2/:id2 → les 2 centres + compteurs du croisement
router.get('/pair/:type1/:id1/:type2/:id2', async (req, res) => {
  const centers = await resolvePairCenters(req);
  if (!centers) return res.status(400).json({ error: 'Centres invalides (types différents attendus)' });

  const where = pairWhere(centers);
  const tech = centers.center.type === 'technicien' ? centers.center : centers.pin;
  const place = centers.center.type === 'lieu' ? centers.center : centers.pin;

  const [tickets, sla, equipements, assignees] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.count({ where: { ...where, slaBreachedAt: { not: null } } }),
    prisma.asset.count({
      where: {
        locationId: place.id,
        tickets: { some: { ticket: { assignedToId: tech.id, deletedAt: null } } },
      },
    }),
    prisma.ticket.groupBy({ by: ['assignedToId'], where: { ...where, assignedToId: { not: null } } }),
  ]);

  res.json({
    center: centers.center,
    pin: centers.pin,
    categories: [
      { key: 'tickets', label: 'Tickets ouverts (croisés)', count: tickets },
      { key: 'sla', label: 'SLA dépassé (croisés)', count: sla },
      { key: 'equipements', label: 'Équipements (croisés)', count: equipements },
      { key: 'techniciens', label: 'Collaborateurs', count: assignees.length },
    ],
  });
});

// GET /api/graph/pair/.../:category → éléments du croisement
router.get('/pair/:type1/:id1/:type2/:id2/:category', async (req, res) => {
  const centers = await resolvePairCenters(req);
  if (!centers) return res.status(400).json({ error: 'Centres invalides (types différents attendus)' });
  const category = req.params.category;
  if (!PAIR_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Catégorie inconnue' });

  const where = pairWhere(centers);
  const tech = centers.center.type === 'technicien' ? centers.center : centers.pin;
  const place = centers.center.type === 'lieu' ? centers.center : centers.pin;
  const all = req.query.all === '1';
  const take = all ? LIST_MAX : FAN_MAX;

  if (category === 'tickets' || category === 'sla') {
    const w = category === 'sla' ? { ...where, slaBreachedAt: { not: null } } : where;
    const [total, rows] = await Promise.all([
      prisma.ticket.count({ where: w }),
      prisma.ticket.findMany({
        where: w,
        select: TICKET_SELECT,
        orderBy: category === 'sla'
          ? [{ slaBreachedAt: 'asc' }, { priority: 'asc' }]
          : [{ priority: 'asc' }, { createdAt: 'desc' }],
        take,
      }),
    ]);
    return res.json({ items: rows.map(ticketItem), total });
  }

  if (category === 'equipements') {
    const w = {
      locationId: place.id,
      tickets: { some: { ticket: { assignedToId: tech.id, deletedAt: null } } },
    };
    const [total, assets] = await Promise.all([
      prisma.asset.count({ where: w }),
      prisma.asset.findMany({
        where: w,
        select: { id: true, name: true, assetType: true, serialNumber: true, inventoryNumber: true, status: true, locationId: true },
        orderBy: { name: 'asc' },
        take,
      }),
    ]);
    return res.json({ items: await assetItems(assets), total });
  }

  // techniciens (collaborateurs sur ces tickets croisés)
  const [groups, total] = await Promise.all([
    prisma.ticket.groupBy({
      by: ['assignedToId'],
      where: { ...where, assignedToId: { not: null } },
      _count: true,
      orderBy: { _count: { assignedToId: 'desc' } },
      take,
    }),
    prisma.ticket.groupBy({
      by: ['assignedToId'],
      where: { ...where, assignedToId: { not: null } },
    }).then((rows) => rows.length),
  ]);
  const users = await prisma.user.findMany({
    where: { id: { in: groups.map((g) => g.assignedToId) } },
    select: { id: true, fullName: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return res.json({
    items: groups.map((g) => ({
      kind: 'technicien',
      id: g.assignedToId,
      label: (byId.get(g.assignedToId) || {}).fullName || `Technicien ${g.assignedToId}`,
      count: g._count,
      recenter: { center: 'technicien', id: g.assignedToId },
    })),
    total,
  });
});

// ── Synthèse IA du nœud ────────────────────────────────────────────────────
// POST /api/graph/summarize { center:{type,id}, pin?:{type,id} }
// Résume la situation du centre (ou du croisement) en 3 lignes + 1 recommandation.
// Cache 3 min par contexte + anti-spam 15 s par utilisateur.

const summarizeCache = new Map(); // key → { ts, text }
const summarizeCooldown = new Map(); // userId → ts

function cleanText(raw) {
  return String(raw || '')
    .replace(/```/g, '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .slice(0, 1400);
}

router.post('/summarize', async (req, res) => {
  const c = req.body?.center;
  const pin = req.body?.pin;
  const centerId = parseId(c?.id);
  const pinId = pin ? parseId(pin.id) : null;
  const centerType = c?.type === 'lieu' ? 'lieu' : 'technicien';
  if (!centerId || (pin && (!pinId || (pin.type !== 'lieu' && pin.type !== 'technicien') || pin.type === centerType))) {
    return res.status(400).json({ error: 'Paramètres de centre invalides' });
  }

  const now = Date.now();
  const last = summarizeCooldown.get(req.user?.sub) || 0;
  if (now - last < 15000) {
    return res.status(429).json({ error: 'Résumé déjà récent, réessayez dans quelques secondes' });
  }

  // Contexte compact : compteurs + tickets les plus tendus
  const tech = centerType === 'technicien' ? { type: centerType, id: centerId } : (pin || { type: 'lieu', id: centerId });
  const place = centerType === 'lieu' ? { type: 'lieu', id: centerId } : (pin || null);
  const base = { ...OPEN, ...(tech.type === 'technicien' ? { assignedToId: tech.id } : {}), ...(place ? { locationId: place.id } : {}) };

  const [tickets, sla, openCount] = await Promise.all([
    prisma.ticket.findMany({
      where: base,
      select: { id: true, title: true, priority: true, status: true, slaBreachedAt: true, slaResolutionDueAt: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      take: 8,
    }),
    prisma.ticket.count({ where: { ...base, slaBreachedAt: { not: null } } }),
    prisma.ticket.count({ where: base }),
  ]);

  const context = {
    centre: c?.label || `${centerType} ${centerId}`,
    centreEpingle: pin ? `${pin.type} ${pinId}` : null,
    ticketsOuverts: openCount,
    slaDepasse: sla,
    tickets: tickets.map((t) => ({
      ref: `#${t.id}`, titre: t.title.slice(0, 90), priorite: t.priority, statut: t.status,
      slaDepasse: !!t.slaBreachedAt,
    })),
  };

  const cacheKey = JSON.stringify(context);
  const cached = summarizeCache.get(cacheKey);
  if (cached && now - cached.ts < 3 * 60 * 1000) {
    summarizeCooldown.set(req.user?.sub, now);
    return res.json({ summary: cached.text, cached: true });
  }

  const prompt = [
    'Tu es analyste ITSM. Voici un contexte de supervision (JSON) :',
    JSON.stringify(context),
    'En français, en 3 phrases maximum, résume la situation (charge, urgences, tension SLA) puis termine EXACTEMENT par une ligne commençant par "→ Recommandation : " avec une action concrète et réaliste.',
    'Pas de listes, pas de JSON, pas d\'emojis, pas d\'explication de méthode.',
  ].join('\n');

  try {
    const raw = await callAI(prompt, 400);
    const text = cleanText(raw);
    if (!text) return res.status(502).json({ error: 'Réponse IA vide' });
    summarizeCache.set(cacheKey, { ts: now, text });
    // purge des entrées > 10 min
    for (const [k, v] of summarizeCache) if (now - v.ts > 10 * 60 * 1000) summarizeCache.delete(k);
    summarizeCooldown.set(req.user?.sub, now);
    res.json({ summary: text });
  } catch (err) {
    res.status(503).json({ error: err?.message?.includes('provider') ? 'Aucun provider IA actif configuré' : 'IA indisponible' });
  }
});

// ── Voisinage (mode réseau de neurones) ────────────────────────────────────
// GET /api/graph/neighborhood/:kind/:id?depth=1|2 → { center, nodes, links }
// Graphe 1-2 sauts strictement borné, servi tel quel au rendu WebGL.
// DOIT être déclarée avant les routes génériques (sinon écrasée par /:kind/...).
// Cache mémoire 10 s : endpoint le plus lourd (2 sauts, ~25 requêtes) et pas
// encore consommé par l'UI. Exécuté APRÈS authenticate + requirePermission
// (router.use déclarés ci-dessus) : le contrôle d'accès reste donc inchangé.
router.get('/neighborhood/:kind/:id', apiCache(10), async (req, res) => {
  const depthRaw = Number.parseInt(req.query.depth, 10);
  const depth = Number.isInteger(depthRaw) ? Math.min(2, Math.max(1, depthRaw)) : 2;
  const result = await neighborhood(req.params.kind, req.params.id, depth);
  if (result.error) return res.status(result.error.status).json({ error: result.error.message });
  return res.json(result);
});

// ── Routes génériques (tous kinds du registre) ─────────────────────────────
// GET /api/graph/:kind/:id            → centre + catégories
// GET /api/graph/:kind/:id/:category  → éléments de l'éventail
// Déclarées en tout dernier : elles ne captent que les kinds ci-dessus non
// routés explicitement (ticket, probleme, categorie, equipe, demandeur,
// skill, expediteur, origine, type).
router.get('/:kind/:id', (req, res) => handleCenter(req, res, req.params.kind));
router.get('/:kind/:id/:category', (req, res) => handleCategory(req, res, req.params.kind));

module.exports = router;
