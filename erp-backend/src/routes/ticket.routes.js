const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { getActiveGlpiConfig, glpiInitSession, glpiKillSession } = require('../utils/glpiSync');
const { notifyMajorIncidentResolved } = require('../services/emailSender');
const { createGlpiTicket, updateGlpiTicket, deleteGlpiTicket, uploadGlpiAttachment, addGlpiFollowup } = require('../services/glpiTicketCreator');
const { logEvent } = require('../services/ticketEvent');
const { emitTicketCreated, emitTicketUpdated, emitTicketAssigned } = require('../utils/socket');
const multer = require('multer');

const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } }); // 20 Mo max
const router = express.Router();
router.use(authenticate);

// List tickets (with optional filters + pagination)
router.get('/', async (req, res) => {
  const { status, priority, teamId, assignedToId, mine, title, search, limit, page } = req.query;
  const searchQuery = title || search || req.query.query;

  const pageNum = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(limit) || 100));
  const skip = (pageNum - 1) * pageSize;

  const where = {};
  if (status) {
    if (status === 'OPEN_GROUP') {
      where.status = { in: ['NEW', 'OPEN', 'PENDING'] };
    } else if (status === 'CLOSED_GROUP') {
      where.status = { in: ['SOLVED', 'CLOSED'] };
    } else {
      where.status = status;
    }
  }
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

  if (searchQuery) {
    const numericId = parseInt(searchQuery, 10);
    const orConditions = [
      { title: { contains: searchQuery, mode: 'insensitive' } },
      { content: { contains: searchQuery, mode: 'insensitive' } }
    ];
    if (!isNaN(numericId)) {
      orConditions.push({ id: numericId });
      orConditions.push({ glpiTicketId: numericId });
    }
    where.OR = orConditions;
  }

  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      skip,
      take: pageSize,
      include: {
        requester: { select: { id: true, fullName: true, email: true } },
        assignedTo: { select: { id: true, fullName: true, email: true } },
        observers: { select: { id: true, fullName: true, email: true } },
        team: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.ticket.count({ where }),
  ]);

  return res.json({ items: tickets, total, page: pageNum, pages: Math.ceil(total / pageSize) });
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

  const config = await getActiveGlpiConfig();
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
      type, urgency, impact, source, externalId, status, openedAt, locationId,
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
    let glpiCreationError = null;
    try {
      glpiTicketId = await createGlpiTicket({ title, content, priority, category, type, urgency, impact, source, locationId });
    } catch (err) {
      console.error('[ticket.routes] Création GLPI échouée:', err.message);
      glpiCreationError = err.message;
    }

    // Seul un ADMIN/TECHNICIAN peut fixer le statut initial (ex: importer un ticket déjà résolu)
    const canSetStatus = ['ADMIN', 'TECHNICIAN'].includes(req.user.role);
    const finalStatus = canSetStatus && status ? status : 'NEW';

    let glpiLocationName = null;
    if (locationId) {
      const loc = await prisma.glpiLocation.findUnique({ where: { glpiLocationId: Number(locationId) } });
      glpiLocationName = loc?.completename || loc?.name || null;
    }

    const ticket = await prisma.ticket.create({
      data: {
        ...(glpiTicketId ? { glpiTicketId } : {}),
        ...(locationId ? { glpiLocationId: Number(locationId), glpiLocationName } : {}),
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

    // Ticket créé côté ERP mais introuvable dans GLPI : visible dans le journal du ticket (pas
    // seulement les logs serveur), pour qu'un humain sache qu'une création manuelle est nécessaire.
    if (glpiCreationError) {
      await logEvent(ticket.id, 'GLPI_SYNC_FAILED', 'SYSTEM', { action: 'create', error: glpiCreationError });
    }

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
        await logEvent(ticket.id, 'GLPI_SYNC_FAILED', 'SYSTEM', { action: 'auto-assign', error: err.message });
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
        await logEvent(ticket.id, 'GLPI_SYNC_FAILED', 'SYSTEM', { action: 'upload-attachment', error: err.message, filename: req.file.originalname });
      }
    }

    // Émettre événement temps réel pour les notifications
    const finalTicket = await prisma.ticket.findUnique({ where: { id: ticket.id } });
    if (finalTicket) {
      emitTicketCreated(finalTicket);
      if (finalTicket.assignedToId) {
        emitTicketAssigned(finalTicket.id, finalTicket.title, finalTicket.assignedToId, finalTicket.category ? 'by_category' : 'manual');
      }
    }

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
        await logEvent(id, 'GLPI_SYNC_FAILED', 'SYSTEM', { action: 'update', error: err.message, attemptedChanges: { status, priority, category, type, urgency, impact, assignedToId, teamId } });
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

    // Émettre événement temps réel
    emitTicketUpdated(ticket, { status, priority, category, assignedToId });

    return res.json(ticket);
  } catch (err) {
    return res.status(404).json({ error: 'Ticket introuvable' });
  }
});

