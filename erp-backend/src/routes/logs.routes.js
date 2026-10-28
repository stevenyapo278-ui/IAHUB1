const express = require('express');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { sendLogExport } = require('../services/logReportService');

const router = express.Router();
router.use(authenticate);

// Le journal d'activité est réservé au staff : un demandeur n'a pas à voir les actions de tous
function requireStaff(req, res) {
  if (!['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN'].includes(req.user?.role)) {
    res.status(403).json({ error: 'Accès refusé' });
    return false;
  }
  return true;
}

// Regroupements métier — permet de filtrer par famille d'événements
const EVENT_CATEGORIES = {
  TICKETS: ['CREATED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'ASSIGNED', 'FOLLOWUP_ADDED', 'FOLLOWUP_EDITED', 'FOLLOWUP_DELETED', 'REOPENED', 'CLOSED_AUTO', 'SPLIT_NEW_ISSUE', 'CREATED_FROM_SPLIT', 'CLOSURE_SUGGESTED', 'CLOSURE_NOT_SUGGESTED', 'CLOSURE_VALIDATED', 'CLOSURE_REJECTED', 'APPROVED', 'REJECTED', 'DUE_DATE_BREACHED', 'DUE_DATE_UPDATED', 'DELETED', 'RESTORED', 'MERGED_INTO', 'MERGED_FROM', 'LINKED', 'UNLINKED', 'NEEDS_HUMAN_REVIEW', 'REPLY_ON_CLOSED_SUGGESTED', 'REPLY_ON_CLOSED_REOPENED', 'REPLY_ON_CLOSED_NEW_TICKET', 'REPLY_ON_CLOSED_DISMISSED', 'NEW_TICKET_SUGGESTED', 'NEW_TICKET_SUGGESTED_CREATED', 'NEW_TICKET_SUGGESTED_DISMISSED', 'TICKET_UPDATED', 'TEAM_CHANGED', 'FOLLOWUP_MADE_PRIVATE', 'FOLLOWUP_MADE_PUBLIC', 'MAJOR_INCIDENT_PROMOTED', 'EMAIL_LOOP_SKIPPED', 'RESOLUTION_CONFIRMED_ON_CLOSED', 'DUPLICATE_MERGED', 'GLPI_LINKED', 'GLPI_UNLINKED', 'SLA_RECOMPUTED'],
  EMAILS: ['EMAIL_RECEIVED', 'EMAIL_SENT'],
  IA: ['AI_ANALYZED', 'AI_DRAFT_GENERATED', 'AI_FOLLOWUP_DRAFT_GENERATED', 'AI_CONVERSATION_ESCALATED', 'AI_AUTO_REPLY_IGNORED', 'AI_LOW_CONFIDENCE_CLOSE_SKIPPED', 'AI_LOW_CONFIDENCE_REOPEN_SKIPPED', 'AI_LIFETIME_EXCEEDED', 'AI_SPLIT_LIMIT_REACHED', 'AI_LOW_TRUST_SENDER'],
  RELANCES: ['REMINDER_SENT', 'ESCALATED', 'ESCALATION_REQUESTED', 'SLA_BREACHED', 'SLA_UPDATED'],
  GLPI: ['GLPI_SYNC_FAILED'],
  CONNAISSANCES: ['KNOWLEDGE_CREATED'],
};

// Construction du where — partagée par la liste (GET /) et l'export (GET /export)
// pour que l'extraction reflète EXACTEMENT les filtres affichés à l'écran.
function buildLogsWhere(query = {}) {
  const { type, category, ticketId, actor, search, startDate, endDate } = query;
  const where = {};

  if (type) {
    where.type = type;
  } else if (category && EVENT_CATEGORIES[category]) {
    where.type = { in: EVENT_CATEGORIES[category] };
  }

  // Filtrer par numéro de ticket exact
  if (ticketId && !Number.isNaN(parseInt(ticketId, 10))) {
    where.ticketId = parseInt(ticketId, 10);
  }

  if (actor) {
    where.actor = { contains: actor, mode: 'insensitive' };
  }

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }

  if (search) {
    // Recherche globale : titre/id du ticket OU acteur de l'événement
    const ticketFilter = {
      OR: [
        { id: parseInt(search) ? parseInt(search) : undefined },
        { title: { contains: search, mode: 'insensitive' } },
      ].filter(Boolean),
    };
    // Le type est un enum — on ne peut pas utiliser contains.
    // On cherche parmi les valeurs d'enum celles qui matchent le terme de recherche.
    const ALL_TYPES = Object.values(require('@prisma/client').TicketEventType || {});
    const matchingTypes = ALL_TYPES.filter(t => t.toUpperCase().includes(search.toUpperCase()));
    const typeFilter = matchingTypes.length > 0 ? { type: { in: matchingTypes } } : {};
    where.OR = [
      { ticket: ticketFilter },
      { actor: { contains: search, mode: 'insensitive' } },
      typeFilter,
    ].filter(f => Object.keys(f).length > 0);
  }

  return where;
}

// Acteurs distincts (les plus fréquents en premier) → liste déroulante du filtre « Acteur »
router.get('/actors', async (req, res) => {
  if (!requireStaff(req, res)) return;
  try {
    const grouped = await prisma.ticketEvent.groupBy({
      by: ['actor'],
      _count: { _all: true },
      orderBy: { _count: { actor: 'desc' } },
      take: 200,
    });
    res.json({
      actors: grouped
        .filter((g) => g.actor)
        .map((g) => ({ actor: g.actor, count: g._count?._all ?? 0 })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export CSV/XLSX des événements — mêmes filtres que la liste affichée
router.get('/export', async (req, res) => {
  if (!requireStaff(req, res)) return;
  try {
    const where = buildLogsWhere(req.query);
    const events = await prisma.ticketEvent.findMany({
      where,
      orderBy: { createdAt: req.query.order === 'asc' ? 'asc' : 'desc' },
      take: 10000,
      include: { ticket: { select: { id: true, title: true } } },
    });
    await sendLogExport(res, {
      format: req.query.format,
      filenamePrefix: 'journal_activite',
      data: events,
      kind: 'events',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    if (!requireStaff(req, res)) return;

    const {
      order,
      page = '1',
      pageSize = '50',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const size = Math.min(Math.max(1, parseInt(pageSize) || 50), 200);
    const skip = (pageNum - 1) * size;

    const where = buildLogsWhere(req.query);

    const [events, total] = await Promise.all([
      prisma.ticketEvent.findMany({
        where,
        orderBy: { createdAt: order === 'asc' ? 'asc' : 'desc' },
        skip,
        take: size,
        include: {
          ticket: { select: { id: true, title: true } },
        },
      }),
      prisma.ticketEvent.count({ where }),
    ]);

    res.json({
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        actor: e.actor,
        payload: e.payload,
        createdAt: e.createdAt,
        ticketId: e.ticket?.id || null,
        ticketTitle: e.ticket?.title || null,
      })),
      pagination: {
        page: pageNum,
        pageSize: size,
        total,
        totalPages: Math.ceil(total / size),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
