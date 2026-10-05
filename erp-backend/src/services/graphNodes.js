// Registre des kinds de nœuds explorables (page /explorer).
// Source unique de vérité : centre + catégories (compteur + items) par kind.
// Utilisé par les routes existantes (/technicien/*, /lieu/*) et les routes
// génériques (/:kind/:id[/:category]) + le voisinage (mode réseau de neurones).
//
// Convention items (une ligne d'éventail) :
//   kind, id, label[, meta, count, status, priority, href, recenter, jumps]
//   - recenter : { center: kind, id } → « Centrer ici » (boucle infinie)
//   - jumps    : [{ center, id, label }] → sauts vers d'autres nœuds
//   - href     : fiche applicative (/tickets/:id, /problems/:id, …)

const prisma = require('../prismaClient');

// ── Constantes partagées ───────────────────────────────────────────────────

const OPEN_STATUSES = ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER'];
const NOT_DELETED = { deletedAt: null };
const OPEN = { ...NOT_DELETED, status: { in: OPEN_STATUSES } };
const STAFF_ROLES = ['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN'];
const PROBLEM_OPEN = { status: { notIn: ['SOLVED', 'CLOSED'] } };

// Plafond d'affichage de l'éventail (au-delà : nœud « + N autres »)
const FAN_MAX = 8;
// Liste complète ouverte depuis le nœud « + N autres »
const LIST_MAX = 50;

const parseId = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const ORIGINS = ['MANUAL', 'PORTAIL', 'EMAIL', 'CHATBOT'];
const TICKET_TYPES = ['INCIDENT', 'REQUEST'];
const ORIGIN_LABEL = { MANUAL: 'Manuel', PORTAIL: 'Portail', EMAIL: 'Email', CHATBOT: 'Chatbot' };
const PROBLEM_STATUS_LABEL = {
  NEW: 'Nouveau', IN_PROGRESS: 'En cours', ASSIGNED: 'Assigné', PLANNED: 'Planifié',
  WAITING: 'En attente', SOLVED: 'Résolu', CLOSED: 'Fermé', OBSERVED: 'Observé',
};

// ── Items normalisés ───────────────────────────────────────────────────────

function ticketItem(t) {
  return {
    kind: 'ticket',
    id: t.id,
    ref: `#${t.id}`,
    label: t.title,
    meta: t.locationName || 'Sans lieu',
    priority: t.priority,
    status: t.status,
    href: `/tickets/${t.id}`,
    slaDueAt: t.slaResolutionDueAt ? t.slaResolutionDueAt.toISOString() : null,
    slaBreached: !!t.slaBreachedAt,
    jumps: [
      ...(t.assignedTo
        ? [{ center: 'technicien', id: t.assignedTo.id, label: t.assignedTo.fullName }]
        : []),
      ...(t.locationId
        ? [{ center: 'lieu', id: t.locationId, label: t.locationName || `Lieu ${t.locationId}` }]
        : []),
    ],
  };
}

const TICKET_SELECT = {
  id: true, title: true, priority: true, status: true,
  locationId: true, locationName: true, slaResolutionDueAt: true, slaBreachedAt: true,
  assignedTo: { select: { id: true, fullName: true } },
};

function problemItem(p) {
  return {
    kind: 'probleme',
    id: p.id,
    label: p.title,
    meta: p.locationName || PROBLEM_STATUS_LABEL[p.status] || p.status,
    status: p.status,
    priority: p.priority,
    href: `/problems/${p.id}`,
    recenter: { center: 'probleme', id: p.id },
    jumps: [
      ...(p.assignedTo
        ? [{ center: 'technicien', id: p.assignedTo.id, label: p.assignedTo.fullName }]
        : []),
      ...(p.locationId
        ? [{ center: 'lieu', id: p.locationId, label: p.locationName || `Lieu ${p.locationId}` }]
        : []),
      ...(p.team ? [{ center: 'equipe', id: p.team.id, label: p.team.name }] : []),
    ],
  };
}

const PROBLEM_SELECT = {
  id: true, title: true, status: true, priority: true,
  locationId: true, locationName: true,
  assignedTo: { select: { id: true, fullName: true } },
  team: { select: { id: true, name: true } },
};

function userItem(u, kind, extra = {}) {
  const item = {
    kind,
    id: u.id,
    label: u.fullName || u.email || `${kind} ${u.id}`,
    recenter: { center: kind, id: u.id },
  };
  if (u.email && kind === 'demandeur') item.meta = u.email;
  if (extra.count != null) item.count = extra.count;
  if (kind === 'demandeur') item.href = `/users/${u.id}`;
  return item;
}

function teamItem(t, count) {
  const item = {
    kind: 'equipe',
    id: t.id,
    label: t.name,
    recenter: { center: 'equipe', id: t.id },
    href: '/teams',
  };
  if (t.groupEmail) item.meta = t.groupEmail;
  if (count != null) item.count = count;
  return item;
}

function categoryItem(c, extra = {}) {
  const item = {
    kind: 'categorie',
    id: c.id,
    label: c.name,
    recenter: { center: 'categorie', id: c.id },
    href: '/categories',
  };
  if (extra.count != null) item.count = extra.count;
  if (extra.meta) item.meta = extra.meta;
  return item;
}

function skillItem(s, level) {
  const item = {
    kind: 'skill',
    id: s.id,
    label: s.name,
    recenter: { center: 'skill', id: s.id },
    href: '/skills',
  };
  if (level != null) item.meta = `Niveau ${level}`;
  else if (s.category) item.meta = s.category;
  return item;
}

function senderItem(r, count) {
  const item = {
    kind: 'expediteur',
    id: r.email,
    label: r.email,
    recenter: { center: 'expediteur', id: r.email },
    href: `/tickets?sourceEmail=${encodeURIComponent(r.email)}`,
  };
  item.meta = r.status === 'LOW_TRUST' ? 'Reputation dégradée' : (r.domain || undefined);
  if (count != null) item.count = count;
  else if (r.ticketsTotal) item.count = r.ticketsTotal;
  return item;
}

function virtualItem(kind, id, label, count) {
  return {
    kind,
    id,
    label,
    count,
    recenter: { center: kind, id },
  };
}

