const express = require('express');
const { body, validationResult } = require('express-validator');
const path = require('path');
const fs = require('fs');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { getActiveGlpiConfig, glpiInitSession, glpiKillSession } = require('../utils/glpiSync');
const { notifyMajorIncidentResolved, sendTicketStatusNotification } = require('../services/emailSender');
const { updateGlpiTicket, deleteGlpiTicket, addGlpiFollowup } = require('../services/glpiTicketCreator');
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
const multer = require('multer');

const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } }); // 20 Mo max
const router = express.Router();
router.use(authenticate);

// List tickets (with optional filters + pagination + sorting)
router.get('/', async (req, res) => {
  const {
    status, priority, teamId, assignedToId, mine, title, search, limit, page,
    sortBy, sortOrder, category, locationId, aiProcessed, due
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
  if (assignedToId === 'none') where.assignedToId = null;
  else if (assignedToId) where.assignedToId = Number(assignedToId);
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

  // due=overdue -> tickets dont l'échéance manuelle est dépassée et qui ne sont pas clôturés
  if (due === 'overdue') {
    where.dueDate = { not: null, lt: new Date() };
    if (!status) where.status = { notIn: ['SOLVED', 'CLOSED'] };
  }
  if (due === 'due') where.dueDate = { not: null };
  if (due === 'undue') where.dueDate = null;

  // Filtrer les tickets dont la clôture a été suggérée par l'IA (en attente de validation Hotline)
  if (req.query.closeSuggested === 'true') where.closeSuggested = true;
  if (req.query.closeSuggested === 'false') where.closeSuggested = false;

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

// Export serveur : mêmes filtres que la liste, dataset complet (pas de pagination UI)
router.get('/export', async (req, res) => {
  const {
    status, priority, teamId, assignedToId, mine, search, category, source,
    aiProcessed, closeSuggested, approvalStatus, sortBy, sortOrder, format,
  } = req.query;

  const where = {};
  if (status) {
    if (status === 'OPEN_GROUP') where.status = { in: ['NEW', 'OPEN', 'PENDING'] };
    else if (status === 'CLOSED_GROUP') where.status = { in: ['SOLVED', 'CLOSED'] };
    else where.status = status;
  }
  if (priority) where.priority = priority;
  if (teamId) where.teamId = Number(teamId);
  if (assignedToId === 'none') where.assignedToId = null;
  else if (assignedToId) where.assignedToId = Number(assignedToId);
  if (category) where.category = category;
  if (aiProcessed === 'true') where.aiProcessed = true;
  if (mine === 'true') {
    if (req.user.role === 'REQUESTER') where.requesterId = req.user.sub;
    else where.assignedToId = req.user.sub;
  }
  if (approvalStatus) where.approvalStatus = approvalStatus;
  if (closeSuggested === 'true') where.closeSuggested = true;
  if (closeSuggested === 'false') where.closeSuggested = false;
  if (source === 'glpi') where.glpiTicketId = { not: null };
  if (source === 'erp') where.glpiTicketId = null;

  if (search) {
    const numericId = parseInt(search, 10);
    const orConditions = [
      { title: { contains: search, mode: 'insensitive' } },
      { content: { contains: search, mode: 'insensitive' } },
      { category: { contains: search, mode: 'insensitive' } },
    ];
    if (!isNaN(numericId)) orConditions.push({ id: numericId });
    where.OR = orConditions;
  }

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
      source: true, requesterId: true, assignedToId: true, teamId: true, glpiTicketId: true,
      glpiLocationName: true, createdAt: true, solvedAt: true, closedAt: true,
      slaResponseDueAt: true, slaResolutionDueAt: true, slaBreachedAt: true, firstResponseAt: true,
      aiProcessed: true, approvalStatus: true, requester: { select: { email: true, fullName: true } },
      assignedTo: { select: { email: true, fullName: true } },
      team: { select: { name: true } },
    },
  });

  if (format === 'csv') {
    const header = ['id', 'titre', 'statut', 'priorite', 'categorie', 'type', 'source', 'demandeur', 'technicien', 'equipe', 'glpi_ticket_id', 'lieu', 'cree_le', 'resolu_le', 'ferme_le', 'sla_reponse_due', 'sla_resolution_due', 'sla_depasse_le', 'premiere_reponse', 'ia', 'approbation'];
    const rows = tickets.map((t) => [
      t.id, `"${(t.title || '').replace(/"/g, '""')}"`, t.status, t.priority, `"${(t.category || '').replace(/"/g, '""')}"`,
      t.type, t.source || '', t.requester?.email || '', t.assignedTo?.email || '', t.team?.name || '',
      t.glpiTicketId || '', t.glpiLocationName || '', t.createdAt?.toISOString() || '', t.solvedAt?.toISOString() || '',
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
          select: { status: true, priority: true, glpiTicketId: true },
        });
        if (!before) { failures.push({ id, error: 'Ticket introuvable' }); continue; }

        const ticket = await prisma.ticket.update({
          where: { id },
          data: {
            ...data,
            ...(data.status === 'SOLVED' ? { solvedAt: new Date() } : {}),
            ...(data.status === 'CLOSED' ? { closedAt: new Date() } : {}),
          },
        });

        // SLA recalculé si la priorité change
        if (data.priority) {
          try { await applySla(ticket); } catch (err) { console.error('[ticket.routes] Recalcul SLA bulk échoué:', err.message); }
        }

        // Répercuter vers GLPI si synchronisé
        if (before.glpiTicketId) {
          try {
            let assignedToGlpiId;
            if (assignedToId !== undefined && assignedToId) {
              const assignee = await prisma.user.findUnique({ where: { id: Number(assignedToId) }, select: { glpiId: true } });
              assignedToGlpiId = assignee?.glpiId || undefined;
            }
            await updateGlpiTicket(before.glpiTicketId, { status, priority, assignedToGlpiId });
          } catch (err) {
            await logEvent(id, 'GLPI_SYNC_FAILED', 'SYSTEM', { action: 'bulk-update', error: err.message });
          }
        }

        emitTicketUpdated(ticket, { status, priority, assignedToId });
        if (data.status) notifyRequesterOnStatusChange(id, data.status);
        updatedCount += 1;
      } catch (err) {
        failures.push({ id, error: err.message });
      }
    }

    return res.json({ updatedCount, total: ids.length, failures });
  }
);

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
      linksA: { include: { ticketB: { select: { id: true, title: true, status: true, priority: true } } }, orderBy: { createdAt: 'asc' } },
      linksB: { include: { ticketA: { select: { id: true, title: true, status: true, priority: true } } }, orderBy: { createdAt: 'asc' } },
    },
  });

  if (!ticket) {
    return res.status(404).json({ error: 'Ticket introuvable' });
  }

  // Les commentaires privés (isPrivate) ne sont visibles que par l'équipe (jamais par le demandeur)
  const isStaffMember = ['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN'].includes(req.user.role);
  if (!isStaffMember) {
    ticket.followups = ticket.followups.filter((f) => !f.isPrivate);
  }

  return res.json(ticket);
});

