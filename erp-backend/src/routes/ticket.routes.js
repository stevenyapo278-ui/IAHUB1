const express = require('express');
const { body, validationResult } = require('express-validator');
const path = require('path');
const fs = require('fs');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { getActiveGlpiConfig, glpiInitSession, glpiKillSession } = require('../utils/glpiSync');
const { notifyMajorIncidentResolved } = require('../services/emailSender');
const { createGlpiTicket, updateGlpiTicket, deleteGlpiTicket, addGlpiFollowup } = require('../services/glpiTicketCreator');
const { autoAssignTechnician } = require('../services/ticketAutoAssign');
const { logEvent } = require('../services/ticketEvent');
const { auditLog } = require('../services/auditLogService');
const { uploadPendingAttachments } = require('../services/emailAttachmentProcessor');
const { emitTicketCreated, emitTicketUpdated, emitTicketAssigned } = require('../utils/socket');
const multer = require('multer');

const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } }); // 20 Mo max
const router = express.Router();
router.use(authenticate);

// List tickets (with optional filters + pagination + sorting)
router.get('/', async (req, res) => {
  const {
    status, priority, teamId, assignedToId, mine, title, search, limit, page,
    sortBy, sortOrder, category, locationId, aiProcessed
  } = req.query;
  const searchQuery = title || search || req.query.query;

  const pageNum = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(limit) || 50));
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
  if (category) where.category = category;
  if (locationId) where.glpiLocationId = Number(locationId);
  if (aiProcessed === 'true') where.aiProcessed = true;

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
      { content: { contains: searchQuery, mode: 'insensitive' } },
      { category: { contains: searchQuery, mode: 'insensitive' } },
      { glpiLocationName: { contains: searchQuery, mode: 'insensitive' } },
    ];
    if (!isNaN(numericId)) {
      orConditions.push({ id: numericId });
      orConditions.push({ glpiTicketId: numericId });
    }
    where.OR = orConditions;
  }

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
  }

  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      skip,
      take: pageSize,
      include: {
        requester: { select: { id: true, fullName: true, email: true } },
        assignedTo: { select: { id: true, fullName: true, email: true } },
        team: { select: { id: true, name: true } },
      },
      orderBy,
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

    // Seul un ADMIN/TECHNICIAN peut créer un ticket pour un autre demandeur
    const canSetRequester = ['ADMIN', 'TECHNICIAN'].includes(req.user.role);
    const finalRequesterId = canSetRequester && requesterId ? Number(requesterId) : req.user.sub;

    // Seul un ADMIN/TECHNICIAN/HOTLINE peut fixer le statut initial
    const canSetStatus = ['ADMIN', 'TECHNICIAN', 'HOTLINE', 'SUPERADMIN'].includes(req.user.role);
    const finalStatus = canSetStatus && status ? status : 'NEW';

    let glpiLocationName = null;
    if (locationId) {
      const loc = await prisma.glpiLocation.findUnique({ where: { glpiLocationId: Number(locationId) } });
      glpiLocationName = loc?.completename || loc?.name || null;
    }

    const ticket = await prisma.ticket.create({
      data: {
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
        approvalStatus: 'PENDING',
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
        await autoAssignTechnician(ticket.id, ticket.category);
      } catch (err) {
        console.error('[ticket.routes] Auto-assignation échouée:', err.message);
        await logEvent(ticket.id, 'GLPI_SYNC_FAILED', 'SYSTEM', { action: 'auto-assign', error: err.message });
      }
    }

    // Sauvegarder la pièce jointe localement (l'upload GLPI sera fait à l'approbation)
    if (req.file) {
      try {
        await prisma.ticketAttachment.create({
          data: {
            ticketId: ticket.id,
            filename: req.file.originalname,
            mimeType: req.file.mimetype,
          },
        });
      } catch (err) {
        console.error('[ticket.routes] Sauvegarde pièce jointe échouée:', err.message);
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

  if (req.body.locationId !== undefined) {
    data.glpiLocationId = Number(req.body.locationId);
    if (data.glpiLocationId) {
      const loc = await prisma.glpiLocation.findUnique({ where: { glpiLocationId: data.glpiLocationId } });
      data.glpiLocationName = loc?.completename || loc?.name || null;
    } else {
      data.glpiLocationName = null;
    }
  }

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
      select: {
        title: true, content: true, priority: true, category: true, teamId: true,
        assignedToId: true, type: true, urgency: true, impact: true, source: true,
        externalId: true, status: true, isMajorIncident: true, impactedSites: true,
        glpiTicketId: true, glpiLocationId: true, sourceEmail: true,
      },
    });

    const ticket = await prisma.ticket.update({ where: { id }, data });

    // Enregistrer les corrections de champs par la Hotline/Technicien
    const trackFields = [
      'title', 'content', 'priority', 'category', 'teamId', 'assignedToId',
      'type', 'urgency', 'impact', 'source', 'externalId', 'glpiLocationId'
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

    // Associer l'expéditeur au lieu si la Hotline a corrigé le lieu
    if (ticket.sourceEmail && data.glpiLocationId !== undefined && before.glpiLocationId !== data.glpiLocationId) {
      try {
        const glpiLoc = await prisma.glpiLocation.findUnique({ where: { glpiLocationId: ticket.glpiLocationId } });
        if (glpiLoc) {
          await prisma.requesterLocation.upsert({
            where: { email_glpiLocationId: { email: ticket.sourceEmail.toLowerCase().trim(), glpiLocationId: glpiLoc.id } },
            update: { assignmentCount: { increment: 1 }, lastUsedAt: new Date(), assignedById: req.user.sub },
            create: { email: ticket.sourceEmail.toLowerCase().trim(), glpiLocationId: glpiLoc.id, assignedById: req.user.sub },
          });
        }
      } catch (err) {
        console.error('[ticket.routes] Échec auto-association RequesterLocation:', err.message);
      }
    }

    // Émettre événement temps réel
    emitTicketUpdated(ticket, { status, priority, category, assignedToId });

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
  const corrections = await prisma.ticketFieldCorrection.findMany({
    where: { ticketId: id },
    include: { correctedBy: { select: { id: true, fullName: true, email: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return res.json(corrections);
});

// Approve a ticket (triggers GLPI ticket creation if enabled and not created yet)
router.post('/:id/approve', requirePermission('tickets.approve', ['ADMIN', 'TECHNICIAN', 'HOTLINE']), async (req, res) => {
  const id = Number(req.params.id);
  try {
    const existing = await prisma.ticket.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Ticket introuvable' });

    let glpiTicketId = existing.glpiTicketId;
    let glpiCreationError = null;
    let glpiSkippedReason = null;

    // Vérifier en amont si la création GLPI est désactivée pour prévenir l'utilisateur
    if (!glpiTicketId) {
      const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
      if (settings?.enableGlpiTicketCreation === false) {
        glpiSkippedReason = 'Création GLPI automatique désactivée dans les paramètres';
      } else {
        try {
          glpiTicketId = await createGlpiTicket({
            title: existing.title,
            content: existing.content,
            priority: existing.priority,
            category: existing.category,
            type: existing.type,
            urgency: existing.urgency,
            impact: existing.impact,
            source: existing.source,
            locationId: existing.glpiLocationId,
          });
          // Si createGlpiTicket retourne null sans exception (ex: GLPI non configuré)
          if (!glpiTicketId) {
            glpiSkippedReason = 'GLPI non configuré — aucune synchronisation effectuée';
          }
        } catch (err) {
          console.error('[ticket.routes] Création GLPI lors de l\'approbation échouée:', err.message);
          glpiCreationError = err.message;
        }
      }
    }

    const ticket = await prisma.ticket.update({
      where: { id },
      data: {
        approvalStatus: 'APPROVED',
        approvedById: req.user.sub,
        approvedAt: new Date(),
        approvalNote: req.body.note || null,
        ...(glpiTicketId ? { glpiTicketId, lastGlpiSyncAt: new Date() } : {}),
      },
    });

    if (glpiCreationError) {
      await logEvent(id, 'GLPI_SYNC_FAILED', 'SYSTEM', { action: 'approve-create', error: glpiCreationError });
    } else {
      await logEvent(id, 'APPROVED', req.user.email || 'HOTLINE', { glpiTicketId, glpiSkippedReason });
      await auditLog('TICKET_APPROVED', { actor: req.user, targetType: 'Ticket', targetId: id, targetLabel: ticket.title, metadata: { glpiTicketId, glpiSkippedReason } });
      // Uploader les pièces jointes en attente (stockées localement en attendant GLPI)
      if (glpiTicketId) {
        uploadPendingAttachments(id, glpiTicketId).then((uploaded) => {
          if (uploaded.length > 0) {
            console.log(`[ticket.routes] ${uploaded.length} pièce(s) jointe(s) uploadée(s) vers GLPI pour le ticket #${id}`);
          }
        }).catch((err) => {
          console.error(`[ticket.routes] Échec upload pièces jointes différées pour le ticket #${id}:`, err.message);
        });
      }
    }

    emitTicketUpdated(ticket, { approvalStatus: 'APPROVED', glpiTicketId });

    // Associer l'expéditeur au lieu (RequesterLocation) pour les prochains emails
    if (ticket.sourceEmail && ticket.glpiLocationId) {
      try {
        const glpiLoc = await prisma.glpiLocation.findFirst({
          where: { glpiLocationId: ticket.glpiLocationId },
          select: { id: true },
        });
        if (glpiLoc) {
          await prisma.requesterLocation.upsert({
            where: { email_glpiLocationId: { email: ticket.sourceEmail.toLowerCase().trim(), glpiLocationId: glpiLoc.id } },
            update: { assignmentCount: { increment: 1 }, lastUsedAt: new Date(), assignedById: req.user.sub },
            create: { email: ticket.sourceEmail.toLowerCase().trim(), glpiLocationId: glpiLoc.id, assignedById: req.user.sub },
          });
        }
      } catch (err) {
        console.error('[ticket.routes] Échec auto-association RequesterLocation:', err.message);
      }
    }

    return res.json({
      ...ticket,
      ...(glpiSkippedReason ? { warning: glpiSkippedReason } : {}),
      ...(glpiCreationError ? { glpiCreationError } : {}),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Reject a ticket
router.post('/:id/reject', requirePermission('tickets.approve', ['ADMIN', 'TECHNICIAN', 'HOTLINE']), async (req, res) => {
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
        approvedById: req.user.sub,
        approvedAt: new Date(),
        approvalNote: note.trim(),
      },
    });
    await logEvent(id, 'REJECTED', req.user.email || 'HOTLINE', { reason: note.trim() });
    await auditLog('TICKET_REJECTED', { actor: req.user, targetType: 'Ticket', targetId: id, targetLabel: ticket.title, metadata: { reason: note.trim() } });
    emitTicketUpdated(ticket, { approvalStatus: 'REJECTED' });
    return res.json(ticket);
  } catch (err) {
    return res.status(500).json({ error: err.message });
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

// ── Upload de suivi avec images collées ─────────────────────────────────
const FOLLOWUP_IMAGES_DIR = path.join(__dirname, '..', 'uploads', 'followup-images');
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

  // Sauvegarder les images uploadées et créer des TicketAttachment
  const imageAttachments = [];
  if (req.files && req.files.length > 0) {
    for (const file of req.files) {
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

      const attachment = await prisma.ticketAttachment.create({
        data: {
          ticketId,
          filename: file.originalname || safeFilename,
          mimeType: file.mimetype || 'image/png',
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
  let content = req.body.content;
  imageAttachments.forEach((img, idx) => {
    content = content.replace(
      `<!--IMAGE_${idx}-->`,
      `<img src="${img.url}" alt="image collée" class="pasted-image" style="max-width:100%;border-radius:12px;margin:8px 0;border:1px solid rgba(128,128,128,0.2);" />`
    );
  });

  const followup = await prisma.followup.create({
    data: {
      ticketId,
      authorId: req.user.sub,
      content,
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

  return res.status(201).json({ followup, imageAttachments });
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
    if (err.code === 'P2025') return res.status(404).json({ error: 'Ticket introuvable' });
    console.error('[ticket.routes] Erreur suppression ticket:', err);
    return res.status(500).json({ error: 'Erreur interne' });
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