// Équipements + sauts possibles (boucle infinie) : vers leur lieu, et vers un
// technicien qui a manipulé l'équipement. Le filtrage « pas de saut vers le
// centre courant » est fait côté frontend (il connaît centre ET épingle).
async function assetItems(rows) {
  if (rows.length === 0) return [];
  const ids = rows.map((a) => a.id);
  const locIds = [...new Set(rows.map((a) => a.locationId).filter(Boolean))];

  const [locs, links] = await Promise.all([
    locIds.length
      ? prisma.location.findMany({
          where: { id: { in: locIds } },
          select: { id: true, name: true, completename: true },
        })
      : [],
    prisma.assetTicket.findMany({
      where: { assetId: { in: ids }, ticket: { deletedAt: null, assignedToId: { not: null } } },
      select: {
        assetId: true,
        ticket: { select: { updatedAt: true, assignedTo: { select: { id: true, fullName: true } } } },
      },
    }),
  ]);

  const locById = new Map(locs.map((l) => [l.id, l]));
  // Pour chaque équipement : le technicien du ticket le plus récent le concernant
  links.sort((a, b) => (b.ticket?.updatedAt || 0) - (a.ticket?.updatedAt || 0));
  const techByAsset = new Map();
  for (const l of links) {
    if (l.ticket?.assignedTo && !techByAsset.has(l.assetId)) techByAsset.set(l.assetId, l.ticket.assignedTo);
  }

  return rows.map((a) => {
    const loc = a.locationId ? locById.get(a.locationId) : null;
    const tech = techByAsset.get(a.id);
    return {
      kind: 'asset',
      id: a.id,
      label: a.name,
      meta: a.serialNumber || a.inventoryNumber || a.assetType,
      status: a.status,
      href: null,
      jumps: [
        ...(loc ? [{ center: 'lieu', id: loc.id, label: loc.completename || loc.name }] : []),
        ...(tech ? [{ center: 'technicien', id: tech.id, label: tech.fullName }] : []),
      ],
    };
  });
}

// ── Agrégations réutilisables ──────────────────────────────────────────────

// Tickets regroupés par champ utilisateur (assignedToId | requesterId) →
// items technicien ou demandeur avec compteur + recenter.
async function userGroupItems({ where, by, kind, take }) {
  const [groups, total] = await Promise.all([
    prisma.ticket.groupBy({
      by: [by],
      where: { ...where, [by]: { not: null } },
      _count: true,
      orderBy: { _count: { [by]: 'desc' } },
      take,
    }),
    prisma.ticket.groupBy({
      by: [by],
      where: { ...where, [by]: { not: null } },
    }).then((rows) => rows.length),
  ]);
  const users = await prisma.user.findMany({
    where: { id: { in: groups.map((g) => g[by]) } },
    select: { id: true, fullName: true, email: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return {
    total,
    items: groups.map((g) => userItem(
      byId.get(g[by]) || { id: g[by] },
      kind,
      { count: g._count }
    )),
  };
}

// Tickets regroupés par lieu → items lieu (completename) + recenter
async function locationGroupItems({ where, take }) {
  const [groups, total] = await Promise.all([
    prisma.ticket.groupBy({
      by: ['locationId'],
      where: { ...where, locationId: { not: null } },
      _count: true,
      orderBy: { _count: { locationId: 'desc' } },
      take,
    }),
    prisma.ticket.groupBy({
      by: ['locationId'],
      where: { ...where, locationId: { not: null } },
    }).then((rows) => rows.length),
  ]);
  const locations = await prisma.location.findMany({
    where: { id: { in: groups.map((g) => g.locationId) } },
    select: { id: true, name: true, completename: true },
  });
  const byId = new Map(locations.map((l) => [l.id, l]));
  return {
    total,
    items: groups.map((g) => {
      const l = byId.get(g.locationId);
      return {
        kind: 'lieu',
        id: g.locationId,
        label: l ? (l.completename || l.name) : `Lieu ${g.locationId}`,
        count: g._count,
        recenter: { center: 'lieu', id: g.locationId },
      };
    }),
  };
}

// Liste de tickets normalisée (count + findMany en parallèle)
async function ticketList(where, { all, take, orderBy } = {}) {
  const limit = all ? LIST_MAX : (take ?? FAN_MAX);
  const order = orderBy || [{ priority: 'asc' }, { createdAt: 'desc' }];
  const [total, rows] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({ where, select: TICKET_SELECT, orderBy: order, take: limit }),
  ]);
  return { total, items: rows.map(ticketItem) };
}

async function problemList(where, { all, take } = {}) {
  const limit = all ? LIST_MAX : (take ?? FAN_MAX);
  const [total, rows] = await Promise.all([
    prisma.problem.count({ where }),
    prisma.problem.findMany({
      where,
      select: PROBLEM_SELECT,
      orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }],
      take: limit,
    }),
  ]);
  return { total, items: rows.map(problemItem) };
}

async function assetList(where, { all, take } = {}) {
  const limit = all ? LIST_MAX : (take ?? FAN_MAX);
  const [total, rows] = await Promise.all([
    prisma.asset.count({ where }),
    prisma.asset.findMany({
      where,
      select: {
        id: true, name: true, assetType: true, serialNumber: true,
        inventoryNumber: true, status: true, locationId: true,
      },
      orderBy: { name: 'asc' },
      take: limit,
    }),
  ]);
  return { total, items: await assetItems(rows) };
}

// Enfants directs d'un lieu : hiérarchie encodée dans completename
// ("Siège > Bâtiment A > Salle 201", pas de parentId en base).
// Repli : si aucun rang intermédiaire n'existe en ligne, premier segment
// de chaque branche (représentant = ligne la plus courte).
async function childLocations(center, { all, take } = {}) {
  const prefix = `${center.completename || center.name} > `;
  const candidates = await prisma.location.findMany({
    where: { isActive: true, completename: { startsWith: prefix }, id: { not: center.id } },
    select: { id: true, name: true, completename: true },
    take: 300,
  });
  let children = candidates.filter((l) => !(l.completename || '').slice(prefix.length).includes(' > '));
  if (children.length === 0) {
    const bySeg = new Map();
    for (const l of candidates) {
      const seg = (l.completename || '').slice(prefix.length).split(' > ')[0];
      const cur = bySeg.get(seg);
      if (!cur || (l.completename || '').length < (cur.completename || '').length) bySeg.set(seg, l);
    }
    children = [...bySeg.values()];
  }
  const total = children.length;
  const limit = all ? LIST_MAX : (take ?? FAN_MAX);
  const shown = children.slice(0, limit).sort((a, b) => a.name.localeCompare(b.name));
  const counts = shown.length
    ? await prisma.ticket.groupBy({
        by: ['locationId'],
        where: { ...OPEN, locationId: { in: shown.map((l) => l.id) } },
        _count: true,
      })
    : [];
  const countById = new Map(counts.map((c) => [c.locationId, c._count]));
  return {
    total,
    items: shown.map((l) => ({
      kind: 'lieu',
      id: l.id,
      label: l.name,
      meta: l.completename || undefined,
      count: countById.get(l.id) || 0,
      recenter: { center: 'lieu', id: l.id },
    })),
  };
}

// ── Définitions de kinds ───────────────────────────────────────────────────
// Chaque kind : label, notFound, parseId, exists, loadCenter, categories[...]
// cat = { key, label, count(id), items(id, { all, take }) }

