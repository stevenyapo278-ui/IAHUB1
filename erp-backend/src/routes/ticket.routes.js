const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { getGlpiConfig, glpiInitSession, glpiKillSession } = require('../utils/glpiSync');
const { notifyMajorIncidentResolved } = require('../services/emailSender');
const { createGlpiTicket, updateGlpiTicket, deleteGlpiTicket, uploadGlpiAttachment, addGlpiFollowup } = require('../services/glpiTicketCreator');
const multer = require('multer');

const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } }); // 20 Mo max
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

  // source=glpi -> uniquement les tickets synchronisés avec GLPI
  // source=erp  -> uniquement les tickets internes (jamais envoyés à GLPI)
  if (req.query.source === 'glpi') where.glpiTicketId = { not: null };
  if (req.query.source === 'erp') where.glpiTicketId = null;

  const tickets = await prisma.ticket.findMany({
    where,
    include: {
      requester: { select: { id: true, fullName: true, email: true } },
      assignedTo: { select: { id: true, fullName: true, email: true } },
      observers: { select: { id: true, fullName: true, email: true } },
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
      observers: { select: { id: true, fullName: true, email: true } },
      team: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, fullName: true, email: true } },
      followups: { include: { author: { select: { id: true, fullName: true } } }, orderBy: { createdAt: 'asc' } },
      messages: { orderBy: { timestamp: 'asc' } },
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
  upload.single('attachment'),
  [body('title').notEmpty(), body('content').notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      title, content, priority, category, teamId, assignedToId, requesterId, requiresApproval,
      type, urgency, impact, source, externalId, status, openedAt,
    } = req.body;

    // observerIds peut arriver en JSON (multipart) ou en tableau (JSON direct)
    let observerIds = [];
    if (req.body.observerIds) {
      try {
        observerIds = Array.isArray(req.body.observerIds) ? req.body.observerIds : JSON.parse(req.body.observerIds);
      } catch {
        observerIds = [];
      }
    }

    // Seul un ADMIN/TECHNICIAN peut créer un ticket pour un autre demandeur
    const canSetRequester = ['ADMIN', 'TECHNICIAN'].includes(req.user.role);
    const finalRequesterId = canSetRequester && requesterId ? Number(requesterId) : req.user.sub;

    let glpiTicketId = null;
    try {
      glpiTicketId = await createGlpiTicket({ title, content, priority, category, type, urgency, impact, source });
    } catch (err) {
      console.error('[ticket.routes] Création GLPI échouée:', err.message);
    }

    // Seul un ADMIN/TECHNICIAN peut fixer le statut initial (ex: importer un ticket déjà résolu)
    const canSetStatus = ['ADMIN', 'TECHNICIAN'].includes(req.user.role);
    const finalStatus = canSetStatus && status ? status : 'NEW';

    const ticket = await prisma.ticket.create({
      data: {
        ...(glpiTicketId ? { glpiTicketId } : {}),
        title,
        content,
        priority: priority || 'P3',
        category: category || null,
        teamId: teamId ? Number(teamId) : null,
        assignedToId: assignedToId ? Number(assignedToId) : null,
        requesterId: finalRequesterId,
        status: finalStatus,
        ...(finalStatus === 'SOLVED' ? { solvedAt: new Date() } : {}),
        ...(finalStatus === 'CLOSED' ? { closedAt: new Date() } : {}),
        ...(openedAt ? { createdAt: new Date(openedAt) } : {}),
        approvalStatus: requiresApproval === 'true' || requiresApproval === true ? 'PENDING' : 'NOT_REQUIRED',
        type: type || 'INCIDENT',
        urgency: urgency || 'MEDIUM',
        impact: impact || 'MEDIUM',
        source: source || null,
        externalId: externalId || null,
        ...(observerIds.length > 0 ? { observers: { connect: observerIds.map((id) => ({ id: Number(id) })) } } : {}),
      },
    });

    // Si aucun technicien n'a été choisi explicitement à la création, assigne automatiquement
    // le moins chargé de l'équipe correspondant à la catégorie — best-effort, ticket non assigné
    // si la catégorie ne correspond à aucune équipe connue.
    if (!ticket.assignedToId && ticket.category) {
      try {
        const { autoAssignTechnician } = require('../services/ticketAutoAssign');
        const assigned = await autoAssignTechnician(ticket.id, ticket.category);
        if (assigned && glpiTicketId) {
          await updateGlpiTicket(glpiTicketId, { assignedToGlpiId: assigned.glpiId });
        }
      } catch (err) {
        console.error('[ticket.routes] Auto-assignation échouée:', err.message);
      }
    }

    if (req.file && glpiTicketId) {
      try {
        const documentId = await uploadGlpiAttachment({
          glpiTicketId,
          buffer: req.file.buffer,
          filename: req.file.originalname,
          mimeType: req.file.mimetype,
        });
        if (documentId) {
          await prisma.ticketAttachment.create({
            data: {
              ticketId: ticket.id,
              glpiDocumentId: documentId,
              filename: req.file.originalname,
              mimeType: req.file.mimetype,
            },
          });
        }
      } catch (err) {
        console.error('[ticket.routes] Upload pièce jointe GLPI échoué:', err.message);
      }
    }

    const finalTicket = await prisma.ticket.findUnique({ where: { id: ticket.id } });
    return res.status(201).json(finalTicket);
  }
);

