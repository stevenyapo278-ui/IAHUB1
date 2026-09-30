const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { auditLog } = require('../services/auditLogService');
const { validateUpload, sanitizeTicketHtml } = require('../utils/security');

const router = express.Router();
router.use(authenticate);

// ── Pièces jointes d'un problème ──────────────────────────────────────
// Captures collées dans un suivi et fichiers uploadés (miroir des tickets).
// process.cwd() et non __dirname : le volume Docker est monté sur
// <WORKDIR>/uploads — __dirname pointerait vers src/routes/ et les fichiers
// seraient perdus au redémarrage du conteneur.
const PROBLEM_ATTACHMENTS_DIR = path.join(process.cwd(), 'uploads', 'problem-attachments');
fs.mkdirSync(PROBLEM_ATTACHMENTS_DIR, { recursive: true });

const problemUpload = multer({ dest: PROBLEM_ATTACHMENTS_DIR, limits: { fileSize: 10 * 1024 * 1024 } });

// Libère les fichiers temporaires de multer lorsqu'une requête échoue.
function dropUploadedFiles(files = []) {
  for (const f of files) { try { fs.unlinkSync(f.path); } catch {} }
}

// Écrit les fichiers reçus sur disque + crée les ProblemAttachment associés.
async function saveProblemAttachments(files = [], problemId) {
  const saved = [];
  for (const file of files) {
    const validation = validateUpload(file.originalname, file.mimetype, 'ticket');
    if (!validation.valid) {
      dropUploadedFiles(files);
      throw new Error(validation.error);
    }
    const ext = path.extname(file.originalname) || '.bin';
    const safeFilename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const destPath = path.join(PROBLEM_ATTACHMENTS_DIR, safeFilename);
    try {
      fs.renameSync(file.path, destPath);
    } catch {
      // rename peut échouer (autre périphérique) → copie puis suppression
      fs.copyFileSync(file.path, destPath);
      fs.unlinkSync(file.path);
    }

    const attachment = await prisma.problemAttachment.create({
      data: {
        problemId,
        filename: file.originalname || safeFilename,
        mimeType: file.mimetype || 'application/octet-stream',
        localFilepath: path.join('uploads', 'problem-attachments', safeFilename),
      },
    });

    saved.push({ id: attachment.id, filename: safeFilename, url: `/uploads/problem-attachments/${safeFilename}` });
  }
  return saved;
}

// Remplace les marqueurs <!--IMAGE_<n>--> du contenu par les <img> correspondants.
// Chemin relatif (/uploads/…) : l'image s'affiche quel que soit le domaine ou le port.
function applyFollowupImageMarkers(content = '', images = []) {
  let out = content;
  images.forEach((img, idx) => {
    out = out.replace(new RegExp(`<!--IMAGE_${idx}-->?`, 'gi'), `<img src="${img.url}" alt="image jointe" />`);
  });
  return out.replace(/<!--IMAGE_\d+-->?/gi, '');
}

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
        requester: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        assignedTo: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
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

// Statuts admis sur une création — sert aussi de reprise de données (ex. export GLPI)
const PROBLEM_STATUSES = ['NEW', 'IN_PROGRESS', 'ASSIGNED', 'PLANNED', 'WAITING', 'SOLVED', 'CLOSED', 'OBSERVED'];