const tecnicienCategories = [
  {
    key: 'tickets',
    label: 'Tickets ouverts',
    count: (id) => prisma.ticket.count({ where: { ...OPEN, assignedToId: id } }),
    items: (id, o) => ticketList({ ...OPEN, assignedToId: id }, o),
  },
  {
    key: 'lieux',
    label: 'Lieux',
    count: (id) => prisma.ticket
      .groupBy({ by: ['locationId'], where: { ...OPEN, assignedToId: id, locationId: { not: null } } })
      .then((rows) => rows.length),
    items: (id, o) => locationGroupItems({ where: { ...OPEN, assignedToId: id }, take: o?.take }),
  },
  {
    key: 'sla',
    label: 'SLA dépassé',
    count: (id) => prisma.ticket.count({ where: { ...OPEN, assignedToId: id, slaBreachedAt: { not: null } } }),
    items: (id, o) => ticketList(
      { ...OPEN, assignedToId: id, slaBreachedAt: { not: null } },
      { ...o, orderBy: [{ slaBreachedAt: 'asc' }, { priority: 'asc' }] }
    ),
  },
  {
    key: 'equipements',
    label: 'Équipements',
    count: (id) => prisma.asset.count({
      where: { tickets: { some: { ticket: { assignedToId: id, ...NOT_DELETED } } } },
    }),
    items: (id, o) => assetList(
      { tickets: { some: { ticket: { assignedToId: id, ...NOT_DELETED } } } },
      o
    ),
  },
  {
    key: 'problemes',
    label: 'Problèmes',
    count: (id) => prisma.problem.count({ where: { assignedToId: id, ...PROBLEM_OPEN } }),
    items: (id, o) => problemList({ assignedToId: id, ...PROBLEM_OPEN }, o),
  },
  {
    key: 'demandeurs',
    label: 'Demandeurs',
    count: (id) => prisma.ticket
      .groupBy({
        by: ['requesterId'],
        where: { ...OPEN, assignedToId: id, requesterId: { not: null } },
      })
      .then((rows) => rows.length),
    items: (id, o) => userGroupItems({
      where: { ...OPEN, assignedToId: id },
      by: 'requesterId',
      kind: 'demandeur',
      take: o?.all ? LIST_MAX : (o?.take ?? FAN_MAX),
    }),
  },
  {
    key: 'equipe',
    label: 'Équipe',
    count: async (id) => {
      const u = await prisma.user.findUnique({ where: { id }, select: { teamId: true } });
      return u?.teamId ? 1 : 0;
    },
    items: async (id) => {
      const u = await prisma.user.findUnique({ where: { id }, select: { teamId: true } });
      if (!u?.teamId) return { total: 0, items: [] };
      const t = await prisma.team.findUnique({ where: { id: u.teamId } });
      return { total: t ? 1 : 0, items: t ? [teamItem(t)] : [] };
    },
  },
  {
    key: 'competences',
    label: 'Compétences',
    count: (id) => prisma.userSkill.count({ where: { userId: id } }),
    items: async (id, o) => {
      const limit = o?.all ? LIST_MAX : (o?.take ?? FAN_MAX);
      const [total, rows] = await Promise.all([
        prisma.userSkill.count({ where: { userId: id } }),
        prisma.userSkill.findMany({
          where: { userId: id },
          select: { level: true, skill: { select: { id: true, name: true, category: true } } },
          orderBy: { level: 'desc' },
          take: limit,
        }),
      ]);
      return { total, items: rows.map((r) => skillItem(r.skill, r.level)) };
    },
  },
];

const lieuCategories = [
  {
    key: 'tickets',
    label: 'Tickets ouverts',
    count: (id) => prisma.ticket.count({ where: { ...OPEN, locationId: id } }),
    items: (id, o) => ticketList({ ...OPEN, locationId: id }, o),
  },
  {
    key: 'techniciens',
    label: 'Techniciens',
    count: (id) => prisma.ticket
      .groupBy({ by: ['assignedToId'], where: { ...OPEN, locationId: id, assignedToId: { not: null } } })
      .then((rows) => rows.length),
    items: (id, o) => userGroupItems({
      where: { ...OPEN, locationId: id },
      by: 'assignedToId',
      kind: 'technicien',
      take: o?.all ? LIST_MAX : (o?.take ?? FAN_MAX),
    }),
  },
  {
    key: 'sla',
    label: 'SLA dépassé',
    count: (id) => prisma.ticket.count({ where: { ...OPEN, locationId: id, slaBreachedAt: { not: null } } }),
    items: (id, o) => ticketList(
      { ...OPEN, locationId: id, slaBreachedAt: { not: null } },
      { ...o, orderBy: [{ slaBreachedAt: 'asc' }, { priority: 'asc' }] }
    ),
  },
  {
    key: 'equipements',
    label: 'Équipements',
    count: (id) => prisma.asset.count({ where: { locationId: id } }),
    items: (id, o) => assetList({ locationId: id }, o),
  },
  {
    key: 'sous-lieux',
    label: 'Sous-lieux',
    count: async (id) => {
      const loc = await prisma.location.findUnique({
        where: { id },
        select: { id: true, name: true, completename: true },
      });
      if (!loc) return 0;
      return (await childLocations(loc, { take: 1 })).total;
    },
    items: async (id, o) => {
      const loc = await prisma.location.findUnique({
        where: { id },
        select: { id: true, name: true, completename: true },
      });
      if (!loc) return { total: 0, items: [] };
      return childLocations(loc, o);
    },
  },
  {
    key: 'problemes',
    label: 'Problèmes',
    count: (id) => prisma.problem.count({ where: { locationId: id, ...PROBLEM_OPEN } }),
    items: (id, o) => problemList({ locationId: id, ...PROBLEM_OPEN }, o),
  },
  {
    key: 'demandeurs',
    label: 'Demandeurs',
    count: (id) => prisma.ticket
      .groupBy({
        by: ['requesterId'],
        where: { ...OPEN, locationId: id, requesterId: { not: null } },
      })
      .then((rows) => rows.length),
    items: (id, o) => userGroupItems({
      where: { ...OPEN, locationId: id },
      by: 'requesterId',
      kind: 'demandeur',
      take: o?.all ? LIST_MAX : (o?.take ?? FAN_MAX),
    }),
  },
];

async function ticketCenter(id) {
  return prisma.ticket.findUnique({
    where: { id, deletedAt: null },
    select: {
      id: true, title: true, status: true, priority: true, type: true, origin: true,
      category: true, locationId: true, locationName: true, teamId: true,
      sourceEmail: true, requesterId: true, secondaryRequesterId: true, requesterIds: true,
      assignedToId: true, assignedTo: { select: { id: true, fullName: true } },
      assignees: { select: { id: true, fullName: true } },
      observers: { select: { id: true, fullName: true } },
      requester: { select: { id: true, fullName: true, email: true } },
      secondaryRequester: { select: { id: true, fullName: true, email: true } },
      team: { select: { id: true, name: true } },
    },
  });
}