// ── Réassignation intelligente avec compétences ──────────────────────────
// Met à jour l'assignation, journalise dans ReassignmentLog et émet socket event.
router.patch('/:id/reassign', requirePermission('tickets.assign', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
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

    // Émettre l'événement socket
    const { emitTicketAssigned } = require('../utils/socket');
    emitTicketAssigned(id, ticket.title, Number(assignedToId), 'manual');

    // Mettre à jour GLPI si synchronisé
    if (ticket.glpiTicketId) {
      try {
        const assignee = await prisma.user.findUnique({ where: { id: Number(assignedToId) }, select: { glpiId: true } });
        if (assignee?.glpiId) {
          await updateGlpiTicket(ticket.glpiTicketId, { assignedToGlpiId: assignee.glpiId });
        }
      } catch (err) {
        console.error('[ticket.routes] Mise à jour GLPI échouée:', err.message);
        await logEvent(id, 'GLPI_SYNC_FAILED', 'SYSTEM', { action: 'reassign', error: err.message });
      }
    }

    return res.json(ticket);
  } catch (err) {
    return res.status(500).json({ error: err.message });
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
      await logEvent(ticketId, 'GLPI_SYNC_FAILED', 'SYSTEM', { action: 'followup', error: err.message });
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

    let glpiDeletionError = null;
    if (ticket.glpiTicketId) {
      try {
        await deleteGlpiTicket(ticket.glpiTicketId);
      } catch (err) {
        console.error('[ticket.routes] Suppression GLPI échouée:', err.message);
        glpiDeletionError = err.message;
      }
    }

    await prisma.ticket.delete({ where: { id } });
    // Le ticket ERP est bien supprimé même si GLPI a échoué (cohérent avec le comportement existant),
    // mais on prévient explicitement l'admin via la réponse plutôt que de le laisser croire à un
    // nettoyage complet — un ticket fantôme peut subsister côté GLPI à nettoyer manuellement.
    if (glpiDeletionError) {
      return res.status(200).json({ warning: `Ticket supprimé côté ERP, mais la suppression dans GLPI a échoué (#${ticket.glpiTicketId}) : ${glpiDeletionError}. Une suppression manuelle dans GLPI est nécessaire.` });
    }
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

  const glpiFailures = [];
  await Promise.all(
    ticketsToDelete
      .filter((t) => t.glpiTicketId)
      .map((t) => deleteGlpiTicket(t.glpiTicketId).catch((err) => {
        console.error('[ticket.routes] Suppression GLPI échouée:', err.message);
        glpiFailures.push(t.glpiTicketId);
      }))
  );

  const result = await prisma.ticket.deleteMany({ where: { id: { in: ids } } });
  // Mêmes tickets fantômes possibles qu'en suppression unitaire (voir DELETE /:id) — on les liste
  // explicitement plutôt que de les enterrer dans les logs serveur.
  return res.json({
    deleted: result.count,
    ...(glpiFailures.length > 0 ? { glpiDeletionFailedFor: glpiFailures } : {}),
  });
});

module.exports = router;
