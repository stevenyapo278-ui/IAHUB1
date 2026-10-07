const express = require('express');
const { body, validationResult } = require('express-validator');
const path = require('path');
const fs = require('fs');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { notifyMajorIncidentResolved, sendTicketStatusNotification, sendResolvedNotificationEmail, sendTicketCreationNotification, sendAcknowledgement, sendAssignmentNotificationEmail, sendEmail } = require('../services/emailSender');
const { approveTicket } = require('../services/ticketApproval');
const { isRequesterOnly, buildTicketWhereClause } = require('../services/ticketQueryService');
const { buildTicketsXlsxBuffer, buildTicketsCsv, decorateCategoryPaths } = require('../services/ticketReportService');
const { autoAssignTechnician } = require('../services/ticketAutoAssign');
const { logEvent } = require('../services/ticketEvent');
const { auditLog } = require('../services/auditLogService');
const { emitTicketCreated, emitTicketUpdated, emitTicketAssigned } = require('../utils/socket');
const { recordDecision } = require('../services/senderReputation');
const { applySla, recordFirstResponse } = require('../services/slaService');
const { escalateTicket } = require('../services/escalationService');
const { mergeTickets } = require('../services/ticketMergeService');
const { normalizeLinkType, normalizeLinkEndpoints, normalizeParentChildType, resolveChildrenIds } = require('../utils/ticketLinks');
const { formatTicketTitle, UNDETERMINED } = require('../utils/ticketTitle');
const { sanitizeTicketHtml } = require('../utils/security');
const { loadCidMap, resolveHtml } = require('../services/emailHtml');
const multer = require('multer');
const { validateUpload, safeFilename: makeSafeFilename } = require('../utils/security');

const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } }); // 20 Mo max
const router = express.Router();
router.use(authenticate);

// ── Matrice de transitions de statut autorisées ─────────────────────────
// Seules ces transitions sont permises côté API. Les changements système
// (auto-close, email pipeline, etc.) utilisent Prisma directement et
// ne passent pas par ces endpoints.
const VALID_TRANSITIONS = {
  NEW:              ['OPEN', 'WAITING_FOR_USER', 'CLOSED', 'SOLVED'],
  OPEN:             ['PLANNED', 'PENDING', 'WAITING_FOR_USER', 'SOLVED', 'CLOSED'],
  PLANNED:          ['OPEN', 'PENDING', 'WAITING_FOR_USER', 'SOLVED', 'CLOSED'],
  PENDING:          ['OPEN', 'PLANNED', 'WAITING_FOR_USER', 'SOLVED', 'CLOSED'],
  WAITING_FOR_USER: ['OPEN', 'PENDING', 'SOLVED', 'CLOSED'],
  SOLVED:           ['OPEN', 'CLOSED'],
  CLOSED:           ['OPEN'],
};

function canTransition(from, to) {
  if (from === to) return true;
  const allowed = VALID_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

const STATUS_LABELS = {
  NEW: 'Nouveau', OPEN: 'Ouvert', PLANNED: 'Planifié',
  PENDING: 'En attente', WAITING_FOR_USER: 'En attente utilisateur',
  SOLVED: 'Résolu', CLOSED: 'Fermé',
};

// Un technicien ne voit que les tickets qui lui sont assignés ou qu'il a ouverts.
function isTechnicianOnly(user) {
  return user.role === 'TECHNICIAN';
}

// RÈGLE : un TECHNICIAN n'est jamais admin — il ne peut pas modifier les champs
// d'un ticket (titre, contenu, priorité, catégorie, lieu, assignation, demandeur,
// approbation, liens, fusion, suppression...), même si le ticket lui est assigné.
// Seule exception : le STATUT, et uniquement sur un ticket de SON ÉQUIPE.
// Un ticket assigné hors de son équipe reste en lecture seule (suivis et pièces
// jointes uniquement). Ce garde-fou s'applique par RÔLE, quel que soit le groupe
// de droits : aucune permission ne peut l'assouplir.
const TECHNICIAN_EDIT_ERROR = 'Un technicien ne peut modifier que le statut des tickets de son équipe.';
const TECHNICIAN_READONLY_ERROR = 'Ticket hors de votre équipe : lecture seule. Ajoutez un suivi ou une pièce jointe.';

function forbidTechnicianTicketEdits(req, res, next) {
  if (req.user && req.user.role === 'TECHNICIAN') {
    return res.status(403).json({ error: TECHNICIAN_EDIT_ERROR });
  }
  next();
}

// Middleware PATCH : un TECHNICIAN ne peut envoyer que { status }, et seulement
// sur un ticket actif de SON ÉQUIPE. Un ticket qui lui est assigné mais qui
// appartient à une autre équipe (ou sans équipe) est en lecture seule.
// Les autres rôles passent directement.
async function allowTechnicianStatusOnly(req, res, next) {
  if (!req.user || req.user.role !== 'TECHNICIAN') return next();

  const id = Number(req.params.id);
  const bodyKeys = Object.keys(req.body || {});

  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      select: { status: true, teamId: true },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

    // Un technicien ne peut apporter aucune modification si le ticket est résolu ou fermé
    if (['SOLVED', 'CLOSED'].includes(ticket.status)) {
      return res.status(403).json({ error: 'Aucune modification ne peut être apportée par un technicien sur un ticket résolu ou fermé.' });
    }

    // Hors équipe (même si assigné) → lecture seule
    const isTeamTicket = Boolean(ticket.teamId) && ticket.teamId === req.user.teamId;
    if (!isTeamTicket) {
      return res.status(403).json({ error: TECHNICIAN_READONLY_ERROR });
    }

    // Ticket de l'équipe du technicien → statut uniquement
    if (bodyKeys.some((k) => k !== 'status')) {
      return res.status(403).json({ error: TECHNICIAN_EDIT_ERROR });
    }

    req.isTechnicianStatusOnly = true;
  } catch (err) {
    return res.status(500).json({ error: 'Erreur lors de la vérification des droits.' });
  }

  next();
}

function requireTicketAssignOrTechnicianStatusOnly(req, res, next) {
  if (req.isTechnicianStatusOnly) return next();
  return requirePermission('tickets.assign', ['ADMIN', 'TECHNICIAN'])(req, res, next);
}

// ── Compteurs affichés sur les chips de filtre (« P1 (12) ») ──────────────────
// Même périmètre RBAC que la liste ; chaque compteur ignore le filtre de SA propre
// dimension pour montrer les alternatives disponibles (mode facettes).
router.get('/facets', async (req, res) => {
  const facetWhere = (omitKey) => {
    const q = { ...req.query };
    delete q[omitKey];
    delete q.page;
    delete q.limit;
    delete q.sortBy;
    delete q.sortOrder;
    return buildTicketWhereClause(req.user, q);
  };

  const [byPriority, byStatus, total, unassigned, aiProcessedCount, closeSuggestedCount] = await Promise.all([
    prisma.ticket.groupBy({ by: ['priority'], where: facetWhere('priority'), _count: true }),
    prisma.ticket.groupBy({ by: ['status'], where: facetWhere('status'), _count: true }),
    prisma.ticket.count({ where: facetWhere(null) }),
    prisma.ticket.count({ where: { AND: [facetWhere('assignedToId'), { assignedToId: null, assignees: { none: {} } }] } }),
    prisma.ticket.count({ where: { AND: [facetWhere('aiProcessed'), { aiProcessed: true }] } }),
    prisma.ticket.count({ where: { AND: [facetWhere('closeSuggested'), { closeSuggested: true }] } }),
  ]);

  const priority = {};
  for (const row of byPriority) priority[row.priority || 'NONE'] = row._count;
  const status = {};
  for (const row of byStatus) status[row.status] = row._count;

  const countOf = (keys) => keys.reduce((n, k) => n + (status[k] || 0), 0);
  const OPEN_GROUP_STATUSES = ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER'];
  const closed = countOf(['SOLVED', 'CLOSED']);

  return res.json({
    priority,
    status,
    groups: {
      OPEN_GROUP: countOf(OPEN_GROUP_STATUSES),
      PENDING_GROUP: countOf(['PENDING', 'WAITING_FOR_USER']),
      CLOSED_GROUP: closed,
      NOT_CLOSED: total - closed,
    },
    flags: { unassigned: unassigned, aiProcessed: aiProcessedCount, closeSuggested: closeSuggestedCount },
    total,
  });
});

// List tickets (with optional filters + pagination + sorting)
router.get('/', async (req, res) => {
  const { limit, page, sortBy, sortOrder } = req.query;

  const pageNum = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(limit) || 50));
  const skip = (pageNum - 1) * pageSize;

  const where = buildTicketWhereClause(req.user, req.query);

  // Tri dynamique
  let orderBy = { createdAt: 'desc' };
  if (sortBy) {
    const order = sortOrder === 'asc' ? 'asc' : 'desc';
    if (sortBy === 'id') orderBy = { id: order };
    else if (sortBy === 'createdAt') orderBy = { createdAt: order };
    else if (sortBy === 'title') orderBy = { title: order };
    else if (sortBy === 'priority') orderBy = { priority: order };
    else if (sortBy === 'status') orderBy = { status: order };
    else if (sortBy === 'assignedTo') orderBy = { assignedTo: { fullName: order } };
    else if (sortBy === 'requester') orderBy = { requester: { fullName: order } };
    else if (sortBy === 'updatedAt') orderBy = { updatedAt: order };
  }

  // Stats calculées en une seule passe GROUP BY (status × priorité) au lieu de
  // 6 COUNT séparés — chaque COUNT re-scançait l'ensemble filtré (recherche
  // textuelle comprise) à chaque appel, et cet endpoint est pollé toutes les 15 s.
  const [tickets, total, breakdown, aiCount, unassignedCount] = await Promise.all([
    prisma.ticket.findMany({
      where,
      skip,
      take: pageSize,
      include: {
        requester: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        secondaryRequester: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        assignedTo: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        assignees: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        createdBy: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        team: { select: { id: true, name: true } },
        observers: { select: { id: true, fullName: true, avatarUrl: true } },
      },
      orderBy,
    }),
    prisma.ticket.count({ where }),
    prisma.ticket.groupBy({ where, by: ['status', 'priority'], _count: true }),
    prisma.ticket.count({ where: { ...where, aiProcessed: true } }),
    prisma.ticket.count({ where: { ...where, assignedToId: null } }),
  ]);

  // Agrégation des compteurs de statut/priorité côté serveur (coût négligeable :
  // au plus ~6 statuts × 4 priorités lignes retournées par le GROUP BY).
  let openCount = 0, pendingCount = 0, solvedCount = 0, closedCount = 0, p1Count = 0, p2Count = 0;
  for (const row of breakdown) {
    const n = row._count;
    if (['NEW', 'OPEN', 'PLANNED'].includes(row.status)) openCount += n;
    else if (['PENDING', 'WAITING_FOR_USER'].includes(row.status)) pendingCount += n;
    else if (row.status === 'SOLVED') solvedCount += n;
    else if (row.status === 'CLOSED') closedCount += n;
    if (row.priority === 'P1') p1Count += n;
    else if (row.priority === 'P2') p2Count += n;
  }
  const resolvedCount = solvedCount + closedCount;

  // Badge « clôtures souvent injustifiées » : quand on liste les clôtures suggérées, on attache
  // à chaque ticket si son expéditeur est dégradé sur les clôtures (feedback de la Hotline).
  if (req.query.closeSuggested === 'true' && tickets.length > 0) {
    const emails = [...new Set(tickets.map((t) => t.sourceEmail).filter((e) => e && e.includes('@')))];
    if (emails.length > 0) {
      const reputations = await prisma.senderReputation.findMany({
        where: { email: { in: emails } },
        select: { email: true, closureStatus: true },
      });
      const byEmail = Object.fromEntries(reputations.map((r) => [r.email.toLowerCase().trim(), r.closureStatus]));
      for (const t of tickets) {
        if (t.sourceEmail && byEmail[t.sourceEmail.toLowerCase().trim()] === 'LOW_TRUST_CLOSURE') {
          t.lowTrustClosureSender = true;
        }
      }
    }
  }

  return res.json({
    items: tickets, total, page: pageNum, pages: Math.ceil(total / pageSize),
    stats: {
      open: openCount,
      pending: pendingCount,
      solved: solvedCount,
      closed: closedCount,
      resolved: resolvedCount,
      p1: p1Count,
      p2: p2Count,
      ai: aiCount,
      unassigned: unassignedCount,
    },
  });
});