const ticketCategories = [
  {
    key: 'liens',
    label: 'Liens & problèmes',
    count: async (id) => {
      const [links, probs] = await Promise.all([
        prisma.ticketLink.count({ where: { OR: [{ ticketAId: id }, { ticketBId: id }] } }),
        prisma.problemTicket.count({ where: { ticketId: id } }),
      ]);
      return links + probs;
    },
    items: async (id, o) => {
      const limit = o?.all ? LIST_MAX : (o?.take ?? FAN_MAX);
      const [links, probs] = await Promise.all([
        prisma.ticketLink.findMany({
          where: { OR: [{ ticketAId: id }, { ticketBId: id }] },
          select: { ticketAId: true, ticketBId: true },
          take: limit,
        }),
        prisma.problemTicket.findMany({
          where: { ticketId: id },
          select: { problem: { select: PROBLEM_SELECT } },
          take: limit,
        }),
      ]);
      const otherIds = links.map((l) => (l.ticketAId === id ? l.ticketBId : l.ticketAId))
        .filter((x) => x !== id);
      const others = otherIds.length
        ? await prisma.ticket.findMany({
            where: { id: { in: otherIds }, ...NOT_DELETED },
            select: TICKET_SELECT,
          })
        : [];
      const items = [
        ...others.map(ticketItem),
        ...probs.map((p) => problemItem(p.problem)),
      ].slice(0, limit);
      const total = links.length + probs.length;
      return { total, items };
    },
  },
  {
    key: 'acteurs',
    label: 'Acteurs',
    count: async (id) => {
      const t = await ticketCenter(id);
      if (!t) return 0;
      const techIds = new Set([
        ...(t.assignedTo ? [t.assignedTo.id] : []),
        ...t.assignees.map((u) => u.id),
        ...t.observers.map((u) => u.id),
      ]);
      const demIds = new Set([
        ...(t.requester ? [t.requester.id] : []),
        ...(t.secondaryRequester ? [t.secondaryRequester.id] : []),
        ...t.requesterIds,
      ]);
      return techIds.size + demIds.size;
    },
    items: async (id) => {
      const t = await ticketCenter(id);
      if (!t) return { total: 0, items: [] };
      const techById = new Map();
      for (const u of [t.assignedTo, ...t.assignees, ...t.observers]) {
        if (u) techById.set(u.id, u);
      }
      const demIds = new Set([
        ...(t.requester ? [t.requester.id] : []),
        ...(t.secondaryRequester ? [t.secondaryRequester.id] : []),
        ...t.requesterIds,
      ]);
      const known = new Map();
      for (const u of [t.requester, t.secondaryRequester]) if (u) known.set(u.id, u);
      const missing = [...demIds].filter((x) => !known.has(x));
      const fetched = missing.length
        ? await prisma.user.findMany({
            where: { id: { in: missing } },
            select: { id: true, fullName: true, email: true },
          })
        : [];
      for (const u of fetched) known.set(u.id, u);
      const items = [
        ...[...techById.values()].map((u) => userItem(u, 'technicien')),
        ...[...known.values()].map((u) => userItem(u, 'demandeur')),
      ];
      return { total: items.length, items };
    },
  },
  {
    key: 'contexte',
    label: 'Contexte',
    count: async (id) => {
      const t = await ticketCenter(id);
      if (!t) return 0;
      const cat = t.category
        ? await prisma.ticketCategory.findFirst({ where: { name: t.category } })
        : null;
      return (t.locationId ? 1 : 0) + (t.team ? 1 : 0) + (cat ? 1 : 0);
    },
    items: async (id) => {
      const t = await ticketCenter(id);
      if (!t) return { total: 0, items: [] };
      const items = [];
      if (t.locationId) {
        items.push({
          kind: 'lieu',
          id: t.locationId,
          label: t.locationName || `Lieu ${t.locationId}`,
          recenter: { center: 'lieu', id: t.locationId },
        });
      }
      if (t.category) {
        const cat = await prisma.ticketCategory.findFirst({ where: { name: t.category } });
        if (cat) items.push(categoryItem(cat));
      }
      if (t.team) items.push(teamItem(t.team));
      return { total: items.length, items };
    },
  },
  {
    key: 'equipements',
    label: 'Équipements',
    count: (id) => prisma.assetTicket.count({ where: { ticketId: id } }),
    items: async (id, o) => {
      const limit = o?.all ? LIST_MAX : (o?.take ?? FAN_MAX);
      const [total, links] = await Promise.all([
        prisma.assetTicket.count({ where: { ticketId: id } }),
        prisma.assetTicket.findMany({
          where: { ticketId: id },
          select: {
            asset: {
              select: {
                id: true, name: true, assetType: true, serialNumber: true,
                inventoryNumber: true, status: true, locationId: true,
              },
            },
          },
          take: limit,
        }),
      ]);
      return { total, items: await assetItems(links.map((l) => l.asset)) };
    },
  },
  {
    key: 'provenance',
    label: 'Provenance',
    count: async (id) => {
      const t = await prisma.ticket.findUnique({
        where: { id },
        select: { sourceEmail: true, origin: true, type: true },
      });
      if (!t) return 0;
      return (t.sourceEmail ? 1 : 0) + (t.origin ? 1 : 0) + (t.type ? 1 : 0);
    },
    items: async (id) => {
      const t = await prisma.ticket.findUnique({
        where: { id },
        select: { sourceEmail: true, origin: true, type: true },
      });
      if (!t) return { total: 0, items: [] };
      const items = [];
      if (t.sourceEmail) {
        const rep = await prisma.senderReputation.findUnique({ where: { email: t.sourceEmail } });
        items.push(rep ? senderItem(rep) : {
          kind: 'expediteur',
          id: t.sourceEmail,
          label: t.sourceEmail,
          recenter: { center: 'expediteur', id: t.sourceEmail },
          href: `/tickets?sourceEmail=${encodeURIComponent(t.sourceEmail)}`,
        });
      }
      if (t.origin) {
        items.push(virtualItem('origine', t.origin, ORIGIN_LABEL[t.origin] || t.origin));
      }
      if (t.type) {
        items.push(virtualItem('type', t.type, t.type === 'INCIDENT' ? 'Incident' : 'Demande'));
      }
      return { total: items.length, items };
    },
  },
];

