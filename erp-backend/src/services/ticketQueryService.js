const prisma = require('../prismaClient');

// ── Périmètre RBAC des tickets ───────────────────────────────────────────────
// Fonctions déplacées depuis routes/ticket.routes.js pour être réutilisables par
// les services (chatbot, rapports email) sans passer par le routeur Express.

// Un compte REQUESTER (créé automatiquement via AD/LDAP ou manuellement) ne voit que ses propres
// tickets : liste, détail, pièces jointes, corrections et export sont forcés sur ses tickets —
// aucun contenu des autres demandeurs ne doit fuiter, même si le client manipule les filtres.
function isRequesterOnly(user) {
  return user.role === 'REQUESTER';
}

function buildTicketSearchCondition(rawTerm) {
  if (!rawTerm || typeof rawTerm !== 'string') return null;
  const term = rawTerm.trim();
  if (!term) return null;

  const conditions = [
    { title: { contains: term, mode: 'insensitive' } },
    { content: { contains: term, mode: 'insensitive' } },
    { category: { contains: term, mode: 'insensitive' } },
    { locationName: { contains: term, mode: 'insensitive' } },
    { sourceEmail: { contains: term, mode: 'insensitive' } },
    { sourceName: { contains: term, mode: 'insensitive' } },
    { sourceSubject: { contains: term, mode: 'insensitive' } },
    { aiSummary: { contains: term, mode: 'insensitive' } },
    { requester: { fullName: { contains: term, mode: 'insensitive' } } },
    { requester: { email: { contains: term, mode: 'insensitive' } } },
    { secondaryRequester: { fullName: { contains: term, mode: 'insensitive' } } },
    { secondaryRequester: { email: { contains: term, mode: 'insensitive' } } },
    { assignedTo: { fullName: { contains: term, mode: 'insensitive' } } },
    { assignedTo: { email: { contains: term, mode: 'insensitive' } } },
    { assignees: { some: { fullName: { contains: term, mode: 'insensitive' } } } },
    { assignees: { some: { email: { contains: term, mode: 'insensitive' } } } },
    { team: { name: { contains: term, mode: 'insensitive' } } },
    { observers: { some: { fullName: { contains: term, mode: 'insensitive' } } } },
    { observers: { some: { email: { contains: term, mode: 'insensitive' } } } },
  ];

  // Identifiant numérique (#9, ticket #9, ou 9)
  const numericStr = term.replace(/^#/, '').replace(/^ticket\s*#?/i, '').trim();
  const numericId = parseInt(numericStr, 10);
  if (!isNaN(numericId) && numericId > 0 && String(numericId) === numericStr) {
    conditions.push({ id: numericId });
  }

  // Recherche par niveau de priorité (P1, P2, P3, P4)
  const upperTerm = term.toUpperCase();
  if (['P1', 'P2', 'P3', 'P4'].includes(upperTerm)) {
    conditions.push({ priority: upperTerm });
  }

  return { OR: conditions };
}

// Statut → condition Prisma. Comprend les groupes utilisés par l'UI (Ouverts,
// En attente, Résolus, Fermés, Non résolus) en plus d'un statut exact.
// Renvoie null si aucun filtre n'est demandé — réutilisé par les exports.
function statusToCondition(status) {
  if (!status) return null;
  if (status === 'OPEN_GROUP') return { status: { in: ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER'] } };
  if (status === 'PENDING_GROUP' || status === 'PENDING') return { status: { in: ['PENDING', 'WAITING_FOR_USER'] } };
  if (status === 'CLOSED_GROUP') return { status: { in: ['SOLVED', 'CLOSED'] } };
  if (status === 'NOT_CLOSED') return { status: { notIn: ['SOLVED', 'CLOSED'] } };
  if (status === 'SOLVED_GROUP') return { status: 'SOLVED' };
  return { status };
}

function buildTicketWhereClause(user, queryParams = {}) {
  const {
    status, priority, teamId, assignedToId, mine, title, search, query,
    category, locationId, aiProcessed, due, closeSuggested, approvalStatus,
    dateFrom, dateTo, source, origin, replyOnClosedSuggested,
    resolutionFrom, resolutionTo, slaBreached,
  } = queryParams;

  const andConditions = [
    { deletedAt: null },
  ];

  if (approvalStatus) {
    andConditions.push({ approvalStatus });
  } else {
    andConditions.push({ approvalStatus: { notIn: ['PENDING', 'REJECTED'] } });
  }

  if (isRequesterOnly(user)) {
    andConditions.push({
      OR: [
        { requesterId: user.sub },
        { secondaryRequesterId: user.sub },
        { requesterIds: { has: user.sub } },
        { observers: { some: { id: user.sub } } },
      ],
    });
  }

  const statusCond = statusToCondition(status);
  if (statusCond) andConditions.push(statusCond);

  if (priority) andConditions.push({ priority });
  if (source) andConditions.push({ source });
  if (origin) andConditions.push({ origin });
  if (teamId) andConditions.push({ teamId: Number(teamId) });

  if (assignedToId === 'none') {
    andConditions.push({ assignedToId: null, assignees: { none: {} } });
  } else if (assignedToId) {
    const techId = Number(assignedToId);
    andConditions.push({
      OR: [
        { assignedToId: techId },
        { assignees: { some: { id: techId } } },
      ],
    });
  }

  if (category) andConditions.push({ category: { contains: category, mode: 'insensitive' } });
  if (locationId) andConditions.push({ locationId: Number(locationId) });
  if (aiProcessed === 'true') andConditions.push({ aiProcessed: true });

  if (mine === 'true') {
    if (user.role === 'REQUESTER') {
      andConditions.push({
        OR: [
          { requesterId: user.sub },
          { observers: { some: { id: user.sub } } },
        ],
      });
    } else {
      andConditions.push({
        OR: [
          { assignedToId: user.sub },
          { assignees: { some: { id: user.sub } } },
          { requesterId: user.sub },
          { observers: { some: { id: user.sub } } },
        ],
      });
    }
  }

  if (approvalStatus) andConditions.push({ approvalStatus });

  if (due === 'overdue') {
    andConditions.push({ dueDate: { not: null, lt: new Date() } });
    if (!status) andConditions.push({ status: { notIn: ['SOLVED', 'CLOSED'] } });
  } else if (due === 'due') {
    andConditions.push({ dueDate: { not: null } });
  } else if (due === 'undue') {
    andConditions.push({ dueDate: null });
  }

  if (closeSuggested === 'true') andConditions.push({ closeSuggested: true });
  if (closeSuggested === 'false') andConditions.push({ closeSuggested: false });

  // Drill-down « Résolus » du dashboard : la résolution (passage en SOLVED puis CLOSED)
  // doit être survenue dans la fenêtre, même si le ticket est créé avant. On force le statut
  // résolu : la réouverture ne remet pas solvedAt à null, un ticket réouvert n'est pas résolu.
  if (resolutionFrom || resolutionTo) {
    const cond = {};
    if (resolutionFrom) cond.gte = new Date(resolutionFrom);
    if (resolutionTo) {
      const end = new Date(resolutionTo);
      if (!resolutionTo.includes('T')) end.setHours(23, 59, 59, 999);
      cond.lte = end;
    }
    andConditions.push({ status: { in: ['SOLVED', 'CLOSED'] } });
    andConditions.push({ OR: [{ solvedAt: cond }, { closedAt: cond }] });
  }

  // Drill-down « SLA dépassés » : slaBreachedAt (distinct de due=overdue = dueDate < maintenant)
  if (slaBreached === 'true') andConditions.push({ slaBreachedAt: { not: null } });
  else if (slaBreached === 'false') andConditions.push({ slaBreachedAt: null });

  if (replyOnClosedSuggested === 'true') andConditions.push({ replyOnClosedSuggested: true });
  if (replyOnClosedSuggested === 'false') andConditions.push({ replyOnClosedSuggested: false });

  if (dateFrom || dateTo) {
    const dateCond = {};
    if (dateFrom) dateCond.gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      // Only append end-of-day if no time was provided (plain date like "2026-09-13")
      if (!dateTo.includes('T')) end.setHours(23, 59, 59, 999);
      dateCond.lte = end;
    }
    andConditions.push({ createdAt: dateCond });
  }

  const searchQuery = title || search || query;
  const searchCond = buildTicketSearchCondition(searchQuery);
  if (searchCond) {
    andConditions.push(searchCond);
  }

  return { AND: andConditions };
}

module.exports = { isRequesterOnly, buildTicketSearchCondition, buildTicketWhereClause, statusToCondition };
