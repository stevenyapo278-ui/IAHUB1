const express = require('express');
const { body, validationResult } = require('express-validator');
const path = require('path');
const fs = require('fs');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { notifyMajorIncidentResolved, sendTicketStatusNotification, sendResolvedNotificationEmail, sendTicketCreationNotification, sendAcknowledgement, sendAssignmentNotificationEmail } = require('../services/emailSender');
const { approveTicket } = require('../services/ticketApproval');
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
const multer = require('multer');
const ExcelJS = require('exceljs');
const { validateUpload, safeFilename: makeSafeFilename } = require('../utils/security');

const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } }); // 20 Mo max
const router = express.Router();
router.use(authenticate);

// Un compte REQUESTER (créé automatiquement via AD/LDAP ou manuellement) ne voit que ses propres
// tickets : liste, détail, pièces jointes, corrections et export sont forcés sur ses tickets —
// aucun contenu des autres demandeurs ne doit fuiter, même si le client manipule les filtres.
function isRequesterOnly(user) {
  return user.role === 'REQUESTER';
}

// Un technicien ne voit que les tickets qui lui sont assignés ou qu'il a ouverts.
function isTechnicianOnly(user) {
  return user.role === 'TECHNICIAN';
}

// RÈGLE : un TECHNICIAN ne peut pas modifier librement un ticket (titre, contenu,
// priorité, catégorie, lieu, assignation, approbation, liens, fusion, suppression...).
// Exception : un technicien ASSIGNÉ au ticket peut changer le statut (ex: mettre en SOLVED/CLOSED).
// Ce garde-fou s'applique par RÔLE : seule la modification de statut par l'assigné est autorisée.
const TECHNICIAN_EDIT_ERROR = 'Un technicien ne peut modifier que le statut des tickets qui lui sont assignés.';
function forbidTechnicianTicketEdits(req, res, next) {
  if (req.user && req.user.role === 'TECHNICIAN') {
    return res.status(403).json({ error: TECHNICIAN_EDIT_ERROR });
  }
  next();
}