// Export serveur : mêmes filtres que la liste, dataset complet (pas de pagination UI)
router.get('/export', async (req, res) => {
  const { sortBy, sortOrder, format } = req.query;

  const where = buildTicketWhereClause(req.user, req.query);

  let orderBy = { createdAt: 'desc' };
  if (sortBy) {
    const order = sortOrder === 'asc' ? 'asc' : 'desc';
    orderBy = { [sortBy]: order };
  }

  const tickets = await prisma.ticket.findMany({
    where,
    take: 10000,
    orderBy,
    select: {
      id: true, title: true, status: true, priority: true, category: true, type: true,
      source: true, requesterId: true, assignedToId: true, teamId: true,
      locationName: true,
      createdAt: true, solvedAt: true, closedAt: true,
      slaResponseDueAt: true, slaResolutionDueAt: true, slaBreachedAt: true, firstResponseAt: true,
      aiProcessed: true, approvalStatus: true, requester: { select: { email: true, fullName: true, avatarUrl: true } },
      assignedTo: { select: { email: true, fullName: true, avatarUrl: true } },
      assignees: { select: { id: true, email: true, fullName: true, avatarUrl: true } },
      team: { select: { name: true } },
      observers: { select: { id: true, fullName: true, avatarUrl: true } },
    },
  });

  // Catégorie racine + sous-catégorie pour le CSV et le JSON (le XLSX se décore lui-même)
  await decorateCategoryPaths(tickets);

  if (format === 'xlsx') {
    const buffer = await buildTicketsXlsxBuffer(tickets);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="tickets_export_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    return res.send(buffer);
  }

  if (format === 'csv') {
    const csv = await buildTicketsCsv(tickets);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tickets_export_${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send('\uFEFF' + csv);
  }

  return res.json({ items: tickets, total: tickets.length });
});

// Actions groupées : changement de statut/priorité/assignation/équipe sur une sélection de tickets
router.post(
  '/bulk-update',
  requirePermission('tickets.assign', ['ADMIN', 'TECHNICIAN']),
  [body('ids').isArray({ min: 1 }), body('ids.*').isInt()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    if (req.body.ids.length > 500) return res.status(400).json({ error: 'Maximum 500 tickets par opération groupée' });

    const { ids, status, priority, assignedToId, teamId } = req.body;
    if (!status && !priority && assignedToId === undefined && teamId === undefined) {
      return res.status(400).json({ error: 'Au moins une modification est requise (status, priority, assignedToId, teamId)' });
    }

    // Valider les valeurs de statut et priorité
    const VALID_STATUSES = ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'SOLVED', 'CLOSED', 'WAITING_FOR_USER'];
    const VALID_PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Statut invalide : ${status}. Valeurs acceptées : ${VALID_STATUSES.join(', ')}` });
    }
    if (priority && !VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: `Priorité invalide : ${priority}. Valeurs acceptées : ${VALID_PRIORITIES.join(', ')}` });
    }

    const data = {};
    if (status) data.status = status;
    if (priority) data.priority = priority;
    if (assignedToId !== undefined) data.assignedToId = assignedToId || null;
    if (teamId !== undefined) data.teamId = teamId || null;

    let updatedCount = 0;
    const failures = [];

    for (const id of ids) {
      try {
        const before = await prisma.ticket.findUnique({
          where: { id },
          select: { status: true, priority: true },
        });
        if (!before) { failures.push({ id, error: 'Ticket introuvable' }); continue; }

        // Valider la transition de statut
        if (status && !canTransition(before.status, status)) {
          failures.push({ id, error: `Transition invalide : ${STATUS_LABELS[before.status] || before.status} → ${STATUS_LABELS[status] || status}` });
          continue;
        }

        const ticket = await prisma.ticket.update({
          where: { id },
          data: {
            ...data,
            ...(data.status === 'SOLVED' ? { solvedAt: new Date() } : {}),
            ...(data.status === 'CLOSED' ? { closedAt: new Date() } : {}),
            // Clôture groupée : consommer la suggestion de clôture éventuelle (cohérence
            // avec la clôture individuelle — sinon le ticket restait dans le Centre de Validation)
            ...((data.status === 'SOLVED' || data.status === 'CLOSED') ? { closeSuggested: false, closeSuggestedAt: null, closeSuggestionConfidence: null } : {}),
          },
        });

        // SLA recalculé si la priorité change
        if (data.priority) {
          try { await applySla(ticket); } catch (err) { console.error('[ticket.routes] Recalcul SLA bulk échoué:', err.message); }
        }

        emitTicketUpdated(ticket, { status, priority, assignedToId });
        if (data.assignedToId && String(before?.assignedToId) !== String(data.assignedToId)) {
          emitTicketAssigned(ticket.id, ticket.title, Number(data.assignedToId), 'manual');
          prisma.user.findUnique({ where: { id: Number(data.assignedToId) }, select: { email: true, fullName: true } })
            .then((tech) => {
              if (tech?.email) {
                sendAssignmentNotificationEmail({
                  ticketId: ticket.id, ticketTitle: ticket.title, priority: ticket.priority,
                  technicianEmail: tech.email, technicianName: tech.fullName, category: ticket.category,
                }).catch((e) => console.error('[ticket.routes] Échec notification assignation bulk:', e.message));
              }
            }).catch(() => {});
        }
        if (data.status) notifyRequesterOnStatusChange(id, data.status);

        // Auto-apprentissage pour les bulk-resolutions
        if (data.status === 'SOLVED' || data.status === 'CLOSED') {
          const { learnFromResolution } = require('../services/skillLearningService');
          learnFromResolution(id).catch((err) =>
            console.error(`[ticket.routes] Échec apprentissage bulk ticket ${id}:`, err.message)
          );
        }

        updatedCount += 1;
      } catch (err) {
        failures.push({ id, error: err.message });
      }
    }

    return res.json({ updatedCount, total: ids.length, failures });
  }
);

// Retourne les IDs des tickets adjacents (premier, précédent, suivant, dernier) par ordre numérique d'ID.
//   - "first" (<<) = ticket avec le plus petit ID (ex: #1)
//   - "prev"  (<)  = ticket avec l'ID immédiatement inférieur (ex: #128534 si courant = #128535)
//   - "next"  (>)  = ticket avec l'ID immédiatement supérieur (ex: #128536 si courant = #128535)
//   - "last"  (>>) = ticket avec le plus grand ID (ex: #128625)
router.get('/:id/adjacent', async (req, res) => {
  const id = Number(req.params.id);
  const current = await prisma.ticket.findUnique({ where: { id }, select: { id: true } });
  if (!current) return res.status(404).json({ error: 'Ticket introuvable' });

  // La navigation ‹ › hérite des MÊMES filtres que la liste GET /tickets (params identiques :
  // status, priority, teamId, search, approvalStatus, …) — le frontend les transmet tels quels.
  // buildTicketWhereClause exclut TOUJOURS la corbeille (deletedAt: null) et applique le périmètre
  // demandeur/technicien ; sans filtre approvalStatus explicite, les tickets PENDING/REJECTED
  // sont ignorés comme dans la liste par défaut.
  const where = buildTicketWhereClause(req.user, req.query);

  const [first, prev, next, last] = await Promise.all([
    // Premier (<<) : ID min
    prisma.ticket.findFirst({
      where,
      orderBy: { id: 'asc' },
      select: { id: true },
    }),
    // Précédent (<) : ID immédiatement inférieur (numéro inférieur)
    prisma.ticket.findFirst({
      where: { ...where, id: { lt: id } },
      orderBy: { id: 'desc' },
      select: { id: true },
    }),
    // Suivant (>) : ID immédiatement supérieur (numéro supérieur)
    prisma.ticket.findFirst({
      where: { ...where, id: { gt: id } },
      orderBy: { id: 'asc' },
      select: { id: true },
    }),
    // Dernier (>>) : ID max
    prisma.ticket.findFirst({
      where,
      orderBy: { id: 'desc' },
      select: { id: true },
    }),
  ]);

  return res.json({
    first: first?.id !== id ? first?.id ?? null : null,
    prev:  prev?.id  !== id ? prev?.id  ?? null : null,
    next:  next?.id  !== id ? next?.id  ?? null : null,
    last:  last?.id  !== id ? last?.id  ?? null : null,
  });
});

// Get single ticket with followups
// Liste des tickets dans la corbeille — AVANT '/:id' sinon '/trash/list' serait capturé par '/:id'
router.get('/trash/list', async (req, res) => {
  if (!req.user || !['SUPERADMIN', 'ADMIN'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  const items = await prisma.ticket.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: 'desc' },
    take: 200,
    include: {
      requester: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
      secondaryRequester: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
      assignedTo: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
      deletedBy: { select: { id: true, fullName: true } },
    },
  });
  return res.json({ items });
});

router.get('/pending-approval', async (req, res) => {
  if (!req.user || !['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 100));
  const where = { approvalStatus: 'PENDING', deletedAt: null };
  if (req.user.role === 'TECHNICIAN') {
    // Un technicien ne traite que les tickets qu'il a ouverts (workflow GLPI : le validateur
    // voit sa file, pas celle des autres) — Hotline/Admin voient tout.
    where.OR = [{ requesterId: req.user.sub }, { assignedToId: req.user.sub }];
  }
  const [items, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      orderBy: [{ lowTrustSender: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: {
        id: true, title: true, content: true, status: true, priority: true,
        category: true, type: true, source: true, origin: true, sourceName: true, sourceEmail: true,
        urgency: true, impact: true, isMajorIncident: true, impactedSites: true,
        locationName: true, lowTrustSender: true, aiProcessed: true, aiSummary: true,
        approvalNote: true, approvalStatus: true,
        createdAt: true, requester: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        secondaryRequester: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        createdBy: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        assignedTo: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        team: { select: { id: true, name: true } },
        observers: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
      },
    }),
    prisma.ticket.count({ where }),
  ]);
  return res.json({ items, total });
});

// ── Suggestions de triage (équipe, technicien, observateurs, priorité) ───────
// Recalculées à la volée pour un ticket en attente : compétence (UserSkill) +
// historique (tickets de même catégorie, auto-assignations corrigées) + charge
// active. Les observateurs proviennent uniquement des defaultObservers de
// l'équipe (vue Équipe). Servies au Centre de Validation pour permettre de
// corriger les champs avant d'approuver.
router.get('/:id/triage-suggestions', requirePermission('tickets.approve', ['ADMIN', 'HOTLINE', 'TECHNICIAN']), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        team: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, fullName: true } },
        observers: { select: { id: true, fullName: true } },
      },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

    const { suggestTriage } = require('../services/ticketSuggestionService');
    const suggestions = await suggestTriage(ticket);
    return res.json({
      ticketId: ticket.id,
      current: {
        title: ticket.title,
        teamId: ticket.teamId,
        teamName: ticket.team?.name || null,
        assignedToId: ticket.assignedToId,
        assignedToName: ticket.assignedTo?.fullName || null,
        priority: ticket.priority,
        category: ticket.category,
        type: ticket.type,
        impact: ticket.impact,
        urgency: ticket.urgency,
        locationId: ticket.locationId,
        locationName: ticket.locationName,
        observerIds: (ticket.observers || []).map((o) => o.id),
        observers: ticket.observers || [],
      },
      ...suggestions,
    });
  } catch (err) {
    console.error('[ticket.routes] Erreur triage-suggestions:', err);
    return res.status(500).json({ error: 'Erreur lors du calcul des suggestions' });
  }
});

// ── Preview tooltip : données allégées pour le hover ─────────────────────────
router.get('/:id/preview', async (req, res) => {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: Number(req.params.id) },
      select: {
        id: true, title: true, status: true, priority: true, category: true,
        locationName: true, aiSummary: true, createdAt: true, solvedAt: true, closedAt: true,
        slaResolutionDueAt: true, slaBreachedAt: true, firstResponseAt: true,
        source: true, origin: true, sourceName: true, isMajorIncident: true,
        team: { select: { id: true, name: true } },
        followups: {
          take: 3,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, content: true, createdAt: true, isPrivate: true,
            author: { select: { id: true, fullName: true, avatarUrl: true } },
          },
        },
      },
    });

    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

    // Masquer les commentaires privés aux demandeurs
    if (['REQUESTER'].includes(req.user.role)) {
      ticket.followups = ticket.followups.filter((f) => !f.isPrivate);
    }

    return res.json(ticket);
  } catch (err) {
    console.error('[ticket.routes] Erreur preview:', err);
    return res.status(500).json({ error: 'Erreur lors du chargement de l\'aperçu' });
  }
});

// ── Suggestions de clôture rejetées — récupération ─────────────────────
// AVANT /:id pour éviter le matching "rejected-closures" comme un id
async function fetchRejectedClosures(limit) {
  const events = await prisma.ticketEvent.findMany({
    where: { type: 'CLOSURE_REJECTED' },
    orderBy: { createdAt: 'desc' },
    take: limit * 2,
    include: {
      ticket: {
        select: {
          id: true, title: true, content: true, status: true, priority: true,
          category: true, closeSuggested: true, closeSuggestionCount: true,
          sourceEmail: true, sourceName: true, createdAt: true,
          requester: { select: { id: true, fullName: true, email: true } },
          assignedTo: { select: { id: true, fullName: true } },
        },
      },
    },
  });

  const seen = new Set();
  const rejected = [];
  for (const ev of events) {
    if (!ev.ticket || seen.has(ev.ticket.id)) continue;
    if (['SOLVED', 'CLOSED'].includes(ev.ticket.status)) continue;
    if (ev.ticket.closeSuggested) continue;
    seen.add(ev.ticket.id);
      rejected.push({
        ...ev.ticket,
        rejectedAt: ev.createdAt,
        rejectionReason: ev.payload?.reason || null,
        rejectionConfidence: ev.payload?.confidence ?? null,
        // récupérable seulement si le compteur est cohérent avec POST /:id/recover-closure (>0) < MAX (2)
        canRecover: (ev.ticket.closeSuggestionCount || 0) > 0 && (ev.ticket.closeSuggestionCount || 0) < 2,
      });
    if (rejected.length >= limit) break;
  }
  return rejected;
}

router.get('/rejected-closures', requirePermission('tickets.approve', ['ADMIN', 'TECHNICIAN', 'HOTLINE']), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    return res.json(await fetchRejectedClosures(limit));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Suggestions de tickets rejetées (vue Tickets > bouton « Rejetées ») ──
// Regroupe les trois décisions négatives de la Hotline :
//   tickets     : tickets refusés (approvalStatus = REJECTED, motif dans approvalNote)
//   closures    : clôtures suggérées par l'IA puis refusées (event CLOSURE_REJECTED)
//   newRequests : suggestions « créer une nouvelle demande » ignorées (event ..._DISMISSED)
async function fetchRejectedNewRequests(limit) {
  const events = await prisma.ticketEvent.findMany({
    where: { type: 'NEW_TICKET_SUGGESTED_DISMISSED' },
    orderBy: { createdAt: 'desc' },
    take: limit * 2,
    include: {
      ticket: {
        select: {
          id: true, title: true, status: true, priority: true, category: true, createdAt: true,
          requester: { select: { id: true, fullName: true, email: true } },
          assignedTo: { select: { id: true, fullName: true } },
        },
      },
    },
  });

  const seen = new Set();
  const items = [];
  for (const ev of events) {
    if (!ev.ticket || seen.has(ev.ticket.id)) continue;
    seen.add(ev.ticket.id);
    items.push({
      ticketId: ev.ticket.id,
      title: ev.ticket.title,
      status: ev.ticket.status,
      priority: ev.ticket.priority,
      category: ev.ticket.category,
      ticketCreatedAt: ev.ticket.createdAt,
      requester: ev.ticket.requester,
      assignedTo: ev.ticket.assignedTo,
      sender: ev.payload?.sender || null,
      summary: ev.payload?.summary || null,
      dismissedAt: ev.createdAt,
      dismissedBy: ev.actor,
    });
    if (items.length >= limit) break;
  }

  // Enrichit avec la suggestion d'origine (confiance / intention de l'IA)
  if (items.length > 0) {
    const suggestions = await prisma.ticketEvent.findMany({
      where: { ticketId: { in: items.map((i) => i.ticketId) }, type: 'NEW_TICKET_SUGGESTED' },
      orderBy: { createdAt: 'desc' },
      select: { ticketId: true, createdAt: true, payload: true },
    });
    const latest = new Map();
    for (const s of suggestions) if (!latest.has(s.ticketId)) latest.set(s.ticketId, s);
    for (const item of items) {
      const suggestion = latest.get(item.ticketId);
      if (!suggestion) continue;
      item.confidence = suggestion.payload?.confidence ?? null;
      item.intent = suggestion.payload?.intent || null;
      item.suggestedAt = suggestion.createdAt;
      if (!item.summary) item.summary = suggestion.payload?.newIssueSummary || null;
    }
  }
  return items;
}

router.get('/rejected-suggestions', requirePermission('tickets.approve', ['ADMIN', 'TECHNICIAN', 'HOTLINE']), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    const [tickets, closures, newRequests] = await Promise.all([
      prisma.ticket.findMany({
        where: { approvalStatus: 'REJECTED' },
        orderBy: { approvedAt: 'desc' },
        take: limit,
        select: {
          id: true, title: true, status: true, priority: true, category: true,
          source: true, origin: true, sourceName: true, sourceEmail: true,
          createdAt: true, closedAt: true, approvedAt: true, approvalNote: true,
          requester: { select: { id: true, fullName: true, email: true } },
          assignedTo: { select: { id: true, fullName: true } },
        },
      }),
      fetchRejectedClosures(limit),
      fetchRejectedNewRequests(limit),
    ]);

    return res.json({
      tickets: tickets.map((t) => ({ ...t, rejectionReason: t.approvalNote || null })),
      closures,
      newRequests,
    });
  } catch (err) {
    console.error('[ticket.routes] Erreur rejected-suggestions:', err);
    return res.status(500).json({ error: err.message });
  }
});

// --- Réponses sur tickets fermés / résolus ---
// Liste les tickets où un demandeur a répondu à un email alors que le ticket était SOLVED ou CLOSED.
// La Hotline décide : rouvrir le ticket OU créer une nouvelle demande.
router.get('/reply-suggestions', requirePermission('tickets.approve', ['ADMIN', 'TECHNICIAN', 'HOTLINE']), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    const tickets = await prisma.ticket.findMany({
      where: { replyOnClosedSuggested: true },
      orderBy: { replyOnClosedSuggestedAt: 'desc' },
      take: limit,
      select: {
        id: true, title: true, content: true, status: true, priority: true,
        category: true, replyOnClosedSuggestedAt: true,
        replyOnClosedSender: true, replyOnClosedSubject: true,
        sourceEmail: true, sourceName: true, createdAt: true,
        requester: { select: { id: true, fullName: true, email: true } },
        assignedTo: { select: { id: true, fullName: true } },
      },
    });

    return res.json(tickets);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Rouvrir un ticket fermé suite à une réponse du demandeur
router.post('/:id/accept-reply-suggestion/reopen', requirePermission('tickets.approve', ['ADMIN', 'TECHNICIAN', 'HOTLINE']), async (req, res) => {
  const id = Number(req.params.id);
  try {
    const ticket = await prisma.ticket.findUnique({ where: { id } });
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
    if (!ticket.replyOnClosedSuggested) return res.status(400).json({ error: 'Aucune suggestion de réponse sur ticket fermé en cours' });

    const updated = await prisma.ticket.update({
      where: { id },
      data: {
        status: 'OPEN',
        closedAt: null,
        replyOnClosedSuggested: false,
        replyOnClosedSuggestedAt: null,
        replyOnClosedSender: null,
        replyOnClosedSubject: null,
        replyOnClosedBody: null,
        replyOnClosedBodyHtml: null,
      },
    });

    await logEvent(id, 'REPLY_ON_CLOSED_REOPENED', req.user.email || String(req.user.sub), {
      originalStatus: ticket.status,
      sender: ticket.replyOnClosedSender,
    });

    // `io` n'existe pas dans ce module (variable locale à utils/socket) : la référence
    // provoquait un ReferenceError → 500 alors que le ticket était déjà réouvert.
    emitTicketUpdated(updated, { status: updated.status });

    return res.json({ ticket: updated, message: 'Ticket rouvert avec succès' });
  } catch (err) {
    console.error('[ticket.routes] Erreur réouverture reply-on-closed:', err);
    return res.status(500).json({ error: 'Erreur interne' });
  }
});

// Crée le ticket séparé décrit par une suggestion (réponse sur ticket fermé ou nouvelle
// demande détectée sur un ticket en cours) : titre normalisé, SLA calculé.
// Le transfert du fil Outlook (et l'extinction des flags) reste fait par l'appelant.
async function createTicketFromSuggestion(sourceTicket, { sender, title, body }) {
  const titleBase = String(title || sourceTicket.title || '')
    .replace(/^\s*(?:re|fw|fwd)\s*:\s*/gi, '')
    .trim();
  const newTitle = formatTicketTitle(titleBase) || `NOUVELLE DEMANDE SUITE AU TICKET #${sourceTicket.id}`;

  const newTicket = await prisma.ticket.create({
    data: {
      title: newTitle,
      content: body || '',
      status: 'OPEN',
      priority: sourceTicket.priority,
      category: sourceTicket.category,
      type: sourceTicket.type,
      source: 'Email',
      origin: 'EMAIL',
      requesterId: sourceTicket.requesterId,
      sourceEmail: sender || sourceTicket.sourceEmail,
      sourceName: sender || sourceTicket.sourceName,
      teamId: sourceTicket.teamId,
      // La conversation Outlook est transférée : sans ça, les prochaines réponses de
      // l'utilisateur dans ce fil se rattacheront encore au ticket d'origine et la même
      // suggestion réapparaîtrait indéfiniment dans le Centre de Validation.
      outlookConversationId: sourceTicket.outlookConversationId || null,
    },
    include: {
      requester: { select: { id: true, fullName: true, email: true } },
    },
  });

  try {
    await applySla(newTicket);
  } catch (err) {
    console.error('[ticket.routes] Calcul SLA nouvelle demande échoué:', err.message);
  }

  return newTicket;
}

// Créer une nouvelle demande suite à une réponse sur un ticket fermé
router.post('/:id/accept-reply-suggestion/new-ticket', requirePermission('tickets.approve', ['ADMIN', 'TECHNICIAN', 'HOTLINE']), async (req, res) => {
  const id = Number(req.params.id);
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: { requester: { select: { id: true, fullName: true, email: true } } },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
    if (!ticket.replyOnClosedSuggested) return res.status(400).json({ error: 'Aucune suggestion de réponse sur ticket fermé en cours' });

    const newTicket = await createTicketFromSuggestion(ticket, {
      sender: ticket.replyOnClosedSender,
      title: ticket.replyOnClosedSubject,
      body: ticket.replyOnClosedBody || ticket.replyOnClosedBodyHtml || '',
    });

    // Marquer le ticket original comme traité (suggestion consommée) + transfert de fil
    await prisma.ticket.update({
      where: { id },
      data: {
        replyOnClosedSuggested: false,
        replyOnClosedSuggestedAt: null,
        replyOnClosedSender: null,
        replyOnClosedSubject: null,
        replyOnClosedBody: null,
        replyOnClosedBodyHtml: null,
        ...(ticket.outlookConversationId ? { outlookConversationId: null } : {}),
      },
    });

    await logEvent(id, 'REPLY_ON_CLOSED_NEW_TICKET', req.user.email || String(req.user.sub), {
      originalStatus: ticket.status,
      targetTicketId: newTicket.id,
      sender: ticket.replyOnClosedSender,
    });

    await logEvent(newTicket.id, 'CREATED', req.user.email || String(req.user.sub), {
      origin: 'REPLY_ON_CLOSED',
      originTicketId: id,
    });

    emitTicketCreated(newTicket);

    return res.json({ ticket: newTicket, message: 'Nouvelle demande créée avec succès' });
  } catch (err) {
    console.error('[ticket.routes] Erreur création nouveau ticket reply-on-closed:', err);
    return res.status(500).json({ error: 'Erreur interne' });
  }
});

