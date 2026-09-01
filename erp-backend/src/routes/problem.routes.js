const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { auditLog } = require('../services/auditLogService');

const router = express.Router();
router.use(authenticate);

// ── Liste des problèmes ───────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { status, priority, category, assignedToId, teamId, search, limit, page } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(limit) || 50));
  const skip = (pageNum - 1) * pageSize;

  const where = {};
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (category) where.category = category;
  if (assignedToId) where.assignedToId = Number(assignedToId);
  if (teamId) where.teamId = Number(teamId);
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [problems, total] = await Promise.all([
    prisma.problem.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      include: {
        requester: { select: { id: true, fullName: true, email: true } },
        assignedTo: { select: { id: true, fullName: true, email: true } },
        team: { select: { id: true, name: true } },
        _count: { select: { tickets: true, followups: true } },
      },
    }),
    prisma.problem.count({ where }),
  ]);

  res.json({ problems, total, page: pageNum, pageSize });
});

// ── Stats rapides pour le dashboard ───────────────────────────────────
router.get('/stats', async (req, res) => {
  const [total, open, solved, closed] = await Promise.all([
    prisma.problem.count(),
    prisma.problem.count({ where: { status: { in: ['NEW', 'IN_PROGRESS', 'ASSIGNED', 'PLANNED', 'WAITING'] } } }),
    prisma.problem.count({ where: { status: 'SOLVED' } }),
    prisma.problem.count({ where: { status: 'CLOSED' } }),
  ]);
  res.json({ total, open, solved, closed });
});

// ── Créer un problème ─────────────────────────────────────────────────
router.post(
  '/',
  requirePermission('tickets.manage', ['ADMIN', 'HOTLINE', 'TECHNICIAN']),
  [body('title').notEmpty().trim(), body('description').notEmpty().trim()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { title, description, priority, urgency, impact, category, glpiLocationId, glpiLocationName, dueDate, requesterId, assignedToId, teamId } = req.body;

    const problem = await prisma.problem.create({
      data: {
        title,
        description,
        priority: priority || 'P3',
        urgency: urgency || 'MEDIUM',
        impact: impact || 'MEDIUM',
        category: category || null,
        glpiLocationId: glpiLocationId || null,
        glpiLocationName: glpiLocationName || null,
        dueDate: dueDate ? new Date(dueDate) : null,
        requesterId: requesterId || null,
        assignedToId: assignedToId || null,
        teamId: teamId || null,
      },
      include: {
        requester: { select: { id: true, fullName: true, email: true } },
        assignedTo: { select: { id: true, fullName: true, email: true } },
        team: { select: { id: true, name: true } },
      },
    });

    // Événement de création
    await prisma.problemEvent.create({
      data: { problemId: problem.id, type: 'CREATED', actor: req.user.email || 'SYSTEM', payload: { title } },
    });

    res.status(201).json(problem);
    auditLog('PROBLEM_CREATED', { actor: req.user, targetType: 'Problem', targetId: problem.id, targetLabel: title }).catch(() => {});
  }
);