// Middleware PATCH : un technicien assigné ne peut changer que le statut.
// Pour tout autre champ, on bloque. Les autres rôles passent directement.
async function allowTechnicianStatusOnly(req, res, next) {
  if (!req.user || req.user.role !== 'TECHNICIAN') return next();

  const id = Number(req.params.id);
  const bodyKeys = Object.keys(req.body);

  // Vérifier que seul le champ "status" est envoyé
  const forbiddenFields = bodyKeys.filter((k) => k !== 'status');
  if (forbiddenFields.length > 0) {
    return res.status(403).json({ error: TECHNICIAN_EDIT_ERROR });
  }

  // Vérifier que le technicien est bien assigné à ce ticket
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      select: { status: true, assignedToId: true, assignees: { select: { id: true } } },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

    // Un technicien ne peut apporter aucune modification si le ticket est résolu ou fermé
    if (['SOLVED', 'CLOSED'].includes(ticket.status)) {
      return res.status(403).json({ error: 'Aucune modification ne peut être apportée par un technicien sur un ticket résolu ou fermé.' });
    }

    const isAssigned =
      ticket.assignedToId === req.user.sub ||
      ticket.assignees.some((a) => a.id === req.user.sub);
    if (!isAssigned) {
      return res.status(403).json({ error: 'Vous ne pouvez modifier que les tickets qui vous sont assignés.' });
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

function buildTicketWhereClause(user, queryParams = {}) {
  const {
    status, priority, teamId, assignedToId, mine, title, search, query,
    category, locationId, aiProcessed, due, closeSuggested, approvalStatus,
    dateFrom, dateTo, source, origin,
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

  if (status) {
    if (status === 'OPEN_GROUP') {
      andConditions.push({ status: { in: ['NEW', 'OPEN', 'PLANNED'] } });
    } else if (status === 'PENDING_GROUP' || status === 'PENDING') {
      andConditions.push({ status: { in: ['PENDING', 'WAITING_FOR_USER'] } });
    } else if (status === 'CLOSED_GROUP') {
      andConditions.push({ status: { in: ['SOLVED', 'CLOSED'] } });
    } else if (status === 'NOT_CLOSED') {
      andConditions.push({ status: { notIn: ['SOLVED', 'CLOSED'] } });
    } else if (status === 'SOLVED_GROUP') {
      andConditions.push({ status: 'SOLVED' });
    } else {
      andConditions.push({ status });
    }
  }

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

  if (dateFrom || dateTo) {
    const dateCond = {};
    if (dateFrom) dateCond.gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
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
    prisma.ticket.groupBy({ where, by: ['status', 'priority'], _count: { _all: true } }),
    prisma.ticket.count({ where: { ...where, aiProcessed: true } }),
    prisma.ticket.count({ where: { ...where, assignedToId: null } }),
  ]);

  // Agrégation des compteurs de statut/priorité côté serveur (coût négligeable :
  // au plus ~6 statuts × 4 priorités lignes retournées par le GROUP BY).
  let openCount = 0, pendingCount = 0, solvedCount = 0, closedCount = 0, p1Count = 0, p2Count = 0;
  for (const row of breakdown) {
    const n = row._count._all;
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

  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Tickets');
    sheet.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'Titre', key: 'title', width: 45 },
      { header: 'Statut', key: 'status', width: 16 },
      { header: 'Priorité', key: 'priority', width: 10 },
      { header: 'Catégorie', key: 'category', width: 22 },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Source', key: 'source', width: 12 },
      { header: 'Demandeur', key: 'requester', width: 28 },
      { header: 'Technicien', key: 'technician', width: 28 },
      { header: 'Équipe', key: 'team', width: 20 },
      { header: 'Lieu', key: 'location', width: 18 },
      { header: 'Créé le', key: 'createdAt', width: 18 },
      { header: 'Résolu le', key: 'solvedAt', width: 18 },
      { header: 'Fermé le', key: 'closedAt', width: 18 },
      { header: 'SLA réponse due', key: 'slaResponseDueAt', width: 18 },
      { header: 'SLA résolution due', key: 'slaResolutionDueAt', width: 18 },
      { header: 'SLA dépassé le', key: 'slaBreachedAt', width: 18 },
      { header: 'Première réponse', key: 'firstResponseAt', width: 18 },
      { header: 'IA', key: 'aiProcessed', width: 6 },
      { header: 'Approbation', key: 'approvalStatus', width: 14 },
    ];
    // Colonnes de dates : format français + en-tête en gras, figée et filtrable
    for (const col of ['createdAt', 'solvedAt', 'closedAt', 'slaResponseDueAt', 'slaResolutionDueAt', 'slaBreachedAt', 'firstResponseAt']) {
      sheet.getColumn(col).numFmt = 'dd/mm/yyyy hh:mm';
    }
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: 'T1' };

    for (const t of tickets) {
      sheet.addRow({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        category: t.category || '',
        type: t.type,
        source: t.source || '',
        requester: t.requester?.fullName ? `${t.requester.fullName} (${t.requester.email})` : (t.requester?.email || ''),
        technician: t.assignedTo?.fullName ? `${t.assignedTo.fullName} (${t.assignedTo.email})` : (t.assignedTo?.email || ''),
        team: t.team?.name || '',
        location: t.locationName || '',
        createdAt: t.createdAt,
        solvedAt: t.solvedAt,
        closedAt: t.closedAt,
        slaResponseDueAt: t.slaResponseDueAt,
        slaResolutionDueAt: t.slaResolutionDueAt,
        slaBreachedAt: t.slaBreachedAt,
        firstResponseAt: t.firstResponseAt,
        aiProcessed: t.aiProcessed ? 'oui' : 'non',
        approvalStatus: t.approvalStatus,
      });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="tickets_export_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    return workbook.xlsx.write(res);
  }

  if (format === 'csv') {
    const header = ['id', 'titre', 'statut', 'priorite', 'categorie', 'type', 'source', 'demandeur', 'technicien', 'equipe', 'lieu', 'cree_le', 'resolu_le', 'ferme_le', 'sla_reponse_due', 'sla_resolution_due', 'sla_depasse_le', 'premiere_reponse', 'ia', 'approbation'];
    const rows = tickets.map((t) => [
      t.id, `"${(t.title || '').replace(/"/g, '""')}"`, t.status, t.priority, `"${(t.category || '').replace(/"/g, '""')}"`,
      t.type, t.source || '', t.requester?.fullName ? `${t.requester.fullName} (${t.requester.email})` : (t.requester?.email || ''), t.assignedTo?.fullName ? `${t.assignedTo.fullName} (${t.assignedTo.email})` : (t.assignedTo?.email || ''), t.team?.name || '',
      t.locationName || '', t.createdAt?.toISOString() || '', t.solvedAt?.toISOString() || '',
      t.closedAt?.toISOString() || '', t.slaResponseDueAt?.toISOString() || '', t.slaResolutionDueAt?.toISOString() || '',
      t.slaBreachedAt?.toISOString() || '', t.firstResponseAt?.toISOString() || '', t.aiProcessed ? 'oui' : 'non', t.approvalStatus,
    ]);
    const csv = [header.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
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
      },
    }),
    prisma.ticket.count({ where }),
  ]);
  return res.json({ items, total });
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

  return res.json(ticket);
});