// ── Créer un problème ─────────────────────────────────────────────────
router.post(
  '/',
  requirePermission('problems.manage', ['ADMIN', 'HOTLINE']),
  [
    body('title').notEmpty().trim(),
    body('description').notEmpty().trim(),
    // Reprise de données : sans `status` tout arrive en « Nouveau » et sans
    // `createdAt` la date d'ouverture d'origine est perdue (remise à aujourd'hui).
    body('status').optional({ values: 'null' }).isIn(PROBLEM_STATUSES)
      .withMessage(`Statut invalide (valeurs : ${PROBLEM_STATUSES.join(', ')})`),
    body('createdAt').optional({ values: 'null' }).isISO8601()
      .withMessage('Date de création invalide (format ISO 8601 attendu)'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const {
      title, description, priority, urgency, impact, category, locationId, locationName,
      dueDate, requesterId, assignedToId, teamId, status, createdAt,
    } = req.body;

    // Antidater l'ouverture n'appartient qu'à un administrateur
    let createdAtValue;
    if (createdAt) {
      if (!['ADMIN', 'SUPERADMIN'].includes(req.user.role)) {
        return res.status(403).json({ error: "Seul un administrateur peut fixer la date de création d'un problème" });
      }
      createdAtValue = new Date(createdAt);
    }

    const problem = await prisma.problem.create({
      data: {
        title,
        description,
        status: status || 'NEW',
        priority: priority || 'P3',
        urgency: urgency || 'MEDIUM',
        impact: impact || 'MEDIUM',
        category: category || null,
        locationId: locationId || null,
        locationName: locationName || null,
        dueDate: dueDate ? new Date(dueDate) : null,
        requesterId: requesterId || null,
        assignedToId: assignedToId || null,
        teamId: teamId || null,
        ...(createdAtValue ? { createdAt: createdAtValue } : {}),
        ...(status === 'SOLVED' ? { solvedAt: createdAtValue || new Date() } : {}),
        ...(status === 'CLOSED' ? { closedAt: createdAtValue || new Date() } : {}),
      },
      include: {
        requester: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        assignedTo: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
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
      requester: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
      assignedTo: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
      assignees: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
      team: { select: { id: true, name: true } },
      tickets: {
        include: {
          ticket: {
            select: { id: true, title: true, status: true, priority: true, category: true, createdAt: true, requester: { select: { id: true, fullName: true, avatarUrl: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
      followups: {
        include: { author: { select: { id: true, fullName: true, email: true, avatarUrl: true } } },
        orderBy: { createdAt: 'asc' },
      },
      attachments: { orderBy: { createdAt: 'desc' } },
      events: { orderBy: { createdAt: 'desc' }, take: 50 },
      observers: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
    },
  });

  if (!problem) return res.status(404).json({ error: 'Problème introuvable' });
  res.json(problem);
});

// ── Modifier un problème ──────────────────────────────────────────────
router.patch(
  '/:id',
  requirePermission('problems.manage', ['ADMIN', 'HOTLINE']),
  async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.problem.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Problème introuvable' });

    const allowed = ['title', 'description', 'status', 'priority', 'urgency', 'impact', 'category', 'locationId', 'locationName', 'dueDate', 'requesterId', 'assignedToId', 'teamId', 'assigneeIds', 'observerIds'];
    const data = {};
    const events = [];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        // assigneeIds / observerIds sont traités plus bas (relations Prisma, pas des
        // colonnes) : ne jamais les copier tels quels dans data — Prisma les refuserait.
        if (key === 'assigneeIds' || key === 'observerIds') continue;
        let val = req.body[key];
        if (key === 'dueDate' && val) val = new Date(val);

        // Identifiants : coercition en entier (un select envoie des chaînes) et
        // contrôle d'existence — sinon Prisma lève une FK violée → 500.
        if (['locationId', 'requesterId', 'assignedToId', 'teamId'].includes(key)) {
          val = val === null || val === '' ? null : Number(val);
          if (val !== null && !Number.isInteger(val)) return res.status(400).json({ error: `${key} invalide` });
          if (val !== null && key === 'assignedToId') {
            const u = await prisma.user.findUnique({ where: { id: val }, select: { id: true } });
            if (!u) return res.status(400).json({ error: 'Utilisateur introuvable' });
          }
          if (val !== null && key === 'teamId') {
            const t = await prisma.team.findUnique({ where: { id: val }, select: { id: true } });
            if (!t) return res.status(400).json({ error: 'Équipe introuvable' });
          }
        }

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

    if (Object.keys(data).length === 0 && req.body.assigneeIds === undefined && req.body.observerIds === undefined) return res.json(existing);

    // Multi-assignation (miroir de Ticket.assignees) : remplace la liste complète.
    // assignedToId suit le premier assigné si non fourni explicitement — cohérence
    // avec la fiche ticket et l'historique d'assignation.
    if (req.body.assigneeIds !== undefined) {
      const ids = Array.isArray(req.body.assigneeIds) ? req.body.assigneeIds.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
      const existingIds = ids.length > 0
        ? (await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((u) => u.id)
        : [];
      if (ids.length !== existingIds.length) {
        return res.status(400).json({ error: 'Un ou plusieurs assignés sont introuvables' });
      }
      data.assignees = { set: existingIds.map((uid) => ({ id: uid })) };
      if (req.body.assignedToId === undefined) {
        data.assignedToId = existingIds[0] || null;
        if ((existing.assignedToId || null) !== (data.assignedToId || null)) {
          events.push({ type: 'ASSIGNED', payload: { from: existing.assignedToId, to: data.assignedToId } });
        }
      }
    }

    // Observateurs : remplace la liste complète (ids vérifiés, sinon FK violée)
    if (req.body.observerIds !== undefined) {
      const ids = Array.isArray(req.body.observerIds) ? req.body.observerIds.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
      const existingIds = ids.length > 0
        ? (await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((u) => u.id)
        : [];
      if (ids.length !== existingIds.length) {
        return res.status(400).json({ error: 'Un ou plusieurs observateurs sont introuvables' });
      }
      data.observers = { set: existingIds.map((uid) => ({ id: uid })) };
    }

    const problem = await prisma.problem.update({ where: { id }, data, include: { observers: { select: { id: true } } } });

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
  requirePermission('problems.manage', ['ADMIN']),
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
          requester: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
          assignedTo: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
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
  requirePermission('problems.manage', ['ADMIN', 'HOTLINE']),
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
  requirePermission('problems.manage', ['ADMIN', 'HOTLINE']),
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
    include: { author: { select: { id: true, fullName: true, email: true, avatarUrl: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(followups);
});

router.post(
  '/:id/followups',
  requirePermission('problems.manage', ['ADMIN', 'HOTLINE']),
  // Multipart : images collées (FormData) comme sur les tickets. Un appel JSON
  // reste accepté — multer laisse passer les requêtes non multipart.
  problemUpload.array('images', 10),
  // trim AVANT notEmpty : sinon '   ' passe le contrôle puis devient vide
  [body('content').trim().notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      dropUploadedFiles(req.files);
      return res.status(400).json({ errors: errors.array() });
    }

    const problemId = Number(req.params.id);
    const problem = await prisma.problem.findUnique({ where: { id: problemId } });
    if (!problem) {
      dropUploadedFiles(req.files);
      return res.status(404).json({ error: 'Problème introuvable' });
    }

    let images = [];
    try {
      images = await saveProblemAttachments(req.files || [], problemId);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const { content, isPrivate } = req.body;
    const finalContent = sanitizeTicketHtml(applyFollowupImageMarkers(content, images));

    const followup = await prisma.problemFollowup.create({
      data: { problemId, authorId: req.user.sub, content: finalContent, isPrivate: isPrivate === 'true' || isPrivate === true },
      include: { author: { select: { id: true, fullName: true, email: true, avatarUrl: true } } },
    });

    await prisma.problemEvent.create({
      data: { problemId, type: 'FOLLOWUP_ADDED', actor: req.user.email || 'SYSTEM', payload: { followupId: followup.id, attachmentCount: images.length } },
    });

    res.status(201).json({ ...followup, attachments: images });
  }
);

// ── Éditer un suivi de problème (auteur du suivi ou ADMIN/SUPERADMIN) ────
router.patch(
  '/:id/followups/:followupId',
  requirePermission('problems.manage', ['ADMIN', 'HOTLINE']),
  problemUpload.array('images', 10),
  [body('content').trim().notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      dropUploadedFiles(req.files);
      return res.status(400).json({ errors: errors.array() });
    }

    const problemId = Number(req.params.id);
    const followupId = Number(req.params.followupId);

    const followup = await prisma.problemFollowup.findFirst({
      where: { id: followupId, problemId },
      include: { author: { select: { id: true, fullName: true, avatarUrl: true } } },
    });
    if (!followup) {
      dropUploadedFiles(req.files);
      return res.status(404).json({ error: 'Commentaire introuvable' });
    }

    const isAdmin = ['ADMIN', 'SUPERADMIN'].includes(req.user.role);
    if (!isAdmin && followup.authorId !== req.user.sub) {
      dropUploadedFiles(req.files);
      return res.status(403).json({ error: 'Vous ne pouvez modifier que vos propres commentaires' });
    }

    let images = [];
    try {
      images = await saveProblemAttachments(req.files || [], problemId);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const { content } = req.body;
    const updated = await prisma.problemFollowup.update({
      where: { id: followupId },
      data: { content: sanitizeTicketHtml(applyFollowupImageMarkers(content, images)), updatedAt: new Date() },
      include: { author: { select: { id: true, fullName: true, email: true, avatarUrl: true } } },
    });

    await prisma.problemEvent.create({
      data: { problemId, type: 'FOLLOWUP_EDITED', actor: req.user.email || 'SYSTEM', payload: { followupId, imagesAdded: images.length } },
    });

    res.json({ followup: updated, imageAttachments: images });
  }
);

// ── Supprimer un suivi de problème (auteur ou ADMIN/SUPERADMIN) ─────────
router.delete(
  '/:id/followups/:followupId',
  requirePermission('problems.manage', ['ADMIN', 'HOTLINE']),
  async (req, res) => {
    const problemId = Number(req.params.id);
    const followupId = Number(req.params.followupId);

    const followup = await prisma.problemFollowup.findFirst({ where: { id: followupId, problemId } });
    if (!followup) return res.status(404).json({ error: 'Commentaire introuvable' });

    const isAdmin = ['ADMIN', 'SUPERADMIN'].includes(req.user.role);
    if (!isAdmin && followup.authorId !== req.user.sub) {
      return res.status(403).json({ error: 'Vous ne pouvez supprimer que vos propres commentaires' });
    }

    await prisma.problemFollowup.delete({ where: { id: followupId } });
    await prisma.problemEvent.create({
      data: { problemId, type: 'FOLLOWUP_DELETED', actor: req.user.email || 'SYSTEM', payload: { followupId } },
    });

    res.json({ success: true });
  }
);

// ── Pièces jointes du problème (upload / téléchargement / suppression) ──
router.post(
  '/:id/attachments',
  requirePermission('problems.manage', ['ADMIN', 'HOTLINE']),
  problemUpload.array('files', 10),
  async (req, res) => {
    const problemId = Number(req.params.id);
    const problem = await prisma.problem.findUnique({ where: { id: problemId }, select: { id: true } });
    if (!problem) {
      dropUploadedFiles(req.files);
      return res.status(404).json({ error: 'Problème introuvable' });
    }
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Aucun fichier fourni' });

    try {
      await saveProblemAttachments(req.files, problemId);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const updated = await prisma.problem.findUnique({ where: { id: problemId }, include: { attachments: { orderBy: { createdAt: 'desc' } } } });
    res.status(201).json({ attachments: updated.attachments });
  }
);

router.get('/:id/attachments/:attachmentId/file', async (req, res) => {
  try {
    const attachment = await prisma.problemAttachment.findFirst({
      where: { id: Number(req.params.attachmentId), problemId: Number(req.params.id) },
    });
    if (!attachment) return res.status(404).json({ error: 'Pièce jointe introuvable' });

    if (attachment.localFilepath) {
      // Résolution relative à process.cwd() (= WORKDIR du conteneur)
      const localPath = path.isAbsolute(attachment.localFilepath)
        ? attachment.localFilepath
        : path.join(process.cwd(), attachment.localFilepath);
      if (fs.existsSync(localPath)) {
        res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `${String(attachment.mimeType || '').startsWith('image/') ? 'inline' : 'attachment'}; filename="${attachment.filename}"`);
        return res.sendFile(localPath);
      }
      console.error(`[problem.routes] Fichier introuvable sur le disque: ${localPath}`);
    }
    return res.status(404).json({ error: 'Fichier non disponible sur ce serveur' });
  } catch (err) {
    console.error('[problem.routes] Erreur téléchargement pièce jointe:', err);
    return res.status(500).json({ error: 'Erreur lors du téléchargement' });
  }
});

router.delete(
  '/:id/attachments/:attachmentId',
  requirePermission('problems.manage', ['ADMIN', 'HOTLINE']),
  async (req, res) => {
    const attachment = await prisma.problemAttachment.findFirst({
      where: { id: Number(req.params.attachmentId), problemId: Number(req.params.id) },
    });
    if (!attachment) return res.status(404).json({ error: 'Pièce jointe introuvable' });

    if (attachment.localFilepath) {
      const localPath = path.isAbsolute(attachment.localFilepath)
        ? attachment.localFilepath
        : path.join(process.cwd(), attachment.localFilepath);
      try { fs.unlinkSync(localPath); } catch {}
    }
    await prisma.problemAttachment.delete({ where: { id: attachment.id } });
    res.json({ ok: true });
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