const problemeCategories = [
  {
    key: 'tickets',
    label: 'Tickets liés',
    count: (id) => prisma.problemTicket.count({ where: { problemId: id } }),
    items: async (id, o) => {
      const limit = o?.all ? LIST_MAX : (o?.take ?? FAN_MAX);
      const [total, links] = await Promise.all([
        prisma.problemTicket.count({ where: { problemId: id } }),
        prisma.problemTicket.findMany({
          where: { problemId: id },
          select: { ticket: { select: TICKET_SELECT } },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
      ]);
      return { total, items: links.map((l) => ticketItem(l.ticket)) };
    },
  },
  {
    key: 'acteurs',
    label: 'Acteurs',
    count: async (id) => {
      const p = await prisma.problem.findUnique({
        where: { id },
        select: {
          assignedToId: true, requesterId: true, teamId: true,
          assignees: { select: { id: true } },
        },
      });
      if (!p) return 0;
      const techs = new Set([...(p.assignedToId ? [p.assignedToId] : []), ...p.assignees.map((u) => u.id)]);
      return techs.size + (p.requesterId ? 1 : 0) + (p.teamId ? 1 : 0);
    },
    items: async (id) => {
      const p = await prisma.problem.findUnique({
        where: { id },
        select: {
          assignedTo: { select: { id: true, fullName: true } },
          assignees: { select: { id: true, fullName: true } },
          requester: { select: { id: true, fullName: true, email: true } },
          team: { select: { id: true, name: true } },
        },
      });
      if (!p) return { total: 0, items: [] };
      const techById = new Map();
      for (const u of [p.assignedTo, ...p.assignees]) if (u) techById.set(u.id, u);
      const items = [
        ...[...techById.values()].map((u) => userItem(u, 'technicien')),
        ...(p.requester ? [userItem(p.requester, 'demandeur')] : []),
        ...(p.team ? [teamItem(p.team)] : []),
      ];
      return { total: items.length, items };
    },
  },
  {
    key: 'lies',
    label: 'Problèmes liés',
    count: async (id) => {
      const [a, b] = await Promise.all([
        prisma.problemLink.count({ where: { problemAId: id } }),
        prisma.problemLink.count({ where: { problemBId: id } }),
      ]);
      return a + b;
    },
    items: async (id, o) => {
      const limit = o?.all ? LIST_MAX : (o?.take ?? FAN_MAX);
      const links = await prisma.problemLink.findMany({
        where: { OR: [{ problemAId: id }, { problemBId: id }] },
        select: { problemAId: true, problemBId: true },
        take: limit,
      });
      const otherIds = links.map((l) => (l.problemAId === id ? l.problemBId : l.problemAId))
        .filter((x) => x !== id);
      const others = otherIds.length
        ? await prisma.problem.findMany({
            where: { id: { in: otherIds } },
            select: PROBLEM_SELECT,
            orderBy: { updatedAt: 'desc' },
          })
        : [];
      return { total: others.length, items: others.map(problemItem) };
    },
  },
  {
    key: 'contexte',
    label: 'Contexte',
    count: async (id) => {
      const p = await prisma.problem.findUnique({
        where: { id },
        select: { locationId: true, category: true },
      });
      if (!p) return 0;
      const cat = p.category
        ? await prisma.ticketCategory.findFirst({ where: { name: p.category } })
        : null;
      return (p.locationId ? 1 : 0) + (cat ? 1 : 0);
    },
    items: async (id) => {
      const p = await prisma.problem.findUnique({
        where: { id },
        select: { locationId: true, locationName: true, category: true },
      });
      if (!p) return { total: 0, items: [] };
      const items = [];
      if (p.locationId) {
        items.push({
          kind: 'lieu',
          id: p.locationId,
          label: p.locationName || `Lieu ${p.locationId}`,
          recenter: { center: 'lieu', id: p.locationId },
        });
      }
      if (p.category) {
        const cat = await prisma.ticketCategory.findFirst({ where: { name: p.category } });
        if (cat) items.push(categoryItem(cat));
      }
      return { total: items.length, items };
    },
  },
];

const categorieCategories = [
  {
    key: 'hierarchie',
    label: 'Hiérarchie',
    count: async (id) => {
      const c = await prisma.ticketCategory.findUnique({
        where: { id },
        select: { parentId: true, _count: { select: { children: true } } },
      });
      if (!c) return 0;
      return (c.parentId ? 1 : 0) + c._count.children;
    },
    items: async (id, o) => {
      const limit = o?.all ? LIST_MAX : (o?.take ?? FAN_MAX);
      const c = await prisma.ticketCategory.findUnique({
        where: { id },
        select: { id: true, name: true, parentId: true },
      });
      if (!c) return { total: 0, items: [] };
      const [parent, children] = await Promise.all([
        c.parentId
          ? prisma.ticketCategory.findUnique({
              where: { id: c.parentId },
              select: { id: true, name: true, parentId: true },
            })
          : null,
        prisma.ticketCategory.findMany({
          where: { parentId: id },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
          take: limit,
        }),
      ]);
      const items = [
        ...(parent ? [categoryItem(parent, { meta: 'Catégorie parente' })] : []),
        ...children.map((ch) => categoryItem(ch, { meta: 'Sous-catégorie' })),
      ].slice(0, limit);
      return { total: (parent ? 1 : 0) + children.length, items };
    },
  },
  {
    key: 'tickets',
    label: 'Tickets ouverts',
    count: async (id) => {
      const c = await prisma.ticketCategory.findUnique({ where: { id }, select: { name: true } });
      if (!c) return 0;
      return prisma.ticket.count({ where: { ...OPEN, category: c.name } });
    },
    items: async (id, o) => {
      const c = await prisma.ticketCategory.findUnique({ where: { id }, select: { name: true } });
      if (!c) return { total: 0, items: [] };
      return ticketList({ ...OPEN, category: c.name }, o);
    },
  },
  {
    key: 'techniciens',
    label: 'Techniciens',
    count: async (id) => {
      const c = await prisma.ticketCategory.findUnique({ where: { id }, select: { name: true } });
      if (!c) return 0;
      return prisma.ticket
        .groupBy({
          by: ['assignedToId'],
          where: { ...OPEN, category: c.name, assignedToId: { not: null } },
        })
        .then((rows) => rows.length);
    },
    items: async (id, o) => {
      const c = await prisma.ticketCategory.findUnique({ where: { id }, select: { name: true } });
      if (!c) return { total: 0, items: [] };
      return userGroupItems({
        where: { ...OPEN, category: c.name },
        by: 'assignedToId',
        kind: 'technicien',
        take: o?.all ? LIST_MAX : (o?.take ?? FAN_MAX),
      });
    },
  },
  {
    key: 'demandeurs',
    label: 'Demandeurs',
    count: async (id) => {
      const c = await prisma.ticketCategory.findUnique({ where: { id }, select: { name: true } });
      if (!c) return 0;
      return prisma.ticket
        .groupBy({
          by: ['requesterId'],
          where: { ...OPEN, category: c.name, requesterId: { not: null } },
        })
        .then((rows) => rows.length);
    },
    items: async (id, o) => {
      const c = await prisma.ticketCategory.findUnique({ where: { id }, select: { name: true } });
      if (!c) return { total: 0, items: [] };
      return userGroupItems({
        where: { ...OPEN, category: c.name },
        by: 'requesterId',
        kind: 'demandeur',
        take: o?.all ? LIST_MAX : (o?.take ?? FAN_MAX),
      });
    },
  },
];

const equipeCategories = [
  {
    key: 'membres',
    label: 'Membres',
    count: (id) => prisma.user.count({ where: { teamId: id, isActive: true } }),
    items: async (id, o) => {
      const limit = o?.all ? LIST_MAX : (o?.take ?? FAN_MAX);
      const [total, users] = await Promise.all([
        prisma.user.count({ where: { teamId: id, isActive: true } }),
        prisma.user.findMany({
          where: { teamId: id, isActive: true },
          select: { id: true, fullName: true, role: true },
          orderBy: { fullName: 'asc' },
          take: limit,
        }),
      ]);
      return {
        total,
        items: users.map((u) => {
          const item = userItem(u, 'technicien');
          item.meta = u.role;
          return item;
        }),
      };
    },
  },
  {
    key: 'tickets',
    label: 'Tickets ouverts',
    count: (id) => prisma.ticket.count({ where: { ...OPEN, teamId: id } }),
    items: (id, o) => ticketList({ ...OPEN, teamId: id }, o),
  },
  {
    key: 'problemes',
    label: 'Problèmes',
    count: (id) => prisma.problem.count({ where: { teamId: id, ...PROBLEM_OPEN } }),
    items: (id, o) => problemList({ teamId: id, ...PROBLEM_OPEN }, o),
  },
  {
    key: 'equipements',
    label: 'Équipements',
    count: (id) => prisma.asset.count({ where: { teamId: id } }),
    items: (id, o) => assetList({ teamId: id }, o),
  },
  {
    key: 'demandeurs',
    label: 'Demandeurs',
    count: (id) => prisma.ticket
      .groupBy({
        by: ['requesterId'],
        where: { ...OPEN, teamId: id, requesterId: { not: null } },
      })
      .then((rows) => rows.length),
    items: (id, o) => userGroupItems({
      where: { ...OPEN, teamId: id },
      by: 'requesterId',
      kind: 'demandeur',
      take: o?.all ? LIST_MAX : (o?.take ?? FAN_MAX),
    }),
  },
];

const demandeurTicketsWhere = (id) => ({
  ...OPEN,
  OR: [{ requesterId: id }, { requesterIds: { has: id } }],
});

const demandeurCategories = [
  {
    key: 'tickets',
    label: 'Tickets ouverts',
    count: (id) => prisma.ticket.count({ where: demandeurTicketsWhere(id) }),
    items: (id, o) => ticketList(demandeurTicketsWhere(id), o),
  },
  {
    key: 'lieux',
    label: 'Lieux',
    count: (id) => prisma.ticket
      .groupBy({
        by: ['locationId'],
        where: { ...demandeurTicketsWhere(id), locationId: { not: null } },
      })
      .then((rows) => rows.length),
    items: (id, o) => locationGroupItems({
      where: demandeurTicketsWhere(id),
      take: o?.all ? LIST_MAX : (o?.take ?? FAN_MAX),
    }),
  },
  {
    key: 'equipe',
    label: 'Équipe',
    count: async (id) => {
      const u = await prisma.user.findUnique({ where: { id }, select: { teamId: true } });
      return u?.teamId ? 1 : 0;
    },
    items: async (id) => {
      const u = await prisma.user.findUnique({ where: { id }, select: { teamId: true } });
      if (!u?.teamId) return { total: 0, items: [] };
      const t = await prisma.team.findUnique({ where: { id: u.teamId } });
      return { total: t ? 1 : 0, items: t ? [teamItem(t)] : [] };
    },
  },
  {
    key: 'equipements',
    label: 'Équipements',
    count: (id) => prisma.asset.count({ where: { ownerId: id } }),
    items: (id, o) => assetList({ ownerId: id }, o),
  },
  {
    key: 'problemes',
    label: 'Problèmes',
    count: (id) => prisma.problem.count({ where: { requesterId: id, ...PROBLEM_OPEN } }),
    items: (id, o) => problemList({ requesterId: id, ...PROBLEM_OPEN }, o),
  },
];

async function skillUserIds(skillId) {
  const rows = await prisma.userSkill.findMany({
    where: { skillId },
    select: { userId: true, level: true },
    orderBy: { level: 'desc' },
  });
  return rows;
}

const skillCategories = [
  {
    key: 'techniciens',
    label: 'Techniciens',
    count: (id) => prisma.userSkill.count({ where: { skillId: id } }),
    items: async (id, o) => {
      const limit = o?.all ? LIST_MAX : (o?.take ?? FAN_MAX);
      const [total, rows] = await Promise.all([
        prisma.userSkill.count({ where: { skillId: id } }),
        prisma.userSkill.findMany({
          where: { skillId: id },
          select: { level: true, user: { select: { id: true, fullName: true, isActive: true } } },
          orderBy: { level: 'desc' },
          take: limit,
        }),
      ]);
      const active = rows.filter((r) => r.user.isActive !== false);
      return {
        total,
        items: active.map((r) => {
          const item = userItem(r.user, 'technicien');
          item.meta = `Niveau ${r.level}`;
          return item;
        }),
      };
    },
  },
  {
    key: 'tickets',
    label: 'Tickets ouverts',
    count: async (id) => {
      const rows = await skillUserIds(id);
      if (rows.length === 0) return 0;
      return prisma.ticket.count({
        where: { ...OPEN, assignedToId: { in: rows.map((r) => r.userId) } },
      });
    },
    items: async (id, o) => {
      const rows = await skillUserIds(id);
      if (rows.length === 0) return { total: 0, items: [] };
      return ticketList({ ...OPEN, assignedToId: { in: rows.map((r) => r.userId) } }, o);
    },
  },
  {
    key: 'categories',
    label: 'Catégories',
    count: async (id) => {
      const s = await prisma.skill.findUnique({ where: { id }, select: { category: true } });
      if (!s?.category) return 0;
      return prisma.ticketCategory.count({ where: { name: s.category } });
    },
    items: async (id, o) => {
      const limit = o?.all ? LIST_MAX : (o?.take ?? FAN_MAX);
      const s = await prisma.skill.findUnique({ where: { id }, select: { category: true } });
      if (!s?.category) return { total: 0, items: [] };
      const c = await prisma.ticketCategory.findFirst({ where: { name: s.category } });
      if (!c) return { total: 0, items: [] };
      const children = await prisma.ticketCategory.findMany({
        where: { parentId: c.id },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        take: limit,
      });
      const items = [categoryItem(c), ...children.map((ch) => categoryItem(ch, { meta: 'Sous-catégorie' }))];
      return { total: 1 + children.length, items: items.slice(0, limit) };
    },
  },
];

const senderDomain = (email) => String(email).split('@')[1] || '';

const expediteurCategories = [
  {
    key: 'tickets',
    label: 'Tickets (tous statuts)',
    count: (email) => prisma.ticket.count({ where: { ...NOT_DELETED, sourceEmail: email } }),
    items: (email, o) => ticketList(
      { ...NOT_DELETED, sourceEmail: email },
      { ...o, orderBy: [{ createdAt: 'desc' }] }
    ),
  },
  {
    key: 'domaine',
    label: 'Mêmes domaines',
    count: (email) => prisma.senderReputation.count({
      where: { domain: senderDomain(email), email: { not: email } },
    }),
    items: async (email, o) => {
      const limit = o?.all ? LIST_MAX : (o?.take ?? FAN_MAX);
      const [total, rows] = await Promise.all([
        prisma.senderReputation.count({
          where: { domain: senderDomain(email), email: { not: email } },
        }),
        prisma.senderReputation.findMany({
          where: { domain: senderDomain(email), email: { not: email } },
          orderBy: { ticketsTotal: 'desc' },
          take: limit,
        }),
      ]);
      return { total, items: rows.map((r) => senderItem(r)) };
    },
  },
  {
    key: 'demandeurs',
    label: 'Compte utilisateur',
    count: (email) => prisma.user.count({ where: { email } }),
    items: async (email) => {
      const users = await prisma.user.findMany({
        where: { email },
        select: { id: true, fullName: true, email: true },
        take: 2,
      });
      return { total: users.length, items: users.map((u) => userItem(u, 'demandeur')) };
    },
  },
];

function virtualCategories(kind) {
  const where = (id) => (kind === 'origine' ? { origin: id } : { type: id });
  return [
    {
      key: 'tickets',
      label: 'Tickets ouverts',
      count: (id) => prisma.ticket.count({ where: { ...OPEN, ...where(id) } }),
      items: (id, o) => ticketList({ ...OPEN, ...where(id) }, o),
    },
    {
      key: 'techniciens',
      label: 'Techniciens',
      count: (id) => prisma.ticket
        .groupBy({
          by: ['assignedToId'],
          where: { ...OPEN, ...where(id), assignedToId: { not: null } },
        })
        .then((rows) => rows.length),
      items: (id, o) => userGroupItems({
        where: { ...OPEN, ...where(id) },
        by: 'assignedToId',
        kind: 'technicien',
        take: o?.all ? LIST_MAX : (o?.take ?? FAN_MAX),
      }),
    },
  ];
}

// ── Registre ───────────────────────────────────────────────────────────────

function makeCenter(kind, label, sub) {
  return (data) => ({ center: { type: kind, id: data.id, label, sub } });
}

const NODE_KINDS = {
  technicien: {
    label: 'Technicien',
    notFound: 'Technicien introuvable',
    parseId,
    exists: async (id) => {
      const u = await prisma.user.findUnique({ where: { id }, select: { id: true, isActive: true } });
      return !!u && u.isActive;
    },
    loadCenter: async (id) => {
      const user = await prisma.user.findUnique({
        where: { id },
        select: { id: true, fullName: true, role: true, isActive: true, teamId: true },
      });
      if (!user || !user.isActive) return null;
      const counts = await Promise.all(tecnicienCategories.map((c) => c.count(id)));
      return {
        center: { type: 'technicien', id: user.id, label: user.fullName, sub: user.role },
        categories: tecnicienCategories.map((c, i) => ({ key: c.key, label: c.label, count: counts[i] })),
      };
    },
    categories: tecnicienCategories,
  },

  lieu: {
    label: 'Lieu',
    notFound: 'Lieu introuvable',
    parseId,
    exists: async (id) => !!(await prisma.location.findUnique({ where: { id }, select: { id: true } })),
    loadCenter: async (id) => {
      const location = await prisma.location.findUnique({
        where: { id },
        select: { id: true, name: true, completename: true },
      });
      if (!location) return null;
      const counts = await Promise.all(lieuCategories.map((c) => c.count(id)));
      return {
        center: {
          type: 'lieu',
          id: location.id,
          label: location.completename || location.name,
          sub: 'Lieu',
        },
        categories: lieuCategories.map((c, i) => ({ key: c.key, label: c.label, count: counts[i] })),
      };
    },
    categories: lieuCategories,
  },

  ticket: {
    label: 'Ticket',
    notFound: 'Ticket introuvable',
    parseId,
    exists: async (id) => !!(await ticketCenter(id)),
    loadCenter: async (id) => {
      const t = await ticketCenter(id);
      if (!t) return null;
      const counts = await Promise.all(ticketCategories.map((c) => c.count(id)));
      return {
        center: {
          type: 'ticket',
          id: t.id,
          label: t.title,
          sub: t.status,
          ref: `#${t.id}`,
        },
        categories: ticketCategories.map((c, i) => ({ key: c.key, label: c.label, count: counts[i] })),
      };
    },
    categories: ticketCategories,
  },

  probleme: {
    label: 'Problème',
    notFound: 'Problème introuvable',
    parseId,
    exists: async (id) => !!(await prisma.problem.findUnique({ where: { id }, select: { id: true } })),
    loadCenter: async (id) => {
      const p = await prisma.problem.findUnique({
        where: { id },
        select: { id: true, title: true, status: true },
      });
      if (!p) return null;
      const counts = await Promise.all(problemeCategories.map((c) => c.count(id)));
      return {
        center: { type: 'probleme', id: p.id, label: p.title, sub: p.status },
        categories: problemeCategories.map((c, i) => ({ key: c.key, label: c.label, count: counts[i] })),
      };
    },
    categories: problemeCategories,
  },

  categorie: {
    label: 'Catégorie',
    notFound: 'Catégorie introuvable',
    parseId,
    exists: async (id) => !!(await prisma.ticketCategory.findUnique({ where: { id }, select: { id: true } })),
    loadCenter: async (id) => {
      const c = await prisma.ticketCategory.findUnique({
        where: { id },
        select: { id: true, name: true, parentId: true },
      });
      if (!c) return null;
      const counts = await Promise.all(categorieCategories.map((x) => x.count(id)));
      return {
        center: { type: 'categorie', id: c.id, label: c.name, sub: 'Catégorie' },
        categories: categorieCategories.map((x, i) => ({ key: x.key, label: x.label, count: counts[i] })),
      };
    },
    categories: categorieCategories,
  },

  equipe: {
    label: 'Équipe',
    notFound: 'Équipe introuvable',
    parseId,
    exists: async (id) => !!(await prisma.team.findUnique({ where: { id }, select: { id: true } })),
    loadCenter: async (id) => {
      const t = await prisma.team.findUnique({
        where: { id },
        select: { id: true, name: true, groupEmail: true },
      });
      if (!t) return null;
      const counts = await Promise.all(equipeCategories.map((c) => c.count(id)));
      return {
        center: { type: 'equipe', id: t.id, label: t.name, sub: 'Équipe' },
        categories: equipeCategories.map((c, i) => ({ key: c.key, label: c.label, count: counts[i] })),
      };
    },
    categories: equipeCategories,
  },

  demandeur: {
    label: 'Demandeur',
    notFound: 'Demandeur introuvable',
    parseId,
    exists: async (id) => !!(await prisma.user.findUnique({ where: { id }, select: { id: true } })),
    loadCenter: async (id) => {
      const u = await prisma.user.findUnique({
        where: { id },
        select: { id: true, fullName: true, email: true, role: true },
      });
      if (!u) return null;
      const counts = await Promise.all(demandeurCategories.map((c) => c.count(id)));
      return {
        center: { type: 'demandeur', id: u.id, label: u.fullName, sub: u.role || u.email },
        categories: demandeurCategories.map((c, i) => ({ key: c.key, label: c.label, count: counts[i] })),
      };
    },
    categories: demandeurCategories,
  },

  skill: {
    label: 'Compétence',
    notFound: 'Compétence introuvable',
    parseId,
    exists: async (id) => !!(await prisma.skill.findUnique({ where: { id }, select: { id: true } })),
    loadCenter: async (id) => {
      const s = await prisma.skill.findUnique({
        where: { id },
        select: { id: true, name: true, category: true },
      });
      if (!s) return null;
      const counts = await Promise.all(skillCategories.map((c) => c.count(id)));
      return {
        center: { type: 'skill', id: s.id, label: s.name, sub: s.category || 'Compétence' },
        categories: skillCategories.map((c, i) => ({ key: c.key, label: c.label, count: counts[i] })),
      };
    },
    categories: skillCategories,
  },

  expediteur: {
    label: 'Expéditeur',
    notFound: 'Expéditeur introuvable',
    parseId: (v) => {
      const e = String(v || '').trim().toLowerCase();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null;
    },
    exists: async (email) => {
      const [rep, t, u] = await Promise.all([
        prisma.senderReputation.findUnique({ where: { email }, select: { email: true } }),
        prisma.ticket.findFirst({ where: { sourceEmail: email }, select: { id: true } }),
        prisma.user.findFirst({ where: { email }, select: { id: true } }),
      ]);
      return !!(rep || t || u);
    },
    loadCenter: async (email) => {
      const [rep, t] = await Promise.all([
        prisma.senderReputation.findUnique({ where: { email } }),
        prisma.ticket.findFirst({ where: { sourceEmail: email }, select: { id: true } }),
      ]);
      if (!rep && !t) return null;
      const counts = await Promise.all(expediteurCategories.map((c) => c.count(email)));
      return {
        center: {
          type: 'expediteur',
          id: email,
          label: email,
          sub: rep ? rep.status : 'Expéditeur',
        },
        categories: expediteurCategories.map((c, i) => ({ key: c.key, label: c.label, count: counts[i] })),
      };
    },
    categories: expediteurCategories,
  },

  origine: {
    label: 'Origine',
    notFound: 'Origine inconnue',
    parseId: (v) => {
      const s = String(v || '').toUpperCase();
      return ORIGINS.includes(s) ? s : null;
    },
    exists: async (v) => ORIGINS.includes(String(v || '').toUpperCase()),
    loadCenter: async (v) => {
      const id = String(v || '').toUpperCase();
      if (!ORIGINS.includes(id)) return null;
      const counts = await Promise.all(virtualCategories('origine').map((c) => c.count(id)));
      return {
        center: { type: 'origine', id, label: ORIGIN_LABEL[id], sub: 'Origine' },
        categories: virtualCategories('origine').map((c, i) => ({ key: c.key, label: c.label, count: counts[i] })),
      };
    },
    categories: virtualCategories('origine'),
  },

  type: {
    label: 'Type',
    notFound: 'Type inconnu',
    parseId: (v) => {
      const s = String(v || '').toUpperCase();
      return TICKET_TYPES.includes(s) ? s : null;
    },
    exists: async (v) => TICKET_TYPES.includes(String(v || '').toUpperCase()),
    loadCenter: async (v) => {
      const id = String(v || '').toUpperCase();
      if (!TICKET_TYPES.includes(id)) return null;
      const counts = await Promise.all(virtualCategories('type').map((c) => c.count(id)));
      return {
        center: { type: 'type', id, label: id === 'INCIDENT' ? 'Incident' : 'Demande', sub: 'Type' },
        categories: virtualCategories('type').map((c, i) => ({ key: c.key, label: c.label, count: counts[i] })),
      };
    },
    categories: virtualCategories('type'),
  },
};

// ── Voisinage (mode réseau de neurones) ────────────────────────────────────
// Graphe 1-2 sauts autour d'un centre : nœuds + liens, strictement borné.
// Les catégories « sla » sont ignorées (sous-ensemble de « tickets »).

const NEIGHBORHOOD_NODE_CAP = 60;
const NEIGHBORHOOD_LINK_CAP = 150;
const NEIGHBORHOOD_SEEDS = 4;

async function neighborhood(kind, id, depth = 2) {
  const def = NODE_KINDS[kind];
  if (!def) return { error: { status: 400, message: 'Type de nœud inconnu' } };
  const parsed = def.parseId(id);
  if (!parsed) return { error: { status: 400, message: 'Identifiant invalide' } };
  const center = await def.loadCenter(parsed);
  if (!center) return { error: { status: 404, message: def.notFound } };

  const nodes = new Map();
  const links = [];
  const centerKey = `${kind}:${parsed}`;
  nodes.set(centerKey, {
    key: centerKey,
    kind,
    id: parsed,
    label: center.center.label,
    sub: center.center.sub,
    isCenter: true,
  });

  // Phase 1 — fetch parallèle des catégories d'une source (les requêtes DB
  // partent en même temps au lieu d'une par une) ; phase 2 — fusion séquentielle
  // dans l'ordre des catégories pour garder un résultat déterministe (tests).
  const fetchAll = (srcId, categories, take) => Promise.all(
    categories
      .filter((c) => c.key !== 'sla') // catégorie « sla » = sous-ensemble de « tickets »
      .map(async (cat) => {
        try {
          const res = await cat.items(srcId, { take });
          return { cat, items: res.items || [] };
        } catch {
          return { cat, items: [] }; // centre disparu / relation vide : branche vide
        }
      }),
  );

  const merge = (sourceKey, results) => {
    for (const { cat, items } of results) {
      if (nodes.size >= NEIGHBORHOOD_NODE_CAP) return;
      for (const item of items) {
        if (item == null || item.id == null || item.kind == null) continue;
        const key = `${item.kind}:${item.id}`;
        if (!nodes.has(key) && nodes.size < NEIGHBORHOOD_NODE_CAP) {
          nodes.set(key, {
            key,
            kind: item.kind,
            id: item.id,
            label: item.label,
            sub: item.meta,
            count: item.count,
          });
        }
        if (nodes.has(key) && key !== sourceKey) {
          links.push({ source: sourceKey, target: key, rel: cat.key });
        }
        if (nodes.size >= NEIGHBORHOOD_NODE_CAP) break;
      }
    }
  };

  merge(centerKey, await fetchAll(parsed, def.categories, depth >= 2 ? 4 : 6));

  if (depth >= 2) {
    const seeds = [...nodes.values()]
      .filter((n) => !n.isCenter && NODE_KINDS[n.kind])
      .slice(0, NEIGHBORHOOD_SEEDS);
    // Toutes les graines sont chargées en parallèle, fusionnées ensuite dans
    // l'ordre (le plafond de nœuds reste appliqué pendant la fusion).
    const fetched = await Promise.all(
      seeds.map(async (seed) => ({
        sourceKey: `${seed.kind}:${seed.id}`,
        results: await fetchAll(seed.id, NODE_KINDS[seed.kind].categories, 2),
      })),
    );
    for (const { sourceKey, results } of fetched) {
      if (nodes.size >= NEIGHBORHOOD_NODE_CAP) break;
      merge(sourceKey, results);
    }
  }

  // Dédoublonnage des liens (source, target) — le premier rel rencontré gagne
  const seen = new Set();
  const uniqueLinks = [];
  for (const l of links) {
    const k = `${l.source}>${l.target}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniqueLinks.push(l);
    if (uniqueLinks.length >= NEIGHBORHOOD_LINK_CAP) break;
  }

  return {
    center: { kind, id: parsed, label: center.center.label, sub: center.center.sub },
    nodes: [...nodes.values()],
    links: uniqueLinks,
  };
}

module.exports = {
  NODE_KINDS,
  neighborhood,
  OPEN_STATUSES,
  NOT_DELETED,
  OPEN,
  PROBLEM_OPEN,
  PROBLEM_STATUS_LABEL,
  STAFF_ROLES,
  FAN_MAX,
  LIST_MAX,
  parseId,
  ticketItem,
  TICKET_SELECT,
  PROBLEM_SELECT,
  assetItems,
  // eslint-disable-next-line no-unused-vars
  makeCenter,
};