// Rejeter une suggestion de réponse sur ticket fermé (ignorer)
router.post('/:id/dismiss-reply-suggestion', requirePermission('tickets.approve', ['ADMIN', 'TECHNICIAN', 'HOTLINE']), async (req, res) => {
  const id = Number(req.params.id);
  try {
    const ticket = await prisma.ticket.findUnique({ where: { id } });
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
    if (!ticket.replyOnClosedSuggested) return res.status(400).json({ error: 'Aucune suggestion en cours' });

    await prisma.ticket.update({
      where: { id },
      data: {
        replyOnClosedSuggested: false,
        replyOnClosedSuggestedAt: null,
        replyOnClosedSender: null,
        replyOnClosedSubject: null,
        replyOnClosedBody: null,
        replyOnClosedBodyHtml: null,
      },
    });

    await logEvent(id, 'REPLY_ON_CLOSED_DISMISSED', req.user.email || String(req.user.sub), {
      originalStatus: ticket.status,
      sender: ticket.replyOnClosedSender,
    });

    return res.json({ message: 'Suggestion ignorée' });
  } catch (err) {
    console.error('[ticket.routes] Erreur dismiss reply-on-closed:', err);
    return res.status(500).json({ error: 'Erreur interne' });
  }
});

// ── Nouvelle demande détectée sur un ticket EN COURS ─────────────────────────
// Une réponse du demandeur porte sur un AUTRE besoin que le problème du ticket.
// La Hotline décide depuis le Centre de Validation : créer un ticket séparé ou ignorer.
// Le ticket d'origine n'est pas modifié (ni statut ni clôture suggérée).
router.get('/new-ticket-suggestions', requirePermission('tickets.approve', ['ADMIN', 'TECHNICIAN', 'HOTLINE']), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const tickets = await prisma.ticket.findMany({
      where: { newTicketSuggested: true },
      orderBy: { newTicketSuggestedAt: 'desc' },
      take: limit,
      select: {
        id: true, title: true, content: true, status: true, priority: true,
        category: true, type: true, createdAt: true, sourceName: true, sourceEmail: true,
        newTicketSuggestedAt: true, newTicketSuggestedSender: true, newTicketSuggestedSubject: true,
        newTicketSuggestedSummary: true, newTicketSuggestedBody: true, newTicketSuggestedBodyHtml: true,
        requester: { select: { id: true, fullName: true, email: true } },
        assignedTo: { select: { id: true, fullName: true } },
      },
    });
    return res.json(tickets);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Créer le ticket séparé décrit par la suggestion
router.post('/:id/accept-new-ticket-suggestion', requirePermission('tickets.approve', ['ADMIN', 'TECHNICIAN', 'HOTLINE']), async (req, res) => {
  const id = Number(req.params.id);
  try {
    const ticket = await prisma.ticket.findUnique({ where: { id } });
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
    if (!ticket.newTicketSuggested) return res.status(400).json({ error: 'Aucune suggestion de nouvelle demande en cours' });

    const newTicket = await createTicketFromSuggestion(ticket, {
      sender: ticket.newTicketSuggestedSender,
      // Le résumé IA décrit le NOUVEAU sujet (le sujet de l'email est encore celui de l'ancien fil)
      title: ticket.newTicketSuggestedSummary || ticket.newTicketSuggestedSubject,
      body: ticket.newTicketSuggestedBody || ticket.newTicketSuggestedBodyHtml || '',
    });

    await prisma.ticket.update({
      where: { id },
      data: {
        newTicketSuggested: false,
        newTicketSuggestedAt: null,
        newTicketSuggestedSender: null,
        newTicketSuggestedSubject: null,
        newTicketSuggestedSummary: null,
        newTicketSuggestedBody: null,
        newTicketSuggestedBodyHtml: null,
        ...(ticket.outlookConversationId ? { outlookConversationId: null } : {}),
      },
    });

    await logEvent(id, 'NEW_TICKET_SUGGESTED_CREATED', req.user.email || String(req.user.sub), {
      targetTicketId: newTicket.id,
      sender: ticket.newTicketSuggestedSender,
      summary: ticket.newTicketSuggestedSummary,
    });

    await logEvent(newTicket.id, 'CREATED', req.user.email || String(req.user.sub), {
      origin: 'NEW_TICKET_SUGGESTED',
      originTicketId: id,
    });

    emitTicketCreated(newTicket);

    return res.json({ ticket: newTicket, message: 'Nouvelle demande créée avec succès' });
  } catch (err) {
    console.error('[ticket.routes] Erreur création depuis suggestion nouvelle demande:', err);
    return res.status(500).json({ error: 'Erreur interne' });
  }
});

// Ignorer la suggestion (le ticket d'origine continue normalement)
router.post('/:id/dismiss-new-ticket-suggestion', requirePermission('tickets.approve', ['ADMIN', 'TECHNICIAN', 'HOTLINE']), async (req, res) => {
  const id = Number(req.params.id);
  try {
    const ticket = await prisma.ticket.findUnique({ where: { id } });
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
    if (!ticket.newTicketSuggested) return res.status(400).json({ error: 'Aucune suggestion en cours' });

    await prisma.ticket.update({
      where: { id },
      data: {
        newTicketSuggested: false,
        newTicketSuggestedAt: null,
        newTicketSuggestedSender: null,
        newTicketSuggestedSubject: null,
        newTicketSuggestedSummary: null,
        newTicketSuggestedBody: null,
        newTicketSuggestedBodyHtml: null,
      },
    });

    await logEvent(id, 'NEW_TICKET_SUGGESTED_DISMISSED', req.user.email || String(req.user.sub), {
      sender: ticket.newTicketSuggestedSender,
      summary: ticket.newTicketSuggestedSummary,
    });

    return res.json({ message: 'Suggestion ignorée' });
  } catch (err) {
    console.error('[ticket.routes] Erreur dismiss nouvelle demande:', err);
    return res.status(500).json({ error: 'Erreur interne' });
  }
});

router.get('/:id', async (req, res) => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: Number(req.params.id) },
    // NB : pas de filtre deletedAt ici — la corbeille doit pouvoir afficher un ticket supprimé
    include: {
      requester: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
      secondaryRequester: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
      assignedTo: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
      assignees: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
      createdBy: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
      lastModifiedBy: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
      observers: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
      team: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
      followups: { include: { author: { select: { id: true, fullName: true, avatarUrl: true } } }, orderBy: { createdAt: 'asc' } },
      messages: { orderBy: { timestamp: 'asc' } },
      attachments: true,
      aiSuggestions: { orderBy: { createdAt: 'desc' } },
      linksA: { include: { ticketB: { select: { id: true, title: true, status: true, priority: true } } }, orderBy: { createdAt: 'asc' } },
      linksB: { include: { ticketA: { select: { id: true, title: true, status: true, priority: true } } }, orderBy: { createdAt: 'asc' } },
      assets: { include: { asset: true }, orderBy: { assetId: 'asc' } },
    },
  });

  if (!ticket) {
    return res.status(404).json({ error: 'Ticket introuvable' });
  }

  // Un demandeur ne consulte que ses propres tickets (404 = ne révèle pas l'existence des autres)
  if (isRequesterOnly(req.user) && ticket.requesterId !== req.user.sub && ticket.secondaryRequesterId !== req.user.sub &&
      !(ticket.requesterIds || []).includes(req.user.sub) &&
      !ticket.observers?.some(o => o.id === req.user.sub)) {
    return res.status(404).json({ error: 'Ticket introuvable' });
  }

  // Les commentaires privés (isPrivate) ne sont visibles que par l'équipe (jamais par le demandeur)
  const isStaffMember = ['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN'].includes(req.user.role);
  if (!isStaffMember) {
    ticket.followups = ticket.followups.filter((f) => !f.isPrivate);
  }

  // Images des emails/suivis : résolution des cid: inline, des URL absolues en HTTP (mixed
  // content) et retrait des <img> dont le fichier n'existe plus sur le volume.
  try {
    const cidMap = await loadCidMap({ ticketIds: [ticket.id] });
    for (const msg of ticket.messages || []) {
      if (msg.bodyHtml) msg.bodyHtml = resolveHtml(msg.bodyHtml, cidMap);
    }
    for (const fu of ticket.followups || []) {
      if (fu.content) fu.content = resolveHtml(fu.content, cidMap);
    }
  } catch (err) {
    console.error('[ticket.routes] Résolution des images impossible:', err.message);
  }

  return res.json(ticket);
});

// Télécharge le contenu d'une pièce jointe locale
router.get('/:id/attachments/:attachmentId/file', async (req, res) => {
  try {
    const attachment = await prisma.ticketAttachment.findFirst({
      where: { id: Number(req.params.attachmentId), ticketId: Number(req.params.id) },
    });
    if (!attachment) return res.status(404).json({ error: 'Pièce jointe introuvable' });

    // Un demandeur ne télécharge que les pièces jointes de ses propres tickets ou observés
    if (isRequesterOnly(req.user)) {
      const ownerTicket = await prisma.ticket.findFirst({ where: { id: attachment.ticketId, requesterId: req.user.sub }, select: { id: true } });
      const isObserver = await prisma.ticket.findFirst({ where: { id: attachment.ticketId, observers: { some: { id: req.user.sub } } }, select: { id: true } });
      if (!ownerTicket && !isObserver) return res.status(404).json({ error: 'Pièce jointe introuvable' });
    }

    if (attachment.localFilepath) {
      // Résolution relative à process.cwd() (= /app/erp-backend) : les chemins sont stockés
      // sous la forme 'uploads/<sous-dossier>/<fichier>' et le volume Docker est monté sur
      // <WORKDIR>/uploads. __dirname pointerait vers src/routes/ → fichiers introuvables.
      const localPath = path.isAbsolute(attachment.localFilepath)
        ? attachment.localFilepath
        : path.join(process.cwd(), attachment.localFilepath);
      if (fs.existsSync(localPath)) {
        res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${attachment.filename}"`);
        return res.sendFile(localPath);
      }
      console.error(`[ticket.routes] Fichier introuvable sur le disque: ${localPath}`);
    }

    return res.status(404).json({ error: 'Fichier non disponible sur ce serveur' });
  } catch (err) {
    console.error('[ticket.routes] Erreur téléchargement pièce jointe:', err);
    return res.status(500).json({ error: 'Erreur lors du téléchargement' });
  }
});

// Suppression d'une pièce jointe (le groupe « Demandeurs » n'a pas tickets.manage :
// un demandeur ne peut donc pas retirer les fichiers d'un ticket existant)
router.delete('/:id/attachments/:attachmentId', requirePermission('tickets.manage'), async (req, res) => {
  try {
    const attachment = await prisma.ticketAttachment.findFirst({
      where: { id: Number(req.params.attachmentId), ticketId: Number(req.params.id) },
    });
    if (!attachment) return res.status(404).json({ error: 'Pièce jointe introuvable' });

    if (attachment.localFilepath) {
      // Résolution relative à process.cwd() (volume Docker monté sur <WORKDIR>/uploads)
      const localPath = path.isAbsolute(attachment.localFilepath)
        ? attachment.localFilepath
        : path.join(process.cwd(), attachment.localFilepath);
      try { fs.unlinkSync(localPath); } catch {}
    }
    await prisma.ticketAttachment.delete({ where: { id: attachment.id } });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[ticket.routes] Erreur suppression pièce jointe:', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression de la pièce jointe' });
  }
});

// GET /api/tickets/:id/similar — tickets similaires par vectorielle (cosine distance)
router.get('/:id/similar', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const limit = Math.min(Number(req.query.limit) || 5, 20);
    const minScore = Math.max(0, Math.min(1, Number(req.query.minScore) || 0.5));

    const ticket = await prisma.ticket.findUnique({ where: { id }, select: { id: true } });
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

    const { findSimilarTicketsByVector } = require('../services/similarIncidentDetector');
    const similar = await findSimilarTicketsByVector(id, limit, minScore);
    res.json({ ticketId: id, similar });
  } catch (err) {
    console.error('[ticket.routes] Erreur similarité vectorielle:', err.message);
    res.status(500).json({ error: 'Erreur lors de la recherche de tickets similaires', detail: err.message });
  }
});