// Télécharge le contenu d'une pièce jointe via le proxy GLPI
router.get('/:id/attachments/:attachmentId/file', async (req, res) => {
  const attachment = await prisma.ticketAttachment.findFirst({
    where: { id: Number(req.params.attachmentId), ticketId: Number(req.params.id) },
  });
  if (!attachment) return res.status(404).json({ error: 'Pièce jointe introuvable' });

  // Priorité au fichier local (pièces jointes en attente d'approbation ou jamais synchronisées GLPI)
  if (attachment.localFilepath) {
    const localPath = path.isAbsolute(attachment.localFilepath)
      ? attachment.localFilepath
      : path.join(__dirname, '..', attachment.localFilepath);
    if (fs.existsSync(localPath)) {
      res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${attachment.filename}"`);
      return res.sendFile(localPath);
    }
  }

  // Sinon, document GLPI (sync historique)
  if (!attachment.glpiDocumentId) {
    return res.status(404).json({ error: 'Fichier non disponible sur ce serveur' });
  }

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
      type, urgency, impact, source, externalId, status, openedAt, locationId, dueDate,
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
        ...(dueDate ? { dueDate: new Date(dueDate) } : {}),
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
        const TICKET_ATTACHMENTS_DIR = path.join(__dirname, '..', 'uploads', 'ticket-attachments');
        fs.mkdirSync(TICKET_ATTACHMENTS_DIR, { recursive: true });
        const safeFilename = `${ticket.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(req.file.originalname) || ''}`;
        const destPath = path.join(TICKET_ATTACHMENTS_DIR, safeFilename);
        fs.writeFileSync(destPath, req.file.buffer);
        await prisma.ticketAttachment.create({
          data: {
            ticketId: ticket.id,
            filename: req.file.originalname,
            mimeType: req.file.mimetype,
            localFilepath: path.join('uploads', 'ticket-attachments', safeFilename),
          },
        });
      } catch (err) {
        console.error('[ticket.routes] Sauvegarde pièce jointe échouée:', err.message);
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

    // Auto-approbation des tickets créés MANUELLEMENT (formulaire interne / portail) quand le
    // réglage autoApproveManualTickets est activé. Les tickets créés par email/IA passent par
    // createTicketFromEmail (aiProcessed=true) et restent soumis à validation Hotline.
    const creationSettings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
    if (creationSettings?.autoApproveManualTickets === true && finalTicket) {
      try {
        await approveTicket(finalTicket.id, {
          approvedById: req.user.sub,
          approvedByEmail: req.user.email || 'HOTLINE',
        });
        // Recharger le ticket pour refléter l'approbation (APPROVED, glpiTicketId éventuel)
        finalTicket = await prisma.ticket.findUnique({ where: { id: ticket.id } });
      } catch (err) {
        console.error('[ticket.routes] Auto-approbation échouée:', err.message);
        await logEvent(ticket.id, 'GLPI_SYNC_FAILED', 'SYSTEM', { action: 'auto-approve', error: err.message }).catch(() => {});
      }
    }

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
  const { title, content, status, priority, category, teamId, assignedToId, type, urgency, impact, source, externalId, dueDate } = req.body;

  const data = {};
  if (title !== undefined) data.title = title;
  if (content !== undefined) data.content = content;
  if (priority !== undefined) data.priority = priority;
  if (category !== undefined) data.category = category;
  if (teamId !== undefined) data.teamId = teamId;
  if (assignedToId !== undefined) data.assignedToId = assignedToId;

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
    notifyRequesterOnStatusChange(id, data.status);

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
              data: { status: data.status, closedAt: data.status === 'CLOSED' ? new Date() : undefined, solvedAt: data.status === 'SOLVED' ? new Date() : undefined },
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

// Valider la clôture suggérée : passe le ticket en SOLVED et synchronise GLPI.
router.post('/:id/validate-close', requirePermission('tickets.approve', ['ADMIN', 'TECHNICIAN', 'HOTLINE']), async (req, res) => {
  const id = Number(req.params.id);
  try {
    const existing = await prisma.ticket.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Ticket introuvable' });
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

    if (ticket.glpiTicketId) {
      try {
        await updateGlpiTicket(ticket.glpiTicketId, { status: 'SOLVED' });
      } catch (err) {
        console.error('[ticket.routes] Synchro GLPI clôture validée échouée:', err.message);
        await logEvent(id, 'GLPI_SYNC_FAILED', 'SYSTEM', { action: 'validate-close', error: err.message });
      }
    }

    emitTicketUpdated(ticket, { status: 'SOLVED', closeSuggested: false });
    notifyRequesterOnStatusChange(id, 'SOLVED');
    return res.json(ticket);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Rejeter la clôture suggérée : le problème n'est pas résolu, le ticket reste actif.
router.post('/:id/reject-close', requirePermission('tickets.approve', ['ADMIN', 'TECHNICIAN', 'HOTLINE']), async (req, res) => {
  const id = Number(req.params.id);
  const note = req.body.note || req.body.reason;
  if (!note || !note.trim()) {
    return res.status(400).json({ error: 'Une raison de rejet est obligatoire.' });
  }
  try {
    const existing = await prisma.ticket.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Ticket introuvable' });
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

    emitTicketUpdated(ticket, { status: 'OPEN', closeSuggested: false });
    notifyRequesterOnStatusChange(id, 'OPEN');
    return res.json(ticket);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
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

// Escalade manuelle d'un ticket (prise en charge prioritaire par les admins)
router.post('/:id/escalate', requirePermission('tickets.assign', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = req.body || {};
  try {
    const escalated = await escalateTicket(id, {
      reason: reason || 'Escalade manuelle',
      actor: `user:${req.user.sub}`,
      source: 'manual',
    });
    return res.json(escalated);
  } catch (err) {
    if (err.message === 'Ticket introuvable') return res.status(404).json({ error: err.message });
    console.error('[ticket.routes] Erreur escalade ticket:', err.message);
    return res.status(500).json({ error: 'Erreur lors de l\'escalade' });
  }
});

// Notifie le demandeur par email quand le statut de son ticket change
async function notifyRequesterOnStatusChange(id, status) {
  if (!status) return;
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: { requester: { select: { email: true, fullName: true } } },
    });
    if (!ticket?.requester?.email) return;
    await sendTicketStatusNotification({
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      status,
      priority: ticket.priority,
      category: ticket.category,
      recipientEmail: ticket.requester.email,
      recipientName: ticket.requester.fullName,
    });
  } catch (err) {
    console.error(`[ticket.routes] Échec notification statut au demandeur (ticket ${id}):`, err.message);
  }
}

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
      isPrivate: req.body.isPrivate === 'true' || req.body.isPrivate === true,
    },
    include: { author: { select: { id: true, fullName: true } } },
  });

  // Le temps de première réponse est fixé au premier suivi d'un technicien/hotline/admin
  if (['ADMIN', 'TECHNICIAN', 'HOTLINE', 'SUPERADMIN'].includes(req.user.role)) {
    try {
      await recordFirstResponse(ticketId, req.user.sub);
    } catch (err) {
      console.error('[ticket.routes] Enregistrement première réponse échoué:', err.message);
    }
  }

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

// Bascule privé/public d'un commentaire (visible uniquement par l'équipe)
router.patch('/:id/followups/:followupId/visibility', requirePermission('tickets.assign', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const ticketId = Number(req.params.id);
  const followupId = Number(req.params.followupId);

  const followup = await prisma.followup.findFirst({
    where: { id: followupId, ticketId },
    include: { author: { select: { id: true, fullName: true } } },
  });
  if (!followup) return res.status(404).json({ error: 'Commentaire introuvable' });

  const isPrivate = req.body.isPrivate === true || req.body.isPrivate === 'true';
  const updated = await prisma.followup.update({
    where: { id: followupId },
    data: { isPrivate },
    include: { author: { select: { id: true, fullName: true } } },
  });

  try {
    await logEvent(ticketId, isPrivate ? 'FOLLOWUP_MADE_PRIVATE' : 'FOLLOWUP_MADE_PUBLIC', req.user.sub, { followupId });
  } catch (err) {
    console.error('[ticket.routes] Log visibilité commentaire échoué:', err.message);
  }

  return res.json({ followup: updated });
});

// ── Tickets liés ────────────────────────────────────────────────────────
router.post('/:id/links', requirePermission('tickets.assign', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
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

router.delete('/:id/links/:linkId', requirePermission('tickets.assign', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
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
router.post('/:id/children', requirePermission('tickets.assign', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
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
      status: 'NEW',
      teamId: parent.teamId,
      assignedToId: parent.assignedToId || null,
      requesterId: parent.requesterId || null,
      glpiLocationId: parent.glpiLocationId,
      glpiLocationName: parent.glpiLocationName,
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
  return res.status(201).json(child);
});

// ── Fusion de tickets sources dans le ticket courant ────────────────────
router.post('/:id/merge', requirePermission('tickets.assign', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
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

// Lier manuellement un ticket GLPI existant à un ticket ERP
// Utilisé quand la création GLPI automatique retourne 200 vide (bug GLPI 10.0.x)
router.patch('/:id/glpi-link', requirePermission('tickets.edit', ['ADMIN', 'TECHNICIAN', 'HOTLINE']), async (req, res) => {
  const id = Number(req.params.id);
  const { glpiTicketId } = req.body;
  if (!glpiTicketId || !Number.isInteger(Number(glpiTicketId))) {
    return res.status(400).json({ error: 'glpiTicketId (nombre) requis' });
  }
  try {
    const ticket = await prisma.ticket.findUnique({ where: { id } });
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

    await prisma.ticket.update({
      where: { id },
      data: { glpiTicketId: Number(glpiTicketId), lastGlpiSyncAt: new Date() },
    });
    await logEvent(id, 'GLPI_LINKED', req.user.email, { glpiTicketId });
    return res.json({ success: true, glpiTicketId: Number(glpiTicketId) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
