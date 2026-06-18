const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate, authorize } = require('../middleware/auth');
const { getGlpiConfig, glpiInitSession, glpiKillSession } = require('../utils/glpiSync');
const { notifyMajorIncidentResolved } = require('../services/emailSender');

const router = express.Router();
router.use(authenticate);

// List tickets (with optional filters)
router.get('/', async (req, res) => {
  const { status, priority, teamId, assignedToId, mine } = req.query;

  const where = {};
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (teamId) where.teamId = Number(teamId);
  if (assignedToId) where.assignedToId = Number(assignedToId);

  if (mine === 'true') {
    if (req.user.role === 'REQUESTER') {
      where.requesterId = req.user.sub;
    } else {
      where.assignedToId = req.user.sub;
    }
  }

  if (req.query.approvalStatus) where.approvalStatus = req.query.approvalStatus;

  const tickets = await prisma.ticket.findMany({
    where,
    include: {
      requester: { select: { id: true, fullName: true, email: true } },
      assignedTo: { select: { id: true, fullName: true, email: true } },
      team: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, fullName: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return res.json(tickets);
});

// Get single ticket with followups
router.get('/:id', async (req, res) => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      requester: { select: { id: true, fullName: true, email: true } },
      assignedTo: { select: { id: true, fullName: true, email: true } },
      team: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, fullName: true, email: true } },
      followups: { include: { author: { select: { id: true, fullName: true } } }, orderBy: { createdAt: 'asc' } },
      attachments: true,
      aiSuggestions: { orderBy: { createdAt: 'desc' } },
    },
  });

  if (!ticket) {
    return res.status(404).json({ error: 'Ticket introuvable' });
  }

  return res.json(ticket);
});

// Télécharge le contenu d'une pièce jointe via le proxy GLPI
router.get('/:id/attachments/:attachmentId/file', async (req, res) => {
  const attachment = await prisma.ticketAttachment.findFirst({
    where: { id: Number(req.params.attachmentId), ticketId: Number(req.params.id) },
  });
  if (!attachment) return res.status(404).json({ error: 'Pièce jointe introuvable' });

  const config = await getGlpiConfig();
  if (!config) return res.status(422).json({ error: 'GLPI non configuré' });

  const sessionToken = await glpiInitSession(config);
  try {
    const fileRes = await fetch(
      `${config.baseUrl}/Document/${attachment.glpiDocumentId}?alt=media`,
      { headers: { 'App-Token': config.appToken, 'Session-Token': sessionToken } }
    );
    if (!fileRes.ok) return res.status(502).json({ error: 'Téléchargement GLPI échoué' });

    res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${attachment.filename}"`);
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    return res.send(buffer);
  } finally {
    await glpiKillSession(config, sessionToken);
  }
});

// Create ticket
router.post(
  '/',
  [body('title').notEmpty(), body('content').notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { title, content, priority, category, teamId, assignedToId, requiresApproval } = req.body;

    const ticket = await prisma.ticket.create({
      data: {
        title,
        content,
        priority: priority || 'P3',
        category: category || null,
        teamId: teamId || null,
        assignedToId: assignedToId || null,
        requesterId: req.user.sub,
        status: 'NEW',
        approvalStatus: requiresApproval ? 'PENDING' : 'NOT_REQUIRED',
      },
    });

    return res.status(201).json(ticket);
  }
);

// Update ticket (status, priority, assignment, etc.)
router.patch('/:id', authorize('ADMIN', 'TECHNICIAN'), async (req, res) => {
  const id = Number(req.params.id);
  const { title, content, status, priority, category, teamId, assignedToId } = req.body;

  const data = {};
  if (title !== undefined) data.title = title;
  if (content !== undefined) data.content = content;
  if (priority !== undefined) data.priority = priority;
  if (category !== undefined) data.category = category;
  if (teamId !== undefined) data.teamId = teamId;
  if (assignedToId !== undefined) data.assignedToId = assignedToId;

  if (status !== undefined) {
    data.status = status;
    if (status === 'SOLVED') data.solvedAt = new Date();
    if (status === 'CLOSED') data.closedAt = new Date();
  }

  if (req.body.approvalStatus !== undefined) {
    data.approvalStatus = req.body.approvalStatus;
    if (req.body.approvalStatus === 'PENDING') {
      data.approvedById = null;
      data.approvedAt = null;
      data.approvalNote = null;
    }
  }

  try {
    const before = await prisma.ticket.findUnique({
      where: { id },
      select: { status: true, isMajorIncident: true, impactedSites: true, glpiTicketId: true, title: true },
    });

    const ticket = await prisma.ticket.update({ where: { id }, data });

    // Notifier tous les sites impactés si un incident majeur vient d'être résolu/clôturé
    const isNowResolved = (status === 'SOLVED' || status === 'CLOSED');
    const wasOpen = before && !['SOLVED', 'CLOSED'].includes(before.status);
    if (isNowResolved && wasOpen && before?.isMajorIncident && before.impactedSites?.length > 0) {
      notifyMajorIncidentResolved({
        ticketId: id,
        glpiTicketId: before.glpiTicketId,
        ticketTitle: before.title,
        impactedSites: before.impactedSites,
      }).catch(() => {});
    }

    return res.json(ticket);
  } catch (err) {
    return res.status(404).json({ error: 'Ticket introuvable' });
  }
});

// Approve a ticket
router.post('/:id/approve', authorize('ADMIN', 'TECHNICIAN'), async (req, res) => {
  const id = Number(req.params.id);
  try {
    const ticket = await prisma.ticket.update({
      where: { id },
      data: {
        approvalStatus: 'APPROVED',
        approvedById: req.user.sub,
        approvedAt: new Date(),
        approvalNote: req.body.note || null,
      },
    });
    return res.json(ticket);
  } catch (err) {
    return res.status(404).json({ error: 'Ticket introuvable' });
  }
});

// Reject a ticket
router.post('/:id/reject', authorize('ADMIN', 'TECHNICIAN'), async (req, res) => {
  const id = Number(req.params.id);
  try {
    const ticket = await prisma.ticket.update({
      where: { id },
      data: {
        approvalStatus: 'REJECTED',
        approvedById: req.user.sub,
        approvedAt: new Date(),
        approvalNote: req.body.note || null,
      },
    });
    return res.json(ticket);
  } catch (err) {
    return res.status(404).json({ error: 'Ticket introuvable' });
  }
});

// Add followup / comment
router.post('/:id/followups', [body('content').notEmpty()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const ticketId = Number(req.params.id);

  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket introuvable' });
  }

  const followup = await prisma.followup.create({
    data: {
      ticketId,
      authorId: req.user.sub,
      content: req.body.content,
    },
  });

  return res.status(201).json(followup);
});

// Delete ticket
router.delete('/:id', authorize('ADMIN'), async (req, res) => {
  try {
    await prisma.ticket.delete({ where: { id: Number(req.params.id) } });
    return res.status(204).send();
  } catch (err) {
    return res.status(404).json({ error: 'Ticket introuvable' });
  }
});

module.exports = router;