// Create ticket
router.post(
  '/',
  upload.fields([
    { name: 'attachment', maxCount: 1 },
    { name: 'images', maxCount: 10 },
  ]),
  [body('title').notEmpty(), body('content').notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      title, content, priority, category, teamId, assignedToId, requesterId, secondaryRequesterId,
      type, urgency, impact, source, externalId, status, openedAt, locationId, dueDate,
      sourceEmailId, outlookConversationId,
    } = req.body;

    // requesterIds (tableau de demandeurs) — tolérance JSON/multipart
    let requesterIds = [];
    if (req.body.requesterIds) {
      try {
        requesterIds = Array.isArray(req.body.requesterIds) ? req.body.requesterIds.map(Number) : JSON.parse(req.body.requesterIds).map(Number);
      } catch {
        requesterIds = [];
      }
    }
    // Le premier requesterId est toujours le demandeur principal
    const finalRequesterIdFromIds = requesterIds.length > 0 ? Number(requesterIds[0]) : null;

    // observerIds peut arriver en JSON (multipart) ou en tableau (JSON direct)
    let observerIds = [];
    if (req.body.observerIds) {
      try {
        observerIds = Array.isArray(req.body.observerIds) ? req.body.observerIds : JSON.parse(req.body.observerIds);
      } catch {
        observerIds = [];
      }
    }

    // assetIds (équipements liés) — même tolérance JSON/multipart
    let assetIds = [];
    if (req.body.assetIds) {
      try {
        assetIds = Array.isArray(req.body.assetIds) ? req.body.assetIds : JSON.parse(req.body.assetIds);
      } catch {
        assetIds = [];
      }
    }

    // assigneeIds (plusieurs techniciens assignés) — tolérance JSON/multipart
    let assigneeIds = [];
    if (req.body.assigneeIds) {
      try {
        assigneeIds = Array.isArray(req.body.assigneeIds) ? req.body.assigneeIds : JSON.parse(req.body.assigneeIds);
      } catch {
        assigneeIds = [];
      }
    }
    if (assignedToId && !assigneeIds.includes(Number(assignedToId))) {
      assigneeIds.push(Number(assignedToId));
    }
    const finalAssignedToId = assignedToId ? Number(assignedToId) : (assigneeIds.length > 0 ? Number(assigneeIds[0]) : null);

    // Si aucune liste d'observateurs explicite n'est fournie, hériter des observateurs par défaut de l'équipe
    if (teamId && observerIds.length === 0) {
      const team = await prisma.team.findUnique({
        where: { id: Number(teamId) },
        include: { defaultObservers: { select: { id: true } } },
      });
      if (team?.defaultObservers?.length > 0) {
        observerIds = team.defaultObservers.map((o) => o.id);
      }
    }

    // Seul un membre du support (SUPERADMIN, ADMIN, TECHNICIAN, HOTLINE) peut créer un ticket pour un autre demandeur
    const canSetRequester = ['SUPERADMIN', 'ADMIN', 'TECHNICIAN', 'HOTLINE'].includes(req.user.role);
    const finalRequesterId = canSetRequester && finalRequesterIdFromIds ? Number(finalRequesterIdFromIds) : (canSetRequester && requesterId ? Number(requesterId) : req.user.sub);

    // Seul un ADMIN/TECHNICIAN/HOTLINE peut fixer le statut initial
    const canSetStatus = ['ADMIN', 'TECHNICIAN', 'HOTLINE', 'SUPERADMIN'].includes(req.user.role);
    const finalStatus = canSetStatus && status ? status : 'NEW';

    // Champs personnalisés : validation des champs requis de la catégorie (ou globaux)
    let customFields = null;
    if (req.body.customFields !== undefined && req.body.customFields !== null && req.body.customFields !== '') {
      try {
        customFields = typeof req.body.customFields === 'string' ? JSON.parse(req.body.customFields) : req.body.customFields;
        if (typeof customFields !== 'object' || Array.isArray(customFields)) throw new Error('format');
      } catch {
        return res.status(400).json({ error: 'customFields doit être un objet JSON' });
      }
    }
    if (category) {
      const cat = await prisma.ticketCategory.findUnique({ where: { name: category } });
      if (cat) {
        const requiredFields = await prisma.customFieldDefinition.findMany({
          where: { isActive: true, required: true, OR: [{ categoryId: cat.id }, { categoryId: null }] },
        });
        const missing = requiredFields.filter((f) => {
          const v = customFields?.[String(f.id)];
          return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
        });
        if (missing.length > 0) {
          return res.status(400).json({ error: `Champs requis manquants : ${missing.map((f) => f.label).join(', ')}` });
        }
      }
    }

    // Lieu : doit obligatoirement exister en base (liste déroulante) — jamais de texte libre.
    // (Correctif : locationId était déstructuré mais jamais enregistré à la création.)
    let finalLocationId = null;
    let finalLocationName = null;
    if (locationId) {
      const loc = await prisma.location.findUnique({
        where: { id: Number(locationId) },
        select: { id: true, name: true, completename: true },
      });
      if (!loc) return res.status(400).json({ error: 'Lieu introuvable' });
      finalLocationId = loc.id;
      finalLocationName = loc.completename || loc.name;
    }

    // ── Email source (création depuis la boîte mail) ─────────────────────────
    // L'Inbox transmet l'id de l'IncomingEmail + l'identifiant de conversation
    // Outlook. Sans eux, findExistingTicket ne retrouve jamais ce ticket sur la
    // réponse suivante du demandeur (ni priorité 1 outlookConversationId, ni
    // priorité 2 internetMessageId) : chaque relance créait un nouveau ticket.
    let sourceEmail = null;
    if (sourceEmailId !== undefined && sourceEmailId !== null && sourceEmailId !== '') {
      const emailPk = Number(sourceEmailId);
      if (Number.isInteger(emailPk)) {
        sourceEmail = await prisma.incomingEmail.findUnique({ where: { id: emailPk } });
      }
    }
    const finalConversationId = String(outlookConversationId || sourceEmail?.conversationId || '').trim() || null;

    const ticket = await prisma.ticket.create({
      data: {

        // Titre toujours EN MAJUSCULES (règle stricte sur les noms de tickets)
        title: formatTicketTitle(title),
        content: sanitizeTicketHtml(content),
        priority: priority || 'P3',
        category: category || null,
        teamId: teamId ? Number(teamId) : null,
        assignedToId: finalAssignedToId,
        requesterId: finalRequesterId,
        secondaryRequesterId: secondaryRequesterId ? Number(secondaryRequesterId) : null,
        requesterIds: requesterIds.length > 0 ? requesterIds : (finalRequesterId ? [finalRequesterId] : []),
        status: finalStatus,
        ...(finalStatus === 'SOLVED' ? { solvedAt: new Date() } : {}),
        ...(finalStatus === 'CLOSED' ? { closedAt: new Date() } : {}),
        ...(openedAt ? { createdAt: new Date(openedAt) } : {}),
        // Tickets créés manuellement (portail ou back-office) : TOUJOURS approuvés, ils ne
        // passent JAMAIS par le centre de validation. Seuls les tickets email/IA
        // (createTicketFromEmail, ticketCreator, chatbot) y arrivent en PENDING.
        // (requiresApproval est ignoré : le formulaire multipart envoyait "false" — chaîne
        // truthy en JS — et chaque ticket manuel atterrissait en PENDING.)
        approvalStatus: 'APPROVED',
        type: type || 'INCIDENT',
        urgency: urgency || 'MEDIUM',
        impact: impact || 'MEDIUM',
        ...(dueDate ? { dueDate: new Date(dueDate) } : {}),
        source: source || null,
        externalId: externalId || null,
        // Rattachement de conversation (création depuis la boîte mail)
        ...(finalConversationId ? { outlookConversationId: finalConversationId } : {}),
        ...(sourceEmail ? {
          sourceEmail: sourceEmail.fromEmail,
          sourceName: sourceEmail.fromName || null,
          sourceSubject: sourceEmail.subject || null,
        } : {}),
        locationId: finalLocationId,
        locationName: finalLocationName,
        createdById: req.user.sub,
        origin: req.user.role === 'REQUESTER' ? 'PORTAIL' : 'MANUAL',
        ...(customFields ? { customFields } : {}),
        ...(assigneeIds.length > 0 ? { assignees: { connect: assigneeIds.map((id) => ({ id: Number(id) })) } } : {}),
        ...(observerIds.length > 0 ? { observers: { connect: observerIds.map((id) => ({ id: Number(id) })) } } : {}),
        ...(assetIds.length > 0 ? { assets: { create: assetIds.map((assetId) => ({ assetId: Number(assetId) })) } } : {}),
      },
    });

    // Si aucun technicien n'a été choisi explicitement à la création, assigne automatiquement
    // le moins chargé de l'équipe correspondant à la catégorie — best-effort, ticket non assigné
    // si la catégorie ne correspond à aucune équipe connue.
    if (!ticket.assignedToId && ticket.category) {
      try {
        await autoAssignTechnician(ticket.id, ticket.category);
      } catch (err) {
        console.error('[ticket.routes] Auto-assignation échouée:', err.message);
      }
    }

    // ── Rattachement de l'email source ──────────────────────────────────────
    // IncomingEmail.erpTicketId + message initial reprenant les identifiants
    // Outlook : les deux niveaux de findExistingTicket (conversationId sur le
    // ticket, internetMessageId/inReply-To sur le TicketMessage) retrouvent ce
    // ticket quand le demandeur répond — sinon chaque réponse créait un doublon.
    if (sourceEmail) {
      try {
        await prisma.incomingEmail.update({
          where: { id: sourceEmail.id },
          data: { status: 'DONE', erpTicketId: ticket.id, isNewTicket: false },
        });
        await prisma.ticketMessage.create({
          data: {
            ticketId: ticket.id,
            direction: 'INBOUND',
            sender: sourceEmail.fromEmail,
            recipients: [],
            ccRecipients: sourceEmail.ccRecipients || [],
            subject: sourceEmail.subject || ticket.title,
            body: sourceEmail.bodyPreview || '',
            bodyHtml: sourceEmail.bodyHtml || null,
            outlookMessageId: sourceEmail.graphMessageId,
            internetMessageId: sourceEmail.internetMessageId,
            inReplyTo: sourceEmail.inReplyTo,
            conversationId: sourceEmail.conversationId,
            timestamp: sourceEmail.receivedAt,
            summary: sourceEmail.aiSummary || null,
            ticketStatusAtTime: ticket.status,
          },
        });
      } catch (err) {
        // outlookMessageId est unique : un message déjà rattaché ailleurs ne doit
        // pas faire échouer la création du ticket — le lien reste priorité 1.
        console.error('[ticket.routes] Rattachement conversation email échoué:', err.message);
      }
    }

    // Sauvegarder la pièce jointe ou les images collées localement
    const singleAttachment = req.files?.['attachment']?.[0] || req.file;
    if (singleAttachment) {
      try {
        const validation = validateUpload(singleAttachment.originalname, singleAttachment.mimetype, 'ticket');
        if (!validation.valid) {
          return res.status(400).json({ error: validation.error });
        }
        const TICKET_ATTACHMENTS_DIR = path.join(process.cwd(), 'uploads', 'ticket-attachments');
        fs.mkdirSync(TICKET_ATTACHMENTS_DIR, { recursive: true });
        const safeFilename = makeSafeFilename(singleAttachment.originalname);
        const destPath = path.join(TICKET_ATTACHMENTS_DIR, safeFilename);
        fs.writeFileSync(destPath, singleAttachment.buffer);
        await prisma.ticketAttachment.create({
          data: {
            ticketId: ticket.id,
            filename: singleAttachment.originalname,
            mimeType: singleAttachment.mimetype,
            localFilepath: path.join('uploads', 'ticket-attachments', safeFilename),
          },
        });
      } catch (err) {
        console.error('[ticket.routes] Sauvegarde pièce jointe échouée:', err.message);
      }
    }

    // Traitement des images collées (pastedImages)
    const pastedFiles = req.files?.['images'] || [];
    if (pastedFiles.length > 0) {
      try {
        const TICKET_ATTACHMENTS_DIR = path.join(process.cwd(), 'uploads', 'ticket-attachments');
        fs.mkdirSync(TICKET_ATTACHMENTS_DIR, { recursive: true });
        const savedImages = [];
        for (const file of pastedFiles) {
          const validation = validateUpload(file.originalname, file.mimetype, 'ticket');
          if (!validation.valid) continue;
          const ext = path.extname(file.originalname) || '.png';
          const safeFilename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
          const destPath = path.join(TICKET_ATTACHMENTS_DIR, safeFilename);
          fs.writeFileSync(destPath, file.buffer);
          await prisma.ticketAttachment.create({
            data: {
              ticketId: ticket.id,
              filename: file.originalname || safeFilename,
              mimeType: file.mimetype || 'image/png',
              localFilepath: path.join('uploads', 'ticket-attachments', safeFilename),
            },
          });
          savedImages.push(`/uploads/ticket-attachments/${safeFilename}`);
        }

        // Remplacer les marqueurs <!--IMAGE_n--> par les tags <img> et assainir
        let updatedContent = ticket.content || '';
        savedImages.forEach((imgUrl, idx) => {
          const markerRegex = new RegExp(`<!--IMAGE_${idx}-->?`, 'gi');
          updatedContent = updatedContent.replace(markerRegex, `<img src="${imgUrl}" alt="image collée" />`);
        });
        updatedContent = updatedContent.replace(/<!--IMAGE_\d+-->?/gi, '');
        updatedContent = sanitizeTicketHtml(updatedContent);
        await prisma.ticket.update({ where: { id: ticket.id }, data: { content: updatedContent } });
      } catch (err) {
        console.error('[ticket.routes] Traitement images collées échoué:', err.message);
      }
    }

    // Émettre événement temps réel pour les notifications
    let finalTicket = await prisma.ticket.findUnique({ where: { id: ticket.id } });

    // Calculer les échéances SLA (priorité, seuils configurables par priorité)
    if (finalTicket) {
      try {
        await applySla(finalTicket);
      } catch (err) {
        console.error('[ticket.routes] Calcul SLA échoué:', err.message);
      }
    }

    // Les tickets manuels sont directement approuvés (voir approvalStatus: 'APPROVED' à la création).
    // Pas d'auto-approbation supplémentaire nécessaire.

    if (finalTicket) {
      emitTicketCreated(finalTicket);
      if (finalTicket.assignedToId) {
        emitTicketAssigned(finalTicket.id, finalTicket.title, finalTicket.assignedToId, finalTicket.category ? 'by_category' : 'manual');

        // Notification email au technicien assigné
        prisma.user.findUnique({ where: { id: finalTicket.assignedToId }, select: { email: true, fullName: true } })
          .then((tech) => {
            if (tech?.email) {
              sendAssignmentNotificationEmail({
                ticketId: finalTicket.id,
                ticketTitle: finalTicket.title,
                priority: finalTicket.priority,
                technicianEmail: tech.email,
                technicianName: tech.fullName,
                category: finalTicket.category,
              }).catch((e) => console.error('[ticket.routes] Échec notification assignation technicien:', e.message));
            }
          })
          .catch(() => {});
      }

      // Accusé de réception email au demandeur (création manuelle / portail)
      if (finalTicket.requesterId) {
        prisma.user.findUnique({ where: { id: finalTicket.requesterId }, select: { email: true, fullName: true } })
          .then((reqUser) => {
            if (reqUser?.email) {
              sendAcknowledgement({
                ticketId: finalTicket.id,
                toEmail: reqUser.email,
                toName: reqUser.fullName,
                originalSubject: finalTicket.title,
              }).catch((e) => console.error('[ticket.routes] Échec accusé de réception demandeur:', e.message));
            }
          })
          .catch(() => {});
      }

      // Notification email aux boîtes configurées dans les Paramètres (best-effort, non bloquant)
      // Uniquement si le ticket est approuvé — sinon on attend l'approbation (ticketApproval.js)
      if (finalTicket.approvalStatus === 'APPROVED') {
        sendTicketCreationNotification(finalTicket).catch((err) =>
          console.error('[ticket.routes] Notification création échouée:', err.message)
        );
      }

      // Générer et sauvegarder l'embedding du ticket pour la similarité (fire-and-forget)
      const { saveTicketEmbedding } = require('../services/similarIncidentDetector');
      saveTicketEmbedding(finalTicket.id).catch((err) =>
        console.error('[ticket.routes] Sauvegarde embedding échouée:', err.message)
      );
    }

    return res.status(201).json(finalTicket);
  }
);