// ── Détail d'un problème ──────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const problem = await prisma.problem.findUnique({
    where: { id },
    include: {
      requester: { select: { id: true, fullName: true, email: true } },
      assignedTo: { select: { id: true, fullName: true, email: true } },
      team: { select: { id: true, name: true } },
      tickets: {
        include: {
          ticket: {
            select: { id: true, title: true, status: true, priority: true, category: true, createdAt: true, requester: { select: { id: true, fullName: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
      followups: {
        include: { author: { select: { id: true, fullName: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      },
      events: { orderBy: { createdAt: 'desc' }, take: 50 },
      observers: { select: { id: true, fullName: true, email: true } },
    },
  });

  if (!problem) return res.status(404).json({ error: 'Problème introuvable' });
  res.json(problem);
});

// ── Modifier un problème ──────────────────────────────────────────────
router.patch(
  '/:id',
  requirePermission('tickets.manage', ['ADMIN', 'HOTLINE', 'TECHNICIAN']),
  async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.problem.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Problème introuvable' });

    const allowed = ['title', 'description', 'status', 'priority', 'urgency', 'impact', 'category', 'glpiLocationId', 'glpiLocationName', 'dueDate', 'requesterId', 'assignedToId', 'teamId'];
    const data = {};
    const events = [];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        let val = req.body[key];
        if (key === 'dueDate' && val) val = new Date(val);

        // Tracker les changements importants
        if (key === 'status' && val !== existing.status) {
          events.push({ type: 'STATUS_CHANGED', payload: { from: existing.status, to: val } });
          if (val === 'SOLVED') data.solvedAt = new Date();
          if (val === 'CLOSED') data.closedAt = new Date();
        }
        if (key === 'priority' && val !== existing.priority) {
          events.push({ type: 'PRIORITY_CHANGED', payload: { from: existing.priority, to: val } });
        }
        if (key === 'assignedToId' && val !== existing.assignedToId) {
          events.push({ type: 'ASSIGNED', payload: { from: existing.assignedToId, to: val } });
        }

        data[key] = val;
      }
    }

    if (Object.keys(data).length === 0) return res.json(existing);

    const problem = await prisma.problem.update({ where: { id }, data });

    // Créer les événements
    for (const evt of events) {
      await prisma.problemEvent.create({
        data: { problemId: id, type: evt.type, actor: req.user.email || 'SYSTEM', payload: evt.payload },
      });
    }

    res.json(problem);
    auditLog('PROBLEM_UPDATED', { actor: req.user, targetType: 'Problem', targetId: id, targetLabel: existing.title, metadata: { changedFields: Object.keys(data) } }).catch(() => {});
  }
);

// ── Supprimer un problème ─────────────────────────────────────────────
router.delete(
  '/:id',
  requirePermission('tickets.manage', ['ADMIN']),
  async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.problem.findUnique({ where: { id }, include: { _count: { select: { tickets: true } } } });
    if (!existing) return res.status(404).json({ error: 'Problème introuvable' });
    if (existing._count.tickets > 0) {
      return res.status(409).json({ error: `Ce problème a ${existing._count.tickets} ticket(s) lié(s). Détachez-les avant de supprimer.` });
    }

    await prisma.problem.delete({ where: { id } });
    res.status(204).send();
    auditLog('PROBLEM_DELETED', { actor: req.user, targetType: 'Problem', targetId: id, targetLabel: existing.title }).catch(() => {});
  }
);

// ── Tickets liés à un problème ────────────────────────────────────────
router.get('/:id/tickets', async (req, res) => {
  const id = Number(req.params.id);
  const links = await prisma.problemTicket.findMany({
    where: { problemId: id },
    include: {
      ticket: {
        include: {
          requester: { select: { id: true, fullName: true, email: true } },
          assignedTo: { select: { id: true, fullName: true, email: true } },
          team: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(links.map((l) => l.ticket));
});

// ── Lier un ticket à un problème ──────────────────────────────────────
router.post(
  '/:id/link-ticket',
  requirePermission('tickets.manage', ['ADMIN', 'HOTLINE', 'TECHNICIAN']),
  [body('ticketId').isInt()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const problemId = Number(req.params.id);
    const ticketId = Number(req.body.ticketId);

    const problem = await prisma.problem.findUnique({ where: { id: problemId } });
    if (!problem) return res.status(404).json({ error: 'Problème introuvable' });

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

    const link = await prisma.problemTicket.upsert({
      where: { problemId_ticketId: { problemId, ticketId } },
      update: {},
      create: { problemId, ticketId },
    });

    await prisma.problemEvent.create({
      data: { problemId, type: 'TICKET_LINKED', actor: req.user.email || 'SYSTEM', payload: { ticketId, ticketTitle: ticket.title } },
    });

    res.status(201).json(link);
  }
);

// ── Délier un ticket d'un problème ────────────────────────────────────
router.delete(
  '/:id/unlink-ticket/:ticketId',
  requirePermission('tickets.manage', ['ADMIN', 'HOTLINE', 'TECHNICIAN']),
  async (req, res) => {
    const problemId = Number(req.params.id);
    const ticketId = Number(req.params.ticketId);

    await prisma.problemTicket.deleteMany({ where: { problemId, ticketId } });

    await prisma.problemEvent.create({
      data: { problemId, type: 'TICKET_UNLINKED', actor: req.user.email || 'SYSTEM', payload: { ticketId } },
    });

    res.status(204).send();
  }
);

// ── Followups (timeline) ──────────────────────────────────────────────
router.get('/:id/followups', async (req, res) => {
  const id = Number(req.params.id);
  const followups = await prisma.problemFollowup.findMany({
    where: { problemId: id },
    include: { author: { select: { id: true, fullName: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(followups);
});

router.post(
  '/:id/followups',
  requirePermission('tickets.manage', ['ADMIN', 'HOTLINE', 'TECHNICIAN']),
  [body('content').notEmpty().trim()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const problemId = Number(req.params.id);
    const problem = await prisma.problem.findUnique({ where: { id: problemId } });
    if (!problem) return res.status(404).json({ error: 'Problème introuvable' });

    const { content, isPrivate } = req.body;
    const followup = await prisma.problemFollowup.create({
      data: { problemId, authorId: req.user.sub, content, isPrivate: isPrivate || false },
      include: { author: { select: { id: true, fullName: true, email: true } } },
    });

    await prisma.problemEvent.create({
      data: { problemId, type: 'FOLLOWUP_ADDED', actor: req.user.email || 'SYSTEM', payload: { followupId: followup.id } },
    });

    res.status(201).json(followup);
  }
);

// ── Événements (journal) ──────────────────────────────────────────────
router.get('/:id/events', async (req, res) => {
  const id = Number(req.params.id);
  const events = await prisma.problemEvent.findMany({
    where: { problemId: id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(events);
});

// ── Problèmes liés à un ticket (pour affichage dans TicketDetail) ─────
router.get('/by-ticket/:ticketId', async (req, res) => {
  const ticketId = Number(req.params.ticketId);
  const links = await prisma.problemTicket.findMany({
    where: { ticketId },
    include: {
      problem: {
        select: {
          id: true, title: true, status: true, priority: true,
          _count: { select: { tickets: true, followups: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(links.map((l) => l.problem));
});

module.exports = router;