// Télécharge le contenu d'une pièce jointe locale
router.get('/:id/attachments/:attachmentId/file', async (req, res) => {
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
  }

  return res.status(404).json({ error: 'Fichier non disponible sur ce serveur' });
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
      title, content, priority, category, teamId, assignedToId, requesterId, secondaryRequesterId, requiresApproval,
      type, urgency, impact, source, externalId, status, openedAt, locationId, dueDate,
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
    const finalRequesterIdFromIds = requesterIds.length > 0 ? requesterIds[0] : null;

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
    const finalRequesterId = canSetRequester && requesterId ? Number(requesterId) : req.user.sub;

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
        // Les tickets créés manuellement sont directement approuvés — seuls les tickets
        // créés par email/IA (createTicketFromEmail, aiProcessed=true) passent par la validation Hotline.
        approvalStatus: 'APPROVED',
        type: type || 'INCIDENT',
        urgency: urgency || 'MEDIUM',
        impact: impact || 'MEDIUM',
        ...(dueDate ? { dueDate: new Date(dueDate) } : {}),
        source: source || null,
        externalId: externalId || null,
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
      sendTicketCreationNotification(finalTicket).catch((err) =>
        console.error('[ticket.routes] Notification création échouée:', err.message)
      );
    }

    return res.status(201).json(finalTicket);
  }
);