// Update ticket (status, priority, assignment, etc.)
router.patch('/:id', allowTechnicianStatusOnly, requireTicketAssignOrTechnicianStatusOnly, async (req, res) => {
  const id = Number(req.params.id);
  // Whitelist : seuls ces champs acceptent la mise à jour (protection mass assignment)
  const allowed = ['title', 'content', 'status', 'priority', 'category', 'teamId', 'assignedToId', 'assigneeIds', 'requesterId', 'secondaryRequesterId', 'requesterIds', 'sourceName', 'sourceEmail', 'type', 'urgency', 'impact', 'source', 'externalId', 'dueDate', 'assetIds', 'observerIds', 'approvalStatus', 'isMajorIncident', 'impactedSites', 'closeSuggested', 'locationId', 'outlookConversationId'];
  const { title, content, status, priority, category, teamId, assignedToId, assigneeIds, requesterId, secondaryRequesterId, requesterIds, sourceName, sourceEmail, type, urgency, impact, source, externalId, dueDate, assetIds, locationId } = req.body;

  // Rejecter les champs non autorisés
  for (const key of Object.keys(req.body)) {
    if (!allowed.includes(key)) {
      return res.status(400).json({ error: `Champ non autorisé : ${key}` });
    }
  }

  // Liaison fil conversation : réservé aux rôles privilégiés
  if (req.body.outlookConversationId !== undefined && ['REQUESTER', 'TECHNICIAN'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Accès refusé : seuls ADMIN/HOTLINE/SUPERADMIN peuvent lier un fil de conversation' });
  }

  // Défense en profondeur (miroir de allowTechnicianStatusOnly) : même si
  // l'ordre des middlewares change, un TECHNICIAN ne passe jamais un autre
  // champ que le statut.
  if (req.user.role === 'TECHNICIAN' && Object.keys(req.body).some((k) => k !== 'status')) {
    return res.status(403).json({ error: TECHNICIAN_EDIT_ERROR });
  }

  // ── Validation de la transition de statut ──────────────────────────────
  if (status !== undefined) {
    const current = await prisma.ticket.findUnique({ where: { id }, select: { status: true } });
    if (!current) return res.status(404).json({ error: 'Ticket introuvable' });
    if (!canTransition(current.status, status)) {
      return res.status(400).json({
        error: `Transition invalide : ${STATUS_LABELS[current.status] || current.status} → ${STATUS_LABELS[status] || status}. Transitions autorisées : ${(VALID_TRANSITIONS[current.status] || []).map((s) => STATUS_LABELS[s] || s).join(', ') || 'aucune'}`,
      });
    }
  }

  const data = {};
  // Titre toujours EN MAJUSCULES (règle stricte sur les noms de tickets)
  if (title !== undefined) data.title = formatTicketTitle(title);
  if (content !== undefined) data.content = sanitizeTicketHtml(content);
  if (priority !== undefined) data.priority = priority;
  if (category !== undefined) data.category = category;
  if (teamId !== undefined) data.teamId = teamId;
  
  if (assigneeIds !== undefined) {
    const ids = Array.isArray(assigneeIds) ? assigneeIds.map((a) => Number(a)).filter((id) => id > 0) : [];
    // Vérifier que les users existent avant de set (évite les erreurs d'orphelins dans la table de jointure)
    const existingIds = ids.length > 0
      ? (await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((u) => u.id)
      : [];
    data.assignees = { set: existingIds.map((id) => ({ id })) };
    if (assignedToId === undefined) {
      data.assignedToId = existingIds.length > 0 ? existingIds[0] : null;
    } else {
      data.assignedToId = assignedToId ? Number(assignedToId) : null;
    }
  } else if (assignedToId !== undefined) {
    const singleId = assignedToId ? Number(assignedToId) : null;
    data.assignedToId = singleId;
    if (singleId) {
      const exists = await prisma.user.findUnique({ where: { id: singleId }, select: { id: true } });
      data.assignees = exists ? { set: [{ id: singleId }] } : { set: [] };
    } else {
      data.assignees = { set: [] };
    }
  }

  if (requesterId !== undefined) {
    const reqId = requesterId ? Number(requesterId) : null;
    data.requesterId = reqId;
    if (reqId) {
      const reqUser = await prisma.user.findUnique({ where: { id: reqId }, select: { fullName: true, email: true, avatarUrl: true } });
      if (reqUser) {
        data.sourceName = reqUser.fullName;
        data.sourceEmail = reqUser.email;
      }
    }
  }
  if (secondaryRequesterId !== undefined) {
    data.secondaryRequesterId = secondaryRequesterId ? Number(secondaryRequesterId) : null;
  }
  if (requesterIds !== undefined) {
    const ids = Array.isArray(requesterIds) ? requesterIds.map(Number) : [];
    data.requesterIds = ids;
    // Sync secondaryRequesterId from requesterIds for backward compat
    if (ids.length > 1) {
      data.secondaryRequesterId = ids[1];
    } else if (ids.length <= 1) {
      data.secondaryRequesterId = null;
    }
    // Sync requesterId from first entry
    if (ids.length > 0) {
      data.requesterId = ids[0];
    }
  }
  if (sourceName !== undefined) data.sourceName = sourceName;
  if (sourceEmail !== undefined) data.sourceEmail = sourceEmail;

  // assetIds (équipements liés) : remplacement complet de la liste
  if (assetIds !== undefined) {
    const next = Array.isArray(assetIds) ? assetIds.map((a) => Number(a)) : [];
    data.assets = { deleteMany: {}, create: next.map((assetId) => ({ assetId })) };
  }

  // Échéance manuelle : accepter une date, la vider (null) ou retirer l'échéance (""),
  // et réarmer le drapeau de notification si la date change
  if (dueDate !== undefined) {
    data.dueDate = dueDate ? new Date(dueDate) : null;
    data.dueDateNotifiedAt = null;
  }
  if (req.body.outlookConversationId !== undefined) {
    data.outlookConversationId = req.body.outlookConversationId ? String(req.body.outlookConversationId).trim() || null : null;
  }
  if (type !== undefined) data.type = type;
  if (urgency !== undefined) data.urgency = urgency;
  if (impact !== undefined) data.impact = impact;
  if (source !== undefined) data.source = source;
  if (externalId !== undefined) data.externalId = externalId;

  // locationId du frontend — obligatoirement un lieu existant en base (liste déroulante),
  // jamais de texte libre. Vidé explicitement → "INDÉTERMINÉ".
  if (locationId !== undefined) {
    data.locationId = locationId ? Number(locationId) : null;
    if (locationId) {
      const loc = await prisma.location.findUnique({ where: { id: Number(locationId) }, select: { name: true, completename: true } });
      if (loc)         data.locationName = loc.completename || loc.name;
    } else {
      data.locationName = UNDETERMINED;
    }
  }

  if (status !== undefined) {
    data.status = status;
    if (status === 'SOLVED') data.solvedAt = new Date();
    if (status === 'CLOSED') data.closedAt = new Date();
    // Clôture directe par un humain (hors validation IA) : la suggestion de clôture
    // éventuelle est consommée — sinon le ticket restait listé dans l'onglet
    // « Clôtures suggérées » du Centre de Validation alors qu'il est déjà résolu/fermé.
    if (status === 'SOLVED' || status === 'CLOSED') {
      data.closeSuggested = false;
      data.closeSuggestedAt = null;
      data.closeSuggestionConfidence = null;
    }
  }

  if (req.body.approvalStatus !== undefined) {
    data.approvalStatus = req.body.approvalStatus;
    if (req.body.approvalStatus === 'PENDING') {
      data.approvedById = null;
      data.approvedAt = null;
      data.approvalNote = null;
    }
  }

  // Observateurs : remplacement complet de la liste (many-to-many implicite)
  if (req.body.observerIds !== undefined) {
    const ids = Array.isArray(req.body.observerIds)
      ? req.body.observerIds.map(Number).filter((id) => id > 0)
      : [];
    const existingIds = ids.length > 0
      ? (await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((u) => u.id)
      : [];
    data.observers = { set: existingIds.map((id) => ({ id })) };
  }

  // Track who last modified the ticket
  data.lastModifiedById = req.user.sub;

  try {
    const before = await prisma.ticket.findUnique({
      where: { id },
      select: {
        title: true, content: true, priority: true, category: true, teamId: true,
        assignedToId: true, type: true, urgency: true, impact: true, source: true,
        externalId: true, status: true, isMajorIncident: true, impactedSites: true,
        sourceEmail: true, requesterId: true, sourceName: true, approvalStatus: true,
        observers: { select: { id: true } },
      },
    });

    // Approbation manuelle via PATCH : approvedAt sert de point de départ au SLA
    // (le ticket « devient » approuvé maintenant, pas à sa création).
    if (data.approvalStatus === 'APPROVED' && before.approvalStatus !== 'APPROVED' && data.approvedAt === undefined) {
      data.approvedAt = new Date();
    }

    const ticket = await prisma.ticket.update({ where: { id }, data });

    // Description modifiée : purge éventuelle des images de suivi devenues orphelines
    if (content !== undefined) {
      await cleanupOrphanFollowupImages(id);
    }

    // Recalculer les échéances SLA si la priorité ou l'approbation change
    // (le SLA ne démarre qu'à l'approbation : PENDING = aucune échéance).
    if (data.priority !== undefined || data.approvalStatus !== undefined) {
      try {
        await applySla(ticket);
      } catch (err) {
        console.error('[ticket.routes] Recalcul SLA échoué:', err.message);
      }
    }

    // Le temps de première réponse est fixé à la première assignation
    if (data.assignedToId !== undefined && data.assignedToId) {
      try {
        await recordFirstResponse(id, req.user?.sub || null);
      } catch (err) {
        console.error('[ticket.routes] Enregistrement première réponse échoué:', err.message);
      }
    }

    // Enregistrer les corrections de champs par la Hotline/Technicien
    const trackFields = [
      'title', 'content', 'priority', 'category', 'teamId', 'assignedToId',
      'type', 'urgency', 'impact', 'source', 'externalId',
      'requesterId', 'sourceName', 'sourceEmail'
    ];
    for (const field of trackFields) {
      if (data[field] !== undefined && String(before[field] ?? '') !== String(data[field] ?? '')) {
        await prisma.ticketFieldCorrection.create({
          data: {
            ticketId: id,
            fieldName: field,
            oldValue: before[field] != null ? String(before[field]) : null,
            newValue: data[field] != null ? String(data[field]) : null,
            correctedById: req.user?.sub || null,
          },
        }).catch(() => {});
      }
    }

    // Notifier tous les sites impactés si un incident majeur vient d'être résolu/clôturé
    const isNowResolved = (status === 'SOLVED' || status === 'CLOSED');
    const wasOpen = before && !['SOLVED', 'CLOSED'].includes(before.status);
    if (isNowResolved && wasOpen && before?.isMajorIncident && before.impactedSites?.length > 0) {
      notifyMajorIncidentResolved({
        ticketId: id,
        ticketTitle: before.title,
        impactedSites: before.impactedSites,
      }).catch((err) => {
        console.error(`[ticket.routes] Échec notification résolution incident majeur (ticket ${id}):`, err.message);
      });
    }

    // Émettre événement temps réel
    emitTicketUpdated(ticket, { status, priority, category, assignedToId });
    notifyRequesterOnStatusChange(id, data.status);

    if (data.assignedToId !== undefined && data.assignedToId && String(before?.assignedToId) !== String(data.assignedToId)) {
      prisma.user.findUnique({ where: { id: Number(data.assignedToId) }, select: { email: true, fullName: true } })
        .then((tech) => {
          if (tech?.email) {
            sendAssignmentNotificationEmail({
              ticketId: ticket.id,
              ticketTitle: ticket.title,
              priority: ticket.priority,
              technicianEmail: tech.email,
              technicianName: tech.fullName,
              category: ticket.category,
            }).catch((e) => console.error('[ticket.routes] Échec notification assignation technicien:', e.message));
          }
        })
        .catch(() => {});
    }

    // Clôture en cascade : si un parent passe à SOLVED/CLOSED et que le réglage
    // closeChildrenWithParent est actif, clôturer aussi ses sous-tickets ouverts
    if (data.status && (data.status === 'SOLVED' || data.status === 'CLOSED')) {
      try {
        const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
        if (settings?.closeChildrenWithParent) {
          const childIds = await resolveChildrenIds(prisma, id);
          if (childIds.length > 0) {
            await prisma.ticket.updateMany({
              where: { id: { in: childIds }, status: { notIn: ['SOLVED', 'CLOSED'] } },
              data: { status: data.status, closedAt: data.status === 'CLOSED' ? new Date() : undefined, solvedAt: data.status === 'SOLVED' ? new Date() : undefined, closeSuggested: false, closeSuggestedAt: null, closeSuggestionConfidence: null },
            });
            for (const childId of childIds) {
              await logEvent(childId, 'STATUS_CHANGED', req.user.email || 'SYSTEM', { oldStatus: before.status, newStatus: data.status, action: 'Clôture en cascade du parent' });
            }
          }
        }
      } catch (err) {
        console.error(`[ticket.routes] Clôture en cascade échouée (parent ${id}):`, err.message);
      }
    }

    // Auto-apprentissage : créer compétences et associer technicien quand le ticket est résolu
    if (data.status === 'SOLVED' || data.status === 'CLOSED') {
      const { learnFromResolution } = require('../services/skillLearningService');
      learnFromResolution(id).catch((err) =>
        console.error(`[ticket.routes] Échec apprentissage ticket ${id}:`, err.message)
      );
    }

    // Mettre à jour l'index de similarité (fire-and-forget)
    const { updateSimilarityIndexStatus, refreshTicketEmbedding } = require('../services/similarIncidentDetector');
    if (data.status !== undefined) {
      updateSimilarityIndexStatus(id, data.status);
    }
    if (data.title !== undefined || data.content !== undefined) {
      refreshTicketEmbedding(id);
    }

    return res.json(ticket);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Ticket introuvable' });
    console.error('[ticket.routes] Erreur mise à jour ticket:', err);
    return res.status(500).json({ error: 'Erreur interne' });
  }
});

// Get ticket field corrections (audit trail)
router.get('/:id/corrections', async (req, res) => {
  const id = Number(req.params.id);
  // Un demandeur ne voit les corrections que de ses propres tickets ou ceux qu'il observe
  if (isRequesterOnly(req.user)) {
    const ownerTicket = await prisma.ticket.findFirst({ where: { id, requesterId: req.user.sub }, select: { id: true } });
    const isObserver = await prisma.ticket.findFirst({ where: { id, observers: { some: { id: req.user.sub } } }, select: { id: true } });
    if (!ownerTicket && !isObserver) return res.status(404).json({ error: 'Ticket introuvable' });
  }
  const corrections = await prisma.ticketFieldCorrection.findMany({
    where: { ticketId: id },
    include: { correctedBy: { select: { id: true, fullName: true, email: true, avatarUrl: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return res.json(corrections);
});

// Approve a ticket
router.post('/:id/approve', forbidTechnicianTicketEdits, requirePermission('tickets.approve', ['ADMIN', 'TECHNICIAN', 'HOTLINE']), async (req, res) => {
  const id = Number(req.params.id);
  try {
    const result = await approveTicket(id, {
      approvedById: req.user.sub,
      approvedByEmail: req.user.email || 'HOTLINE',
      approvalNote: req.body.note || null,
    });
    return res.json(result);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: 'Ticket introuvable' });
    return res.status(500).json({ error: err.message });
  }
});

// Reject a ticket
router.post('/:id/reject', forbidTechnicianTicketEdits, requirePermission('tickets.approve', ['ADMIN', 'TECHNICIAN', 'HOTLINE']), async (req, res) => {
  const id = Number(req.params.id);
  const note = req.body.note || req.body.reason;
  if (!note || !note.trim()) {
    return res.status(400).json({ error: 'Une raison de rejet est obligatoire.' });
  }
  try {
    const ticket = await prisma.ticket.update({
      where: { id },
      data: {
        approvalStatus: 'REJECTED',
        status: 'CLOSED',
        closedAt: new Date(),
        // Rejet = clôture : consommer la suggestion de clôture éventuelle (le ticket
        // ne doit pas apparaître dans les clôtures suggérées alors qu'il est fermé)
        closeSuggested: false,
        closeSuggestedAt: null,
        closeSuggestionConfidence: null,
        approvedById: req.user.sub,
        approvedAt: new Date(),
        approvalNote: note.trim(),
      },
    });
    await logEvent(id, 'REJECTED', req.user.email || 'HOTLINE', { reason: note.trim() });
    await auditLog('TICKET_REJECTED', { actor: req.user, targetType: 'Ticket', targetId: id, targetLabel: ticket.title, metadata: { reason: note.trim() } });
    emitTicketUpdated(ticket, { approvalStatus: 'REJECTED' });

    // Incohérence corrigée : rejeter le ticket tue ses brouillons de réponse IA encore
    // PENDING — sinon ils restaient dans le Centre de Validation (avec relances email)
    // et pouvaient être approuvés à distance pour un ticket... rejeté.
    await prisma.aiEmailDraft.updateMany({
      where: { ticketId: id, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedById: req.user.sub, reviewedAt: new Date(), reviewNote: `Brouillon rejeté avec le ticket #${id} : ${note.trim()}` },
    }).catch((err) => console.error('[ticket.routes] Rejet des brouillons du ticket échoué:', err.message));

    // Le demandeur est informé du rejet (comme pour la clôture validée/rejetée),
    // avec la raison — best-effort, jamais bloquant.
    notifyRequesterOnStatusChange(id, 'CLOSED').catch((err) =>
      console.error(`[ticket.routes] Échec notification rejet au demandeur (ticket ${id}):`, err.message)
    );

    // Boucle de rétroaction : un rejet humain dégrade la réputation de l'expéditeur
    if (ticket.sourceEmail) {
      recordDecision({ email: ticket.sourceEmail, decision: 'REJECTED' })
        .catch((err) => console.error('[senderReputation] Échec enregistrement rejet:', err.message));
    }

    return res.json(ticket);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Réintégrer un ticket rejeté ───────────────────────────────────────────
// Annule un rejet : le ticket repart en attente d'approbation (PENDING) et rouvre
// en « Ouvert » — le SLA reste suspendu jusqu'à la prochaine approbation.
router.post('/:id/reinstate', forbidTechnicianTicketEdits, requirePermission('tickets.approve', ['ADMIN', 'TECHNICIAN', 'HOTLINE']), async (req, res) => {
  const id = Number(req.params.id);
  try {
    const existing = await prisma.ticket.findUnique({ where: { id }, select: { id: true, approvalStatus: true } });
    if (!existing) return res.status(404).json({ error: 'Ticket introuvable' });
    if (existing.approvalStatus !== 'REJECTED') {
      return res.status(409).json({ error: 'Seul un ticket rejeté peut être réintégré' });
    }

    const ticket = await prisma.ticket.update({
      where: { id },
      data: {
        approvalStatus: 'PENDING',
        approvedById: null,
        approvedAt: null,
        approvalNote: null,
        status: 'OPEN',
        closedAt: null,
      },
    });

    await logEvent(id, 'REOPENED', req.user.email || 'SYSTEM', { via: 'reintegration' });
    await auditLog('TICKET_REINSTATED', { actor: req.user, targetType: 'Ticket', targetId: id, targetLabel: ticket.title });
    emitTicketUpdated(ticket, { approvalStatus: 'PENDING' });

    // Brouillons de réponse IA tués par le rejet : remis en attente, comme
    // POST /ai-email-drafts/:id/restore (le motif du rejet contient « ticket #id »).
    await prisma.aiEmailDraft.updateMany({
      where: { ticketId: id, status: 'REJECTED', reviewNote: { contains: `ticket #${id}` } },
      data: { status: 'PENDING', reviewedById: null, reviewedAt: null, reviewNote: null, sentAt: null },
    }).catch((err) => console.error('[ticket.routes] Restauration des brouillons échouée:', err.message));

    // Suivi public : le demandeur voit que sa demande repart en attente d'approbation.
    await prisma.followup.create({
      data: { ticketId: id, authorId: req.user.sub, content: "♻️ Ticket réintégré — remis en attente d'approbation" },
    }).catch((err) => console.error('[ticket.routes] Suivi de réintégration échoué:', err.message));

    try { await applySla(ticket); } catch (err) { console.error('[ticket.routes] Recalcul SLA réintégration échoué:', err.message); }

    return res.json(ticket);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Validation humaine de la clôture suggérée par l'IA ────────────────────
// L'IA ne clôt plus jamais un ticket seule : elle marque closeSuggested=true (détection
// de résolution). La Hotline valide ici → SOLVED, ou rejette → le ticket reste actif.

// Valider la clôture suggérée : passe le ticket en SOLVED.
router.post('/:id/validate-close', forbidTechnicianTicketEdits, requirePermission('tickets.approve', ['ADMIN', 'TECHNICIAN', 'HOTLINE']), async (req, res) => {
  const id = Number(req.params.id);
  try {
    const existing = await prisma.ticket.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Ticket introuvable' });
    if (existing.status === 'SOLVED' || existing.status === 'CLOSED') {
      // Résidu de cohérence (données antérieures au fix) : ticket clôturé par un autre
      // chemin mais suggestion jamais consommée → on nettoie et on refuse poliment.
      await prisma.ticket.update({
        where: { id },
        data: { closeSuggested: false, closeSuggestedAt: null, closeSuggestionConfidence: null },
      }).catch(() => {});
      return res.status(400).json({ error: "Ce ticket est déjà résolu/fermé — plus aucune clôture à valider." });
    }
    if (!existing.closeSuggested) {
      return res.status(400).json({ error: 'Aucune clôture suggérée en attente sur ce ticket.' });
    }

    const ticket = await prisma.ticket.update({
      where: { id },
      data: {
        status: 'SOLVED',
        solvedAt: new Date(),
        closeSuggested: false,
        closeSuggestedAt: null,
        closeSuggestionConfidence: null,
        closeSuggestionCount: 0, // nouveau cycle autorisé sur un futur fil de ce ticket
        aiExchangeCount: 0, // conversation résolue : repart à zéro pour un futur fil sur ce ticket
      },
    });

    await logEvent(id, 'CLOSURE_VALIDATED', req.user.email || 'HOTLINE', {
      confidence: existing.closeSuggestionConfidence,
      note: req.body.note || null,
    });
    await auditLog('TICKET_CLOSURE_VALIDATED', {
      actor: req.user, targetType: 'Ticket', targetId: id,
      targetLabel: ticket.title,
      metadata: { confidence: existing.closeSuggestionConfidence, note: req.body.note || null },
    });

    // Boucle de feedback : une clôture validée renforce la réputation de l'expéditeur
    const { recordClosureDecision } = require('../services/senderReputation');
    await recordClosureDecision({ email: existing.sourceEmail, decision: 'APPROVED' }).catch(() => {});

    emitTicketUpdated(ticket, { status: 'SOLVED', closeSuggested: false });
    notifyRequesterOnStatusChange(id, 'SOLVED');

    // Auto-apprentissage : créer compétences et associer technicien
    const { learnFromResolution } = require('../services/skillLearningService');
    learnFromResolution(id).catch((err) =>
      console.error(`[ticket.routes] Échec apprentissage ticket ${id} (validate-close):`, err.message)
    );

    return res.json(ticket);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Rejeter la clôture suggérée : le problème n'est pas résolu, le ticket reste actif.
router.post('/:id/reject-close', forbidTechnicianTicketEdits, requirePermission('tickets.approve', ['ADMIN', 'TECHNICIAN', 'HOTLINE']), async (req, res) => {
  const id = Number(req.params.id);
  const note = req.body.note || req.body.reason;
  if (!note || !note.trim()) {
    return res.status(400).json({ error: 'Une raison de rejet est obligatoire.' });
  }
  try {
    const existing = await prisma.ticket.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Ticket introuvable' });
    if (existing.status === 'SOLVED' || existing.status === 'CLOSED') {
      // Résidu de cohérence (données antérieures au fix) : nettoyage au lieu d'un rejet
      // de clôture absurde sur un ticket déjà fermé.
      await prisma.ticket.update({
        where: { id },
        data: { closeSuggested: false, closeSuggestedAt: null, closeSuggestionConfidence: null },
      }).catch(() => {});
      return res.status(400).json({ error: "Ce ticket est déjà résolu/fermé — plus aucune clôture à rejeter." });
    }
    if (!existing.closeSuggested) {
      return res.status(400).json({ error: 'Aucune clôture suggérée en attente sur ce ticket.' });
    }

    const ticket = await prisma.ticket.update({
      where: { id },
      data: {
        status: 'OPEN',
        firstOpenedAt: existing.firstOpenedAt || new Date(),
        closeSuggested: false,
        closeSuggestedAt: null,
        closeSuggestionConfidence: null,
        lastUserReplyAt: new Date(),
      },
    });

    await logEvent(id, 'CLOSURE_REJECTED', req.user.email || 'HOTLINE', {
      confidence: existing.closeSuggestionConfidence,
      reason: note.trim(),
    });
    await auditLog('TICKET_CLOSURE_REJECTED', {
      actor: req.user, targetType: 'Ticket', targetId: id,
      targetLabel: ticket.title,
      metadata: { confidence: existing.closeSuggestionConfidence, reason: note.trim() },
    });

    // Boucle de feedback : une clôture rejetée dégrade la réputation clôture de l'expéditeur
    // et alimente le contexte « rejets récents » du prompt pour éviter de reproduire l'erreur.
    const { recordClosureDecision } = require('../services/senderReputation');
    await recordClosureDecision({ email: existing.sourceEmail, decision: 'REJECTED' }).catch(() => {});

    emitTicketUpdated(ticket, { status: 'OPEN', closeSuggested: false });
    notifyRequesterOnStatusChange(id, 'OPEN');
    return res.json(ticket);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Récupérer une suggestion de clôture rejetée : réinitialise le compteur et ré active
// la suggestion pour qu'elle réapparaisse dans le Centre de Validation.
router.post('/:id/recover-closure', requirePermission('tickets.approve', ['ADMIN', 'TECHNICIAN', 'HOTLINE']), async (req, res) => {
  const id = Number(req.params.id);
  try {
    const existing = await prisma.ticket.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Ticket introuvable' });
    if (['SOLVED', 'CLOSED'].includes(existing.status)) {
      return res.status(400).json({ error: 'Ce ticket est déjà résolu/fermé.' });
    }
    if (existing.closeSuggested) {
      return res.status(400).json({ error: 'Une suggestion de clôture est déjà active sur ce ticket.' });
    }
    if (!existing.closeSuggestionCount || existing.closeSuggestionCount === 0) {
      return res.status(400).json({ error: 'Aucune suggestion de clôture rejetée à récupérer sur ce ticket.' });
    }

    const ticket = await prisma.ticket.update({
      where: { id },
      data: {
        closeSuggested: true,
        closeSuggestedAt: new Date(),
        closeSuggestionConfidence: existing.closeSuggestionConfidence,
        closeSuggestionCount: 0, // réinitialiser pour autoriser de nouvelles suggestions
      },
    });

    await logEvent(id, 'CLOSURE_SUGGESTED', req.user.email || 'HOTLINE', {
      confidence: existing.closeSuggestionConfidence,
      reason: 'manual_recovery',
    });
    await auditLog('TICKET_CLOSURE_RECOVERED', {
      actor: req.user, targetType: 'Ticket', targetId: id,
      targetLabel: ticket.title,
      metadata: { confidence: existing.closeSuggestionConfidence },
    });

    emitTicketUpdated(ticket, { closeSuggested: true });
    return res.json(ticket);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Analyse proactive : scanne les tickets ouverts sans réponse utilisateur récente pour détecter
// les résolutions probables et proposer des clôtures à la Hotline (bouton « Analyse des tickets »).
router.post('/analyze-closures', forbidTechnicianTicketEdits, requirePermission('tickets.approve', ['ADMIN', 'TECHNICIAN', 'HOTLINE']), async (req, res) => {
  try {
    const { runClosureAnalysis } = require('../services/closureScanner');
    const max = Math.min(parseInt((req.body || {}).limit, 10) || 25, 100);
    const summary = await runClosureAnalysis({ limit: max });
    return res.json(summary);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
// Met à jour l'assignation, journalise dans ReassignmentLog et émet socket event.
router.patch('/:id/reassign', forbidTechnicianTicketEdits, requirePermission('tickets.assign', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const id = Number(req.params.id);
  const { assignedToId, reason } = req.body;

  if (!assignedToId) return res.status(400).json({ error: 'assignedToId requis' });

  try {
    const before = await prisma.ticket.findUnique({
      where: { id },
      select: { assignedToId: true, title: true, category: true },
    });
    if (!before) return res.status(404).json({ error: 'Ticket introuvable' });

    const ticket = await prisma.ticket.update({
      where: { id },
      data: { assignedToId: Number(assignedToId) },
    });

    // Journaliser la réassignation
    await prisma.reassignmentLog.create({
      data: {
        ticketId: id,
        previousTechnicianId: before.assignedToId || null,
        newTechnicianId: Number(assignedToId),
        reason: reason || (before.assignedToId ? 'reassignation_manuelle' : 'assignation_manuelle'),
        wasAutoAssigned: false,
        assignedByUserId: req.user.sub,
      },
    });

    emitTicketAssigned(id, ticket.title, Number(assignedToId), 'manual');

    prisma.user.findUnique({ where: { id: Number(assignedToId) }, select: { email: true, fullName: true } })
      .then((tech) => {
        if (tech?.email) {
          sendAssignmentNotificationEmail({
            ticketId: id, ticketTitle: ticket.title, priority: ticket.priority,
            technicianEmail: tech.email, technicianName: tech.fullName, category: ticket.category,
          }).catch((e) => console.error('[ticket.routes] Échec notification réassignation:', e.message));
        }
      }).catch(() => {});

    return res.json(ticket);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Escalade manuelle d'un ticket (prise en charge prioritaire par les admins)
// Body optionnel : { reason, targetTeamId, assignedToId }
// - targetTeamId  : réaffecte le ticket à une autre équipe (le technicien actuel est remplacé)
// - assignedToId  : technicien choisi dans l'équipe cible (optionnel — sinon ticket d'équipe non assigné)
// Droit requis : tickets.escalate — permission dédiée, délégable à une personne précise via les
// groupes de droits (par défaut : Administrateurs + Équipe Hotline). Le garde-fou par RÔLE
// (forbidTechnicianTicketEdits) est conservé : un technicien ne peut jamais escalader, même avec
// la permission dans son groupe.
router.post('/:id/escalate', forbidTechnicianTicketEdits, requirePermission('tickets.escalate'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason, targetTeamId, assignedToId } = req.body || {};
  try {
    // Escalade = TRANSFERT à une équipe responsable (ex : la sécurité valide,
    // le Système exécute) — toute la logique (transfert, traçabilité, notifications)
    // vit dans le service ; la validation des erreurs métier renvoie 400.
    const escalated = await escalateTicket(id, {
      reason: reason || 'Escalade manuelle',
      actor: `user:${req.user.sub}`,
      source: 'manual',
      targetTeamId: targetTeamId ?? null,
      assignedToId: assignedToId ?? undefined,
    });
    return res.json(escalated);
  } catch (err) {
    if (err.message === 'Ticket introuvable') return res.status(404).json({ error: err.message });
    if (err.message === 'Équipe cible introuvable'
      || err.message.includes('technicien')) return res.status(400).json({ error: err.message });
    // Statut non escaladable (SOLVED/CLOSED/REJECTED/corbeille) — erreur métier, pas un crash
    if (err.message.includes('escalader un ticket résolu')) return res.status(400).json({ error: err.message });
    console.error('[ticket.routes] Erreur escalade ticket:', err.message);
    return res.status(500).json({ error: 'Erreur lors de l\'escalade' });
  }
});

// Notifie le demandeur par email quand le statut de son ticket change
// + email différé 10 min quand le ticket passe en SOLVED
async function notifyRequesterOnStatusChange(id, status) {
  if (!status) return;
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        requester: { select: { email: true, fullName: true, avatarUrl: true } },
        assignedTo: { select: { fullName: true, avatarUrl: true } },
      },
    });
    if (!ticket?.requester?.email) return;

    // Email immédiat de changement de statut
    await sendTicketStatusNotification({
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      status,
      priority: ticket.priority,
      category: ticket.category,
      recipientEmail: ticket.requester.email,
      recipientName: ticket.requester.fullName,
    });

    // Email différé 10 min quand le ticket passe en SOLVED
    if (status === 'SOLVED') {
      const DELAY_MS = 10 * 60 * 1000; // 10 minutes
      setTimeout(() => {
        sendResolvedNotificationEmail({
          ticketId: ticket.id,
          ticketTitle: ticket.title,
          priority: ticket.priority,
          category: ticket.category,
          assignedToName: ticket.assignedTo?.fullName || null,
          requesterEmail: ticket.requester.email,
          requesterName: ticket.requester.fullName,
          content: ticket.content || null,
        }).catch((err) => {
          console.error(`[ticket.routes] Échec email résolution différé (ticket ${id}):`, err.message);
        });
      }, DELAY_MS);
    }
  } catch (err) {
    console.error(`[ticket.routes] Échec notification statut au demandeur (ticket ${id}):`, err.message);
  }
}

// ── Upload de suivi avec images collées ─────────────────────────────────
const FOLLOWUP_IMAGES_DIR = path.join(process.cwd(), 'uploads', 'followup-images');
fs.mkdirSync(FOLLOWUP_IMAGES_DIR, { recursive: true });

const TICKET_ATTACHMENTS_DIR = path.join(process.cwd(), 'uploads', 'ticket-attachments');
fs.mkdirSync(TICKET_ATTACHMENTS_DIR, { recursive: true });

const followupUpload = multer({
  dest: FOLLOWUP_IMAGES_DIR,
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Supprime les fichiers temporaires reçus par multer (réponses en erreur avant
// leur enregistrement définitif).
function dropUploadedFiles(files = []) {
  for (const f of files) { try { fs.unlinkSync(f.path); } catch {} }
}

// Écrit les images d'un suivi sur disque + crée la TicketAttachment associée.
// Partagé par la création (POST) et la modification (PATCH) d'un suivi.
// Lance une Error (message prêt à afficher) si un fichier est refusé — les
// fichiers déjà traités sont alors supprimés.
async function saveFollowupImages(files = [], ticketId) {
  const saved = [];
  for (const file of files) {
    const validation = validateUpload(file.originalname, file.mimetype, 'followup');
    if (!validation.valid) {
      dropUploadedFiles(files);
      throw new Error(validation.error);
    }
    const ext = path.extname(file.originalname) || '.png';
    const safeFilename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const destPath = path.join(FOLLOWUP_IMAGES_DIR, safeFilename);
    try {
      fs.renameSync(file.path, destPath);
    } catch {
      // rename peut échouer (ex: autre périphérique) → copie puis suppression
      fs.copyFileSync(file.path, destPath);
      fs.unlinkSync(file.path);
    }

    const attachment = await prisma.ticketAttachment.create({
      data: {
        ticketId,
        filename: file.originalname || safeFilename,
        mimeType: file.mimetype || 'image/png',
        localFilepath: path.join('uploads', 'followup-images', safeFilename),
      },
    });

    saved.push({
      id: attachment.id,
      filename: safeFilename,
      url: `/uploads/followup-images/${safeFilename}`,
    });
  }
  return saved;
}

// Remplace les marqueurs <!--IMAGE_<n>--> du contenu par les <img> correspondants.
// On garde un chemin relatif (/uploads/…) pour que les images s'affichent quel
// que soit le domaine, l'IP (ex: Dokploy) ou le port d'accès.
function applyFollowupImageMarkers(content = '', images = []) {
  let out = content;
  images.forEach((img, idx) => {
    out = out.replace(new RegExp(`<!--IMAGE_${idx}-->?`, 'gi'), `<img src="${img.url}" alt="image jointe" />`);
  });
  return out.replace(/<!--IMAGE_\d+-->?/gi, '');
}

// Supprime les images de suivi qui ne sont plus référencées nulle part dans le
// ticket (contenu du ticket + tous ses suivis) : ligne TicketAttachment + fichier
// sur disque. Sans ça, une image retirée d'un suivi restait affichée dans la
// zone « Pièces jointes » du ticket.
// Ne touche qu'aux pièces stockées dans uploads/followup-images/ (les pièces
// jointes manuelles et celles venues par email sont ignorées).
async function cleanupOrphanFollowupImages(ticketId) {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { content: true, followups: { select: { content: true } } },
    });
    if (!ticket) return { removed: 0 };

    const referenced = new Set();
    const scan = (html) => {
      if (!html) return;
      for (const m of html.matchAll(/\/uploads\/followup-images\/([A-Za-z0-9._-]+)/g)) referenced.add(m[1]);
    };
    scan(ticket.content);
    (ticket.followups || []).forEach((f) => scan(f.content));

    const rows = await prisma.ticketAttachment.findMany({
      where: { ticketId },
      select: { id: true, localFilepath: true },
    });

    let removed = 0;
    for (const row of rows) {
      const parts = (row.localFilepath || '').split(/[\\/]/);
      if (!parts.includes('followup-images')) continue;
      const safeName = parts[parts.length - 1];
      if (!safeName || referenced.has(safeName)) continue;

      await prisma.ticketAttachment.delete({ where: { id: row.id } });
      try { fs.unlinkSync(path.join(process.cwd(), row.localFilepath)); } catch {}
      removed += 1;
    }
    return { removed };
  } catch (err) {
    console.error('[ticket.routes] Nettoyage images de suivi échoué:', err.message);
    return { removed: 0 };
  }
}

const ticketAttachmentUpload = multer({
  dest: TICKET_ATTACHMENTS_DIR,
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Joindre manuellement des fichiers à un ticket (pièces jointes)
router.post('/:id/attachments', ticketAttachmentUpload.array('files', 10), async (req, res) => {
  const ticketId = Number(req.params.id);
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { id: true, requesterId: true, requesterIds: true } });
  if (!ticket) {
    for (const f of (req.files || [])) { try { fs.unlinkSync(f.path); } catch {} }
    return res.status(404).json({ error: 'Ticket introuvable' });
  }
  // Vérification d'accès (demandeur / observateur / équipe)
  if (isRequesterOnly(req.user) && ticket.requesterId !== req.user.sub && !(ticket.requesterIds || []).includes(req.user.sub)) {
    const isObserver = await prisma.ticket.findFirst({ where: { id: ticketId, observers: { some: { id: req.user.sub } } }, select: { id: true } });
    if (!isObserver) {
      for (const f of (req.files || [])) { try { fs.unlinkSync(f.path); } catch {} }
      return res.status(404).json({ error: 'Ticket introuvable' });
    }
  }
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Aucun fichier fourni' });

  const created = [];
  for (const file of req.files) {
    const validation = validateUpload(file.originalname, file.mimetype, 'ticket');
    if (!validation.valid) {
      for (const f of req.files) { try { fs.unlinkSync(f.path); } catch {} }
      return res.status(400).json({ error: validation.error });
    }
    const ext = path.extname(file.originalname) || '';
    const safeFilename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const destPath = path.join(TICKET_ATTACHMENTS_DIR, safeFilename);
    try { fs.renameSync(file.path, destPath); } catch { fs.copyFileSync(file.path, destPath); fs.unlinkSync(file.path); }
    const attachment = await prisma.ticketAttachment.create({
      data: {
        ticketId,
        filename: file.originalname,
        mimeType: file.mimetype,
        localFilepath: path.join('uploads', 'ticket-attachments', safeFilename),
        source: 'MANUAL_UPLOAD',
      },
    });
    created.push(attachment);
  }

  await logEvent(ticketId, 'FOLLOWUP_ADDED', req.user.email || String(req.user.sub), { attachmentCount: created.length }).catch(() => {});
  const updated = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { attachments: true } });
  return res.json({ attachments: updated.attachments });
});

// Upload d'images pour édition de description (collage/clic)
router.post('/:id/content-images', followupUpload.array('images', 10), async (req, res) => {
  const ticketId = Number(req.params.id);
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { id: true } });
  if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'Aucune image fournie' });
  }

  const uploaded = [];
  for (const file of req.files) {
    const fileValidation = validateUpload(file.originalname, file.mimetype, 'followup');
    if (!fileValidation.valid) {
      for (const f of req.files) { try { fs.unlinkSync(f.path); } catch {} }
      return res.status(400).json({ error: fileValidation.error });
    }
    const ext = path.extname(file.originalname) || '.png';
    const safeFilename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const destPath = path.join(FOLLOWUP_IMAGES_DIR, safeFilename);
    try {
      fs.renameSync(file.path, destPath);
    } catch {
      fs.copyFileSync(file.path, destPath);
      fs.unlinkSync(file.path);
    }
    uploaded.push({ url: `/uploads/followup-images/${safeFilename}`, filename: file.originalname });
  }

  res.json({ images: uploaded });
});

// Add followup / comment (supporte le collage d'images via FormData)
router.post('/:id/followups', followupUpload.array('images', 10), [body('content').notEmpty()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    dropUploadedFiles(req.files);
    return res.status(400).json({ errors: errors.array() });
  }

  const ticketId = Number(req.params.id);

  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) {
    dropUploadedFiles(req.files);
    return res.status(404).json({ error: 'Ticket introuvable' });
  }

  // Un demandeur/technicien ne commente que ses propres tickets ou ceux qu'il observe
  if (isRequesterOnly(req.user) && ticket.requesterId !== req.user.sub) {
    const isObserver = await prisma.ticket.findFirst({
      where: { id: ticketId, observers: { some: { id: req.user.sub } } },
      select: { id: true },
    });
    if (!isObserver) {
      dropUploadedFiles(req.files);
      return res.status(404).json({ error: 'Ticket introuvable' });
    }
  }
  if (isTechnicianOnly(req.user)) {
    if (['SOLVED', 'CLOSED'].includes(ticket.status)) {
      dropUploadedFiles(req.files);
      return res.status(403).json({ error: 'Un technicien ne peut pas ajouter de suivi sur un ticket résolu ou fermé.' });
    }
    // Un technicien peut commenter les tickets qui lui sont assignés (direct ou multi-assignees)
    // ET les tickets de son équipe (collaboration intra-équipe : les membres d'une même équipe
    // se relaient sur les tickets les uns des autres, y compris non assignés).
    const isAssigned = ticket.assignedToId === req.user.sub;
    const isMultiAssigned = !isAssigned && await prisma.ticket.findFirst({
      where: { id: ticketId, assignees: { some: { id: req.user.sub } } },
      select: { id: true },
    });
    const isTeamTicket = !isAssigned && !isMultiAssigned && ticket.teamId != null && ticket.teamId === req.user.teamId;
    if (!isAssigned && !isMultiAssigned && !isTeamTicket) {
      dropUploadedFiles(req.files);
      return res.status(403).json({ error: 'Vous ne pouvez ajouter un suivi que sur les tickets qui vous sont assignés ou qui appartiennent à votre équipe.' });
    }
  }

  // Sauvegarder les images uploadées et créer des TicketAttachment
  let imageAttachments = [];
  try {
    imageAttachments = await saveFollowupImages(req.files || [], ticketId);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Construire le contenu final : remplacer les marqueurs IMAGE_<n> par des <img> tags
  const content = sanitizeTicketHtml(applyFollowupImageMarkers(req.body.content || '', imageAttachments));

  const followup = await prisma.followup.create({
    data: {
      ticketId,
      authorId: req.user.sub,
      content,
      isPrivate: req.body.isPrivate === 'true' || req.body.isPrivate === true,
    },
    include: { author: { select: { id: true, fullName: true, avatarUrl: true } } },
  });

  // Le temps de première réponse est fixé au premier suivi d'un technicien/hotline/admin
  if (['ADMIN', 'TECHNICIAN', 'HOTLINE', 'SUPERADMIN'].includes(req.user.role)) {
    try {
      await recordFirstResponse(ticketId, req.user.sub);
    } catch (err) {
      console.error('[ticket.routes] Enregistrement première réponse échoué:', err.message);
    }
  }

  // Régénérer l'embedding avec le nouveau suivi (fire-and-forget)
  const { refreshTicketEmbedding } = require('../services/similarIncidentDetector');
  refreshTicketEmbedding(ticketId);

  // ── Mentions @ : envoi d'email à chaque utilisateur mentionné ────────────
  // Le frontend envoie mentionedUserIds (JSON stringifié en FormData) et/ou
  // embarque des <span data-mention-id="123"> dans le HTML sanitizé.
  // Tous les mentionnés reçoivent un mail avec le contenu du suivi (comme Outlook).
  (async () => {
    try {
      let mentionedIds = [];

      // 1) Champ explicite mentionedUserIds (prioritaire)
      if (req.body.mentionedUserIds) {
        try {
          const raw = req.body.mentionedUserIds;
          const arr = Array.isArray(raw) ? raw : JSON.parse(raw);
          if (Array.isArray(arr)) {
            mentionedIds.push(...arr.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0));
          }
        } catch {}
      }
      // 1b) Variante : mentions (compat)
      if (mentionedIds.length === 0 && req.body.mentions) {
        try {
          const raw = req.body.mentions;
          const arr = Array.isArray(raw) ? raw : JSON.parse(raw);
          if (Array.isArray(arr)) mentionedIds.push(...arr.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0));
        } catch {}
      }

      // 2) Fallback : parser le HTML sanitizé (data-mention-id="123")
      if (mentionedIds.length === 0) {
        const mentionRegex = /data-mention-id=["'](\d+)["']/g;
        let m;
        while ((m = mentionRegex.exec(content)) !== null) {
          const mid = Number(m[1]);
          if (Number.isInteger(mid) && mid > 0) mentionedIds.push(mid);
        }
        // Support Markdown-like @[Nom](123) si jamais utilisé côté client
        const mdRegex = /@\[[^\]]+\]\((\d+)\)/g;
        while ((m = mdRegex.exec(content)) !== null) {
          const mid = Number(m[1]);
          if (Number.isInteger(mid) && mid > 0) mentionedIds.push(mid);
        }
      }

      mentionedIds = [...new Set(mentionedIds)].filter((uid) => uid !== req.user.sub);
      if (mentionedIds.length === 0) return;

      const usersToNotify = await prisma.user.findMany({
        where: { id: { in: mentionedIds }, isActive: true },
        select: { id: true, email: true, fullName: true },
      });
      if (usersToNotify.length === 0) return;

      const { sendFollowupMentionEmail } = require('../services/emailSender');
      const ticketForMail = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { title: true } });
      const ticketTitle = ticketForMail?.title || `Ticket #${ticketId}`;
      const authorName = followup.author?.fullName || req.user.fullName || req.user.email || 'Un utilisateur';

      for (const u of usersToNotify) {
        if (!u.email) continue;
        sendFollowupMentionEmail({
          ticketId,
          ticketTitle,
          followupContent: content,
          followupAuthor: authorName,
          recipientEmail: u.email,
          recipientName: u.fullName,
        }).catch((e) => console.error(`[ticket.routes] Échec mail mention @${u.email} (ticket ${ticketId}):`, e.message));
      }

      // Journaliser les mentions pour traçabilité (un event par lot)
      await logEvent(ticketId, 'FOLLOWUP_ADDED', req.user.email || String(req.user.sub), {
        followupId: followup.id,
        mentionedUserIds: usersToNotify.map((u) => u.id),
      }).catch(() => {});
    } catch (err) {
      console.error('[ticket.routes] Mentions followup échoué:', err.message);
    }
  })();

  return res.status(201).json({ followup, imageAttachments });
});

// Bascule privé/public d'un commentaire (visible uniquement par l'équipe)
router.patch('/:id/followups/:followupId/visibility', forbidTechnicianTicketEdits, requirePermission('tickets.assign', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const ticketId = Number(req.params.id);
  const followupId = Number(req.params.followupId);

  const followup = await prisma.followup.findFirst({
    where: { id: followupId, ticketId },
    include: { author: { select: { id: true, fullName: true, avatarUrl: true } } },
  });
  if (!followup) return res.status(404).json({ error: 'Commentaire introuvable' });

  const isPrivate = req.body.isPrivate === true || req.body.isPrivate === 'true';
  const updated = await prisma.followup.update({
    where: { id: followupId },
    data: { isPrivate },
    include: { author: { select: { id: true, fullName: true, avatarUrl: true } } },
  });

  try {
    await logEvent(ticketId, isPrivate ? 'FOLLOWUP_MADE_PRIVATE' : 'FOLLOWUP_MADE_PUBLIC', req.user.email || String(req.user.sub), { followupId });
  } catch (err) {
    console.error('[ticket.routes] Log visibilité commentaire échoué:', err.message);
  }

  return res.json({ followup: updated });
});

// Modifier le contenu d'un commentaire
// Modifier un commentaire (son auteur, ou ADMIN/SUPERADMIN) — accepte aussi des
// images jointes en multipart pour ajouter une image à un suivi existant.
router.patch('/:id/followups/:followupId', requirePermission('tickets.assign', ['ADMIN', 'TECHNICIAN']), followupUpload.array('images', 10), async (req, res) => {
  const ticketId = Number(req.params.id);
  const followupId = Number(req.params.followupId);
  const { content } = req.body;

  if (!content || !content.trim()) {
    dropUploadedFiles(req.files);
    return res.status(400).json({ error: 'Le contenu ne peut pas être vide' });
  }

  if (isTechnicianOnly(req.user)) {
    const parentTicket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true } });
    if (parentTicket && ['SOLVED', 'CLOSED'].includes(parentTicket.status)) {
      dropUploadedFiles(req.files);
      return res.status(403).json({ error: 'Un technicien ne peut pas modifier un suivi sur un ticket résolu ou fermé.' });
    }
  }

  const followup = await prisma.followup.findFirst({
    where: { id: followupId, ticketId },
    include: { author: { select: { id: true, fullName: true, avatarUrl: true } } },
  });
  if (!followup) {
    dropUploadedFiles(req.files);
    return res.status(404).json({ error: 'Commentaire introuvable' });
  }

  if (followup.source === 'glpi') {
    dropUploadedFiles(req.files);
    return res.status(403).json({ error: 'Impossible de modifier un commentaire synchronisé depuis GLPI' });
  }

  const isAdmin = ['ADMIN', 'SUPERADMIN'].includes(req.user.role);
  if (!isAdmin && followup.authorId !== req.user.sub) {
    dropUploadedFiles(req.files);
    return res.status(403).json({ error: 'Vous ne pouvez modifier que vos propres commentaires' });
  }

  // Nouvelles images éventuelles (collées / glissées / choisies à l'édition)
  let imageAttachments = [];
  try {
    imageAttachments = await saveFollowupImages(req.files || [], ticketId);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const sanitized = sanitizeTicketHtml(applyFollowupImageMarkers(content.trim(), imageAttachments));
  const updated = await prisma.followup.update({
    where: { id: followupId },
    data: { content: sanitized, updatedAt: new Date() },
    include: { author: { select: { id: true, fullName: true, avatarUrl: true } } },
  });

  // Une image retirée du suivi ne doit plus apparaître dans « Pièces jointes »
  const cleanup = await cleanupOrphanFollowupImages(ticketId);

  try {
    await logEvent(ticketId, 'FOLLOWUP_EDITED', req.user.email || String(req.user.sub), {
      followupId,
      imagesAdded: imageAttachments.length,
      imagesRemoved: cleanup.removed,
    });
  } catch (err) {
    console.error('[ticket.routes] Log édition commentaire échoué:', err.message);
  }

  return res.json({ followup: updated, imageAttachments, imagesRemoved: cleanup.removed });
});

// Supprimer un commentaire (ADMIN / SUPERADMIN uniquement)
router.delete('/:id/followups/:followupId', requirePermission('tickets.assign', ['ADMIN', 'SUPERADMIN']), async (req, res) => {
  const ticketId = Number(req.params.id);
  const followupId = Number(req.params.followupId);

  const followup = await prisma.followup.findFirst({
    where: { id: followupId, ticketId },
  });
  if (!followup) return res.status(404).json({ error: 'Commentaire introuvable' });

  if (followup.source === 'glpi') {
    return res.status(403).json({ error: 'Impossible de supprimer un commentaire synchronisé depuis GLPI' });
  }

  await prisma.followup.delete({ where: { id: followupId } });

  // Les images propres à ce suivi ne doivent plus figer dans « Pièces jointes »
  await cleanupOrphanFollowupImages(ticketId);

  try {
    await logEvent(ticketId, 'FOLLOWUP_DELETED', req.user.email || String(req.user.sub), { followupId });
  } catch (err) {
    console.error('[ticket.routes] Log suppression commentaire échoué:', err.message);
  }

  return res.json({ success: true });
});

// ── Tickets liés ────────────────────────────────────────────────────────
router.post('/:id/links', forbidTechnicianTicketEdits, requirePermission('tickets.assign', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const ticketId = Number(req.params.id);
  const { targetTicketId, type } = req.body;

  const target = Number(targetTicketId);
  if (!target || target === ticketId) {
    return res.status(400).json({ error: 'Ticket cible invalide' });
  }
  const rawType = normalizeLinkType(type);

  const [ticket, targetTicket] = await Promise.all([
    prisma.ticket.findUnique({ where: { id: ticketId }, select: { id: true } }),
    prisma.ticket.findUnique({ where: { id: target }, select: { id: true, title: true } }),
  ]);
  if (!ticket || !targetTicket) return res.status(404).json({ error: 'Ticket introuvable' });

  // Liens symétriques : on mémorise toujours (idA < idB) pour éviter les doublons inversés
  const { idA, idB } = normalizeLinkEndpoints(ticketId, target);
  // Pour PARENT/CHILD la direction compte : le type stocké est exprimé du point de vue de idA
  const linkType = rawType === 'PARENT' || rawType === 'CHILD'
    ? normalizeParentChildType(ticketId, target, rawType)
    : rawType;

  const link = await prisma.ticketLink.upsert({
    where: { ticketAId_ticketBId_type: { ticketAId: idA, ticketBId: idB, type: linkType } },
    create: { ticketAId: idA, ticketBId: idB, type: linkType, createdById: req.user.sub },
    update: {},
  });

  await logEvent(ticketId, 'LINKED', req.user.email || 'SYSTEM', { targetTicketId: target, linkType });
  await logEvent(target, 'LINKED', req.user.email || 'SYSTEM', { targetTicketId: ticketId, linkType });

  return res.status(201).json({ link });
});

router.delete('/:id/links/:linkId', forbidTechnicianTicketEdits, requirePermission('tickets.assign', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const linkId = Number(req.params.linkId);
  const link = await prisma.ticketLink.findUnique({ where: { id: linkId } });
  if (!link) return res.status(404).json({ error: 'Lien introuvable' });

  await prisma.ticketLink.delete({ where: { id: linkId } });
  await logEvent(link.ticketAId, 'UNLINKED', req.user.email || 'SYSTEM', { targetTicketId: link.ticketBId });
  await logEvent(link.ticketBId, 'UNLINKED', req.user.email || 'SYSTEM', { targetTicketId: link.ticketAId });

  return res.json({ ok: true });
});

// ── Sous-tickets (parent/enfant) ─────────────────────────────────────────
// Crée un ticket enfant depuis un parent : hérite catégorie, équipe, demandeur,
// priorité, lieu, observateurs par défaut, puis établit le lien PARENT→CHILD.
router.post('/:id/children', forbidTechnicianTicketEdits, requirePermission('tickets.assign', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const parentId = Number(req.params.id);
  const { title, content, priority } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Le titre est requis' });

  const parent = await prisma.ticket.findUnique({
    where: { id: parentId },
    include: { team: { include: { defaultObservers: true } } },
  });
  if (!parent) return res.status(404).json({ error: 'Ticket parent introuvable' });

  // Héritage : catégorie, équipe, demandeur, priorité, lieu, type du parent
  const inheritedPriority = priority || parent.priority;
  const observerIds = (parent.team?.defaultObservers || []).map((u) => u.id);

  const child = await prisma.ticket.create({
    data: {
      title: title.trim(),
      content: content || '',
      type: parent.type,
      category: parent.category,
      priority: inheritedPriority,
      urgency: parent.urgency,
      impact: parent.impact,
      source: 'PORTAL',
      origin: 'PORTAIL',
      status: 'NEW',
      teamId: parent.teamId,
      assignedToId: parent.assignedToId || null,
      requesterId: parent.requesterId || null,
      createdById: req.user.sub,

      ...(observerIds.length > 0 ? { observers: { connect: observerIds.map((userId) => ({ id: userId })) } } : {}),
    },
  });

  // SLA : échéances calculées à la création (héritées de la priorité du parent)
  try { await applySla(child); } catch (err) { console.error('[ticket.routes] Calcul SLA sous-ticket échoué:', err.message); }

  // Lien hiérarchique PARENT → CHILD (direction préservée quel que soit l'ordre des ids)
  const { idA, idB } = normalizeLinkEndpoints(parentId, child.id);
  const linkType = normalizeParentChildType(parentId, child.id, 'PARENT');
  await prisma.ticketLink.create({
    data: { ticketAId: idA, ticketBId: idB, type: linkType, createdById: req.user.sub },
  }).catch(() => {});

  await logEvent(parentId, 'LINKED', req.user.email || 'SYSTEM', { targetTicketId: child.id, linkType: 'PARENT' });
  await logEvent(child.id, 'LINKED', req.user.email || 'SYSTEM', { targetTicketId: parentId, linkType: 'CHILD' });

  emitTicketCreated(child);

  if (child.assignedToId) {
    emitTicketAssigned(child.id, child.title, child.assignedToId, 'manual');
    prisma.user.findUnique({ where: { id: child.assignedToId }, select: { email: true, fullName: true } })
      .then((tech) => {
        if (tech?.email) {
          sendAssignmentNotificationEmail({
            ticketId: child.id, ticketTitle: child.title, priority: child.priority,
            technicianEmail: tech.email, technicianName: tech.fullName, category: child.category,
          }).catch((e) => console.error('[ticket.routes] Échec notification assignation enfant:', e.message));
        }
      }).catch(() => {});
  }

  return res.status(201).json(child);
});

// ── Fusion de tickets sources dans le ticket courant ────────────────────
router.post('/:id/merge', forbidTechnicianTicketEdits, requirePermission('tickets.assign', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const targetId = Number(req.params.id);
  const sourceIds = (req.body.sourceTicketIds || []).map(Number).filter((n) => Number.isInteger(n) && n !== targetId);
  if (sourceIds.length === 0) {
    return res.status(400).json({ error: 'Aucun ticket source valide à fusionner' });
  }

  const target = await prisma.ticket.findUnique({ where: { id: targetId } });
  if (!target) return res.status(404).json({ error: 'Ticket cible introuvable' });

  const sources = await prisma.ticket.findMany({ where: { id: { in: sourceIds } } });
  if (sources.length === 0) return res.status(404).json({ error: 'Tickets sources introuvables' });

  const result = await prisma.$transaction((tx) =>
    mergeTickets(targetId, sourceIds, req.user.email || 'SYSTEM', tx)
  );

  return res.json({ ok: true, ...result });
});

// ── CSAT : notation de satisfaction par le demandeur ─────────────────────
router.post('/:id/csat', async (req, res) => {
  const ticketId = Number(req.params.id);
  const { score, comment } = req.body;

  const rating = Number(score);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'La note doit être un entier entre 1 et 5' });
  }

  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

  // Seul le demandeur (ou un membre de l'équipe) peut noter
  const isStaffMember = ['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN'].includes(req.user.role);
  if (!isStaffMember && ticket.requesterId !== req.user.sub) {
    return res.status(403).json({ error: 'Seul le demandeur peut noter ce ticket' });
  }

  // Une seule notation, modifiable
  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      csatScore: rating,
      csatComment: comment ? String(comment).slice(0, 2000) : null,
      csatRatedAt: new Date(),
    },
    select: { id: true, csatScore: true, csatComment: true, csatRatedAt: true },
  });

  await logEvent(ticketId, 'FOLLOWUP_ADDED', req.user.email || 'SYSTEM', { action: 'csat', score: rating });

  return res.json(updated);
});

// ── Corbeille (soft delete) ─────────────────────────────────────────────────
// Seuls SUPERADMIN, ADMIN et HOTLINE peuvent supprimer/restaurer des tickets (les techniciens et demandeurs sont strictement interdits).
function requireDeleteTicketPermission(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentification requise' });
  if (['SUPERADMIN', 'ADMIN', 'HOTLINE'].includes(req.user.role)) return next();
  return res.status(403).json({ error: 'Seuls les administrateurs et la hotline peuvent supprimer un ticket.' });
}

// DELETE /:id → met à la corbeille (restaurable). Suppression définitive : DELETE /:id?permanent=true
router.delete('/:id', forbidTechnicianTicketEdits, requireDeleteTicketPermission, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const ticket = await prisma.ticket.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

    // Suppression définitive explicite (depuis la corbeille)
    if (req.query.permanent === 'true') {
      await prisma.ticket.delete({ where: { id } });
      await auditLog('TICKET_DELETED_PERMANENTLY', { actor: req.user, targetType: 'Ticket', targetId: id, metadata: { ticketId: id } });
      return res.status(204).send();
    }

    if (ticket.deletedAt) {
      return res.status(400).json({ error: 'Ticket déjà dans la corbeille' });
    }

    await prisma.ticket.update({ where: { id }, data: { deletedAt: new Date(), deletedById: req.user.sub } });
    await logEvent(id, 'DELETED', req.user.email || 'SYSTEM');
    await auditLog('TICKET_SOFT_DELETED', { actor: req.user, targetType: 'Ticket', targetId: id, metadata: { ticketId: id } });

    // Un ticket à la corbeille ne doit plus générer de relances ni pouvoir voir ses
    // brouillons IA approuvés à distance : on les rejette explicitement.
    await prisma.aiEmailDraft.updateMany({
      where: { ticketId: id, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedById: req.user.sub, reviewedAt: new Date(), reviewNote: 'Brouillon rejeté : ticket mis à la corbeille' },
    }).catch(() => {});

    return res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Ticket introuvable' });
    console.error('[ticket.routes] Erreur suppression ticket:', err);
    return res.status(500).json({ error: 'Erreur interne' });
  }
});