// Update ticket (status, priority, assignment, etc.)
router.patch('/:id', requirePermission('tickets.assign', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const id = Number(req.params.id);
  const { title, content, status, priority, category, teamId, assignedToId, type, urgency, impact, source, externalId } = req.body;

  const data = {};
  if (title !== undefined) data.title = title;
  if (content !== undefined) data.content = content;
  if (priority !== undefined) data.priority = priority;
  if (category !== undefined) data.category = category;
  if (teamId !== undefined) data.teamId = teamId;
  if (assignedToId !== undefined) data.assignedToId = assignedToId;
  if (type !== undefined) data.type = type;
  if (urgency !== undefined) data.urgency = urgency;
  if (impact !== undefined) data.impact = impact;
  if (source !== undefined) data.source = source;
  if (externalId !== undefined) data.externalId = externalId;

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

    // Répercuter les changements vers GLPI si le ticket y est synchronisé
    if (before?.glpiTicketId) {
      try {
        let assignedToGlpiId, teamGlpiId;
        if (assignedToId !== undefined && assignedToId) {
          const assignee = await prisma.user.findUnique({ where: { id: Number(assignedToId) }, select: { glpiId: true } });
          assignedToGlpiId = assignee?.glpiId || undefined;
        }
        if (teamId !== undefined && teamId) {
          const team = await prisma.team.findUnique({ where: { id: Number(teamId) }, select: { glpiGroupId: true } });
          teamGlpiId = team?.glpiGroupId || undefined;
        }
        await updateGlpiTicket(before.glpiTicketId, { status, priority, category, type, urgency, impact, assignedToGlpiId, teamGlpiId });
      } catch (err) {
        console.error('[ticket.routes] Mise à jour GLPI échouée:', err.message);
      }
    }

    // Notifier tous les sites impactés si un incident majeur vient d'être résolu/clôturé
    const isNowResolved = (status === 'SOLVED' || status === 'CLOSED');
    const wasOpen = before && !['SOLVED', 'CLOSED'].includes(before.status);
    if (isNowResolved && wasOpen && before?.isMajorIncident && before.impactedSites?.length > 0) {
      notifyMajorIncidentResolved({
        ticketId: id,
        glpiTicketId: before.glpiTicketId,
        ticketTitle: before.title,
        impactedSites: before.impactedSites,
      }).catch((err) => {
        console.error(`[ticket.routes] Échec notification résolution incident majeur (ticket ${id}):`, err.message);
      });
    }

    return res.json(ticket);
  } catch (err) {
    return res.status(404).json({ error: 'Ticket introuvable' });
  }
});

// Approve a ticket
router.post('/:id/approve', requirePermission('tickets.approve', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
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
router.post('/:id/reject', requirePermission('tickets.approve', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
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
    include: { author: { select: { id: true, fullName: true } } },
  });

  // Toute action humaine sur le ticket doit se répercuter dans GLPI, pas seulement les emails.
  if (ticket.glpiTicketId) {
    try {
      await addGlpiFollowup(ticket.glpiTicketId, `${followup.author.fullName} :\n\n${req.body.content}`);
    } catch (err) {
      console.error('[ticket.routes] Échec ajout followup GLPI:', err.message);
    }
  }

  return res.status(201).json(followup);
});

// Delete ticket
router.delete('/:id', requirePermission('tickets.delete', ['ADMIN']), async (req, res) => {
  const id = Number(req.params.id);
  try {
    const ticket = await prisma.ticket.findUnique({ where: { id }, select: { glpiTicketId: true } });
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

    if (ticket.glpiTicketId) {
      try {
        await deleteGlpiTicket(ticket.glpiTicketId);
      } catch (err) {
        console.error('[ticket.routes] Suppression GLPI échouée:', err.message);
      }
    }

    await prisma.ticket.delete({ where: { id } });
    return res.status(204).send();
  } catch (err) {
    return res.status(404).json({ error: 'Ticket introuvable' });
  }
});

// Delete tickets in bulk — body: { ids: [1, 2, 3] }
router.post('/bulk-delete', requirePermission('tickets.bulkDelete', ['ADMIN']), [body('ids').isArray({ min: 1 })], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const ids = req.body.ids.map(Number).filter((n) => !Number.isNaN(n));
  if (ids.length === 0) return res.status(400).json({ error: 'Aucun identifiant valide fourni' });

  const ticketsToDelete = await prisma.ticket.findMany({
    where: { id: { in: ids } },
    select: { glpiTicketId: true },
  });

  await Promise.all(
    ticketsToDelete
      .filter((t) => t.glpiTicketId)
      .map((t) => deleteGlpiTicket(t.glpiTicketId).catch((err) => {
        console.error('[ticket.routes] Suppression GLPI échouée:', err.message);
      }))
  );

  const result = await prisma.ticket.deleteMany({ where: { id: { in: ids } } });
  return res.json({ deleted: result.count });
});

module.exports = router;