// Update ticket (status, priority, assignment, etc.)
router.patch('/:id', allowTechnicianStatusOnly, requireTicketAssignOrTechnicianStatusOnly, async (req, res) => {
  const id = Number(req.params.id);
  // Whitelist : seuls ces champs acceptent la mise à jour (protection mass assignment)
  const allowed = ['title', 'content', 'status', 'priority', 'category', 'teamId', 'assignedToId', 'assigneeIds', 'requesterId', 'secondaryRequesterId', 'requesterIds', 'sourceName', 'sourceEmail', 'type', 'urgency', 'impact', 'source', 'externalId', 'dueDate', 'assetIds', 'observerIds', 'approvalStatus', 'isMajorIncident', 'impactedSites', 'closeSuggested', 'locationId'];
  const { title, content, status, priority, category, teamId, assignedToId, assigneeIds, requesterId, secondaryRequesterId, requesterIds, sourceName, sourceEmail, type, urgency, impact, source, externalId, dueDate, assetIds, locationId } = req.body;

  // Rejecter les champs non autorisés
  for (const key of Object.keys(req.body)) {
    if (!allowed.includes(key)) {
      return res.status(400).json({ error: `Champ non autorisé : ${key}` });
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
    const ids = Array.isArray(assigneeIds) ? assigneeIds.map((a) => Number(a)) : [];
    data.assignees = { set: ids.map((id) => ({ id })) };
    if (assignedToId === undefined) {
      data.assignedToId = ids.length > 0 ? ids[0] : null;
    } else {
      data.assignedToId = assignedToId ? Number(assignedToId) : null;
    }
  } else if (assignedToId !== undefined) {
    const singleId = assignedToId ? Number(assignedToId) : null;
    data.assignedToId = singleId;
    if (singleId) {
      data.assignees = { set: [{ id: singleId }] };
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
      ? req.body.observerIds.map(Number)
      : [];
    data.observers = { set: ids.map((id) => ({ id })) };
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
        sourceEmail: true, requesterId: true, sourceName: true,
        observers: { select: { id: true } },
      },
    });

    const ticket = await prisma.ticket.update({ where: { id }, data });

    // Recalculer les échéances SLA si la priorité change (et ticket toujours actif)
    if (data.priority !== undefined) {
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
// Droit requis : tickets.assign — réservé aux ADMIN/SUPERADMIN/HOTLINE via les groupes de droits.
router.post('/:id/escalate', forbidTechnicianTicketEdits, requirePermission('tickets.assign', ['ADMIN', 'HOTLINE']), async (req, res) => {
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

const followupUpload = multer({
  dest: FOLLOWUP_IMAGES_DIR,
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Add followup / comment (supporte le collage d'images via FormData)
router.post('/:id/followups', followupUpload.array('images', 10), [body('content').notEmpty()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const ticketId = Number(req.params.id);

  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket introuvable' });
  }

  // Un demandeur/technicien ne commente que ses propres tickets ou ceux qu'il observe
  if (isRequesterOnly(req.user) && ticket.requesterId !== req.user.sub) {
    const isObserver = await prisma.ticket.findFirst({
      where: { id: ticketId, observers: { some: { id: req.user.sub } } },
      select: { id: true },
    });
    if (!isObserver) return res.status(404).json({ error: 'Ticket introuvable' });
  }
  if (isTechnicianOnly(req.user)) {
    if (['SOLVED', 'CLOSED'].includes(ticket.status)) {
      return res.status(403).json({ error: 'Un technicien ne peut pas ajouter de suivi sur un ticket résolu ou fermé.' });
    }
    // Un technicien ne peut commenter QUE les tickets qui lui sont assignés (direct ou multi-assignees)
    // Les tickets d'équipe non assignés sont visibles en lecture seule — pas de commentaire autorisé
    const isAssigned = ticket.assignedToId === req.user.sub;
    const isMultiAssigned = !isAssigned && await prisma.ticket.findFirst({
      where: { id: ticketId, assignees: { some: { id: req.user.sub } } },
      select: { id: true },
    });
    if (!isAssigned && !isMultiAssigned) {
      return res.status(403).json({ error: 'Vous ne pouvez ajouter un suivi que sur les tickets qui vous sont assignés.' });
    }
  }

  // Sauvegarder les images uploadées et créer des TicketAttachment
  const imageAttachments = [];
  if (req.files && req.files.length > 0) {
    for (const file of req.files) {
      // Valider chaque fichier uploadé
      const fileValidation = validateUpload(file.originalname, file.mimetype, 'followup');
      if (!fileValidation.valid) {
        // Supprimer les fichiers déjà traités et rejeter
        for (const f of req.files) { try { fs.unlinkSync(f.path); } catch {} }
        return res.status(400).json({ error: fileValidation.error });
      }
      const ext = path.extname(file.originalname) || '.png';
      const safeFilename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      const destPath = path.join(FOLLOWUP_IMAGES_DIR, safeFilename);
      try {
        fs.renameSync(file.path, destPath);
      } catch {
        // Si rename échoue (ex:跨设备), fallback sur copie + suppression
        fs.copyFileSync(file.path, destPath);
        fs.unlinkSync(file.path);
      }

      const localFilepath = path.join('uploads', 'followup-images', safeFilename);
      const attachment = await prisma.ticketAttachment.create({
        data: {
          ticketId,
          filename: file.originalname || safeFilename,
          mimeType: file.mimetype || 'image/png',
          localFilepath,
        },
      });

      imageAttachments.push({
        id: attachment.id,
        filename: safeFilename,
        url: `/uploads/followup-images/${safeFilename}`,
      });
    }
  }

  // Construire le contenu final : remplacer les marqueurs IMAGE_<n> par des <img> tags
  // On utilise toujours un chemin relatif (/uploads/...) pour que les images s'affichent
  // correctement quel que soit le domaine, l'IP (ex: Dokploy) ou le port d'accès.
  let content = req.body.content || '';
  imageAttachments.forEach((img, idx) => {
    const markerRegex = new RegExp(`<!--IMAGE_${idx}-->?`, 'gi');
    content = content.replace(markerRegex, `<img src="${img.url}" alt="image collée" />`);
  });
  content = content.replace(/<!--IMAGE_\d+-->?/gi, '');
  // Sanitizer le HTML pour prévenir les XSS stockés
  content = sanitizeTicketHtml(content);

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
  }  return res.status(201).json({ followup, imageAttachments });
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
    await logEvent(ticketId, isPrivate ? 'FOLLOWUP_MADE_PRIVATE' : 'FOLLOWUP_MADE_PUBLIC', req.user.sub, { followupId });
  } catch (err) {
    console.error('[ticket.routes] Log visibilité commentaire échoué:', err.message);
  }

  return res.json({ followup: updated });
});

// Modifier le contenu d'un commentaire
router.patch('/:id/followups/:followupId', requirePermission('tickets.assign', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const ticketId = Number(req.params.id);
  const followupId = Number(req.params.followupId);
  const { content } = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Le contenu ne peut pas être vide' });
  }

  if (isTechnicianOnly(req.user)) {
    const parentTicket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true } });
    if (parentTicket && ['SOLVED', 'CLOSED'].includes(parentTicket.status)) {
      return res.status(403).json({ error: 'Un technicien ne peut pas modifier un suivi sur un ticket résolu ou fermé.' });
    }
  }

  const followup = await prisma.followup.findFirst({
    where: { id: followupId, ticketId },
    include: { author: { select: { id: true, fullName: true, avatarUrl: true } } },
  });
  if (!followup) return res.status(404).json({ error: 'Commentaire introuvable' });

  if (followup.source === 'glpi') {
    return res.status(403).json({ error: 'Impossible de modifier un commentaire synchronisé depuis GLPI' });
  }

  const isAdmin = ['ADMIN', 'SUPERADMIN'].includes(req.user.role);
  if (!isAdmin && followup.authorId !== req.user.sub) {
    return res.status(403).json({ error: 'Vous ne pouvez modifier que vos propres commentaires' });
  }

  const sanitized = sanitizeTicketHtml(content.trim());
  const updated = await prisma.followup.update({
    where: { id: followupId },
    data: { content: sanitized, updatedAt: new Date() },
    include: { author: { select: { id: true, fullName: true, avatarUrl: true } } },
  });

  try {
    await logEvent(ticketId, 'FOLLOWUP_EDITED', req.user.sub, { followupId });
  } catch (err) {
    console.error('[ticket.routes] Log édition commentaire échoué:', err.message);
  }

  return res.json({ followup: updated });
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

  try {
    await logEvent(ticketId, 'FOLLOWUP_DELETED', req.user.sub, { followupId });
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

module.exports = router;