// Restaure un ticket depuis la corbeille
router.post('/:id/restore', forbidTechnicianTicketEdits, requireDeleteTicketPermission, async (req, res) => {
  const id = Number(req.params.id);
  const ticket = await prisma.ticket.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
  if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
  if (!ticket.deletedAt) return res.status(400).json({ error: "Ce ticket n'est pas supprimé" });

  await prisma.ticket.update({ where: { id }, data: { deletedAt: null, deletedById: null } });
  await logEvent(id, 'RESTORED', req.user.email || 'SYSTEM');
  await auditLog('TICKET_RESTORED', { actor: req.user, targetType: 'Ticket', targetId: id, metadata: { ticketId: id } });
  return res.json({ ok: true, id });
});

// Delete tickets in bulk — body: { ids: [1, 2, 3] }
router.post('/bulk-delete', forbidTechnicianTicketEdits, requireDeleteTicketPermission, [body('ids').isArray({ min: 1 })], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const ids = req.body.ids.map(Number).filter((n) => !Number.isNaN(n));
  if (ids.length === 0) return res.status(400).json({ error: 'Aucun identifiant valide fourni' });
  if (req.body.permanent === true) {
    const result = await prisma.ticket.deleteMany({ where: { id: { in: ids }, deletedAt: { not: null } } });
    await auditLog('TICKETS_DELETED_PERMANENTLY', { actor: req.user, targetType: 'Ticket', metadata: { count: result.count, ids } });
    return res.json({ deleted: result.count, permanent: true });
  }

  // Soft delete groupé — uniquement des tickets non déjà supprimés
  const result = await prisma.ticket.updateMany({
    where: { id: { in: ids }, deletedAt: null },
    data: { deletedAt: new Date(), deletedById: req.user.sub },
  });
  // Rejeter les brouillons IA PENDING des tickets mis à la corbeille
  await prisma.aiEmailDraft.updateMany({
    where: { ticketId: { in: ids }, status: 'PENDING' },
    data: { status: 'REJECTED', reviewedById: req.user.sub, reviewedAt: new Date(), reviewNote: 'Brouillon rejeté : ticket mis à la corbeille' },
  }).catch(() => {});
  for (const id of ids) {
    await logEvent(id, 'DELETED', req.user.email || 'SYSTEM').catch(() => {});
  }
  await auditLog('TICKETS_SOFT_DELETED', { actor: req.user, targetType: 'Ticket', metadata: { count: result.count, ids } });
  return res.json({ deleted: result.count });
});

