const express = require('express');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    // Le journal d'audit est réservé au staff : un demandeur n'a pas à voir les actions de tous
    if (!['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const {
      type,
      category,
      ticketId,
      actor,
      search,
      startDate,
      endDate,
      order,
      page = '1',
      pageSize = '50',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const size = Math.min(Math.max(1, parseInt(pageSize) || 50), 200);
    const skip = (pageNum - 1) * size;

    const where = {};

    // Regroupements métier — permet de filtrer par famille d'événements
    const EVENT_CATEGORIES = {
      TICKETS: ['CREATED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'ASSIGNED', 'FOLLOWUP_ADDED', 'REOPENED', 'CLOSED_AUTO', 'SPLIT_NEW_ISSUE', 'CREATED_FROM_SPLIT', 'CLOSURE_SUGGESTED', 'CLOSURE_NOT_SUGGESTED', 'CLOSURE_VALIDATED', 'CLOSURE_REJECTED', 'APPROVED', 'REJECTED', 'DUE_DATE_BREACHED', 'DUE_DATE_UPDATED', 'DELETED', 'RESTORED', 'MERGED_INTO', 'MERGED_FROM', 'LINKED', 'UNLINKED', 'NEEDS_HUMAN_REVIEW'],
      EMAILS: ['EMAIL_RECEIVED', 'EMAIL_SENT'],
      IA: ['AI_ANALYZED', 'AI_DRAFT_GENERATED', 'AI_FOLLOWUP_DRAFT_GENERATED', 'AI_CONVERSATION_ESCALATED', 'AI_AUTO_REPLY_IGNORED', 'AI_LOW_CONFIDENCE_CLOSE_SKIPPED', 'AI_LOW_CONFIDENCE_REOPEN_SKIPPED', 'AI_LIFETIME_EXCEEDED', 'AI_SPLIT_LIMIT_REACHED', 'AI_LOW_TRUST_SENDER'],
      RELANCES: ['REMINDER_SENT', 'ESCALATED', 'ESCALATION_REQUESTED', 'SLA_BREACHED', 'SLA_UPDATED'],
      GLPI: ['GLPI_SYNC_FAILED'],
      CONNAISSANCES: ['KNOWLEDGE_CREATED'],
    };

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
      where.OR = [
        { ticket: ticketFilter },
        { actor: { contains: search, mode: 'insensitive' } },
      ];
    }

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