// Restore tickets in bulk — body: { ids: [1, 2, 3] }
router.post('/bulk-restore', forbidTechnicianTicketEdits, requireDeleteTicketPermission, [body('ids').isArray({ min: 1 })], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const ids = req.body.ids.map(Number).filter((n) => !Number.isNaN(n));
  if (ids.length === 0) return res.status(400).json({ error: 'Aucun identifiant valide fourni' });

  const result = await prisma.ticket.updateMany({
    where: { id: { in: ids }, deletedAt: { not: null } },
    data: { deletedAt: null, deletedById: null },
  });
  for (const id of ids) {
    await logEvent(id, 'RESTORED', req.user.email || 'SYSTEM').catch(() => {});
  }
  await auditLog('TICKETS_RESTORED', { actor: req.user, targetType: 'Ticket', metadata: { count: result.count, ids } });
  return res.json({ restored: result.count });
});

// ── Transférer la conversation email ────────────────────────────────────────
// POST /api/tickets/:id/forward-email — body: { to: "email@example.com" }
// Sécurité : seul le demandeur assigné OU le technicien assigné peut transférer.
router.post('/:id/forward-email', async (req, res) => {
  const ticketId = Number(req.params.id);
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true, title: true, sourceEmail: true, sourceName: true, sourceSubject: true,
      requesterIds: true, assignedToId: true,
      assignees: { select: { id: true } },
      messages: {
        orderBy: { timestamp: 'asc' },
        select: {
          direction: true, sender: true, recipients: true, subject: true,
          bodyHtml: true, body: true, timestamp: true, ccRecipients: true,
          conversationId: true, internetMessageId: true, outlookMessageId: true,
        },
      },
    },
  });

  if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

  // Vérification de sécurité : demandeur OU technicien assigné
  const uid = req.user.sub;
  const isRequester = (ticket.requesterIds || []).some((rid) => rid === uid);
  const isAssignedTechnician = ticket.assignedToId === uid || (ticket.assignees || []).some((a) => a.id === uid);
  const isAdmin = ['SUPERADMIN', 'ADMIN'].includes(req.user.role);

  if (!isRequester && !isAssignedTechnician && !isAdmin) {
    return res.status(403).json({ error: 'Vous devez être demandeur ou technicien assigné pour transférer cette conversation.' });
  }

  if (!ticket.messages || ticket.messages.length === 0) {
    return res.status(400).json({ error: 'Aucun email dans la conversation de ce ticket.' });
  }

  // Répondre dans le fil de la conversation existante (thread)
  const lastMsg = ticket.messages[ticket.messages.length - 1];
  const conversationId = lastMsg?.conversationId || null;
  const inReplyToId = lastMsg?.outlookMessageId || null;
  const inReplyToHeader = lastMsg?.internetMessageId || null;

  const replyTo = req.user.email;
  if (!replyTo) return res.status(400).json({ error: 'Aucune adresse email associée à votre compte.' });

  const subject = `Re: ${ticket.sourceSubject || ticket.title}`;
  // Corps = transfert de la conversation originale (pas un résumé IA)
  const conversationHtml = ticket.messages.map((msg) => {
    const dir = msg.direction === 'INBOUND' ? '📥 Reçu' : '📤 Envoyé';
    const date = new Date(msg.timestamp).toLocaleString('fr-FR');
    const from = msg.sender || 'Inconnu';
    const toList = (msg.recipients || []).join(', ');
    const ccList = (msg.ccRecipients || []).length > 0 ? `<br><strong>CC :</strong> ${msg.ccRecipients.join(', ')}` : '';
    const body = msg.bodyHtml || `<pre style="white-space:pre-wrap;font-family:inherit">${msg.body || ''}</pre>`;
    return `
      <div style="margin-bottom:24px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="background:#f9fafb;padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:13px">
          <div><strong>${dir}</strong> — ${date}</div>
          <div><strong>De :</strong> ${from}</div>
          <div><strong>À :</strong> ${toList}</div>
          ${ccList}
          ${msg.subject ? `<div><strong>Sujet :</strong> ${msg.subject}</div>` : ''}
        </div>
        <div style="padding:16px;font-size:13px;line-height:1.5">${body}</div>
      </div>`;
  }).join('');

  const bodyHtml = `
    <div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto">
      <div style="background:#2563eb;color:white;padding:16px 20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:16px">📋 Conversation transférée — Ticket #${ticket.id}</h2>
        <p style="margin:4px 0 0;font-size:13px;opacity:0.9">${ticket.title}</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;padding:20px;border-radius:0 0 8px 8px">
        <p style="font-size:13px;color:#6b7280;margin:0 0 16px">
          Transmis par <strong>${req.user.fullName || req.user.email}</strong> le ${new Date().toLocaleString('fr-FR')}.
        </p>
        ${conversationHtml}
      </div>
    </div>`;

  try {
    await sendEmail({
      ticketId: ticket.id,
      to: replyTo,
      subject,
      bodyHtml,
      conversationId: conversationId || undefined,
      inReplyTo: inReplyToHeader || undefined,
      inReplyToGraphMessageId: inReplyToId || undefined,
      saveAsMessage: true,
    });
    await logEvent(ticket.id, 'EMAIL_SENT', req.user.email || 'SYSTEM', {
      replyTo,
      conversationId,
    }).catch(() => {});
    return res.json({ success: true, message: `Réponse envoyée à ${replyTo} dans la conversation` });
  } catch (err) {
    console.error('[forward-email] Erreur envoi:', err.message);
    return res.status(500).json({ error: 'Erreur lors de l\'envoi : ' + err.message });
  }
});

module.exports = router;
