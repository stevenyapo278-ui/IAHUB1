const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { runEmailPipeline, processMessage } = require('../services/emailPipeline');
const { fetchEmailsByDateRange } = require('../services/emailPoller');
const { analyzeEmail } = require('../services/mailAnalyzer');
const { listThreads, getThread, getInboxCounts } = require('../services/inboxThreading');

const router = express.Router();
router.use(authenticate);

// Un demandeur (REQUESTER) ne voit que les emails qui le concernent : ceux qu'il a envoyés ou
// ceux rattachés à ses tickets. Les autres rôles (ADMIN/HOTLINE/TECHNICIAN/SUPERADMIN) voient toute la boîte.
async function buildEmailScope(user) {
  if (user.role !== 'REQUESTER') return null;
  const email = (user.email || '').toLowerCase();
  const tickets = await prisma.ticket.findMany({ where: { requesterId: user.sub }, select: { id: true } });
  const ticketIds = tickets.map((t) => t.id);
  return {
    OR: [
      { fromEmail: { equals: email, mode: 'insensitive' } },
      { erpTicketId: { in: ticketIds } },
    ],
  };
}

// Liste des emails reçus regroupés par conversation (façon Outlook), avec filtrage avancé.
// La recherche porte sur le fil entier : si un message d'une conversation correspond, tout le fil est renvoyé.
router.get('/', async (req, res) => {
  const status = req.query.status || undefined;
  const q = req.query.q?.trim() || undefined;
  const priority = req.query.priority || undefined;
  const attachments = req.query.attachments || undefined; // with | without
  const category = req.query.category || undefined;
  const read = req.query.read || undefined; // unread | read
  const days = parseInt(req.query.days) > 0 ? parseInt(req.query.days) : undefined;
  const dateFrom = req.query.dateFrom || undefined;
  const dateTo = req.query.dateTo || undefined;
  const fromEmail = req.query.fromEmail || undefined;
  const toEmail = req.query.toEmail || undefined;
  const sort = req.query.sort || undefined; // date | date_asc | priority | sender | unread
  const folderId = req.query.folderId !== undefined ? req.query.folderId : undefined;

  const scope = await buildEmailScope(req.user);

  const { items, total } = await listThreads({ status, q, priority, attachments, category, read, days, dateFrom, dateTo, fromEmail, toEmail, sort, scope, folderId });

  // Allège la liste : on retirera les corps HTML (conservés uniquement dans le détail du fil)
  const stripped = items.map((thread) => ({
    ...thread,
    messages: thread.messages.map((m) => ({ ...m, bodyHtml: undefined, body: undefined })),
    latest: { ...thread.latest, bodyHtml: undefined, body: undefined },
  }));

  res.json({ items: stripped, total });
});

// Compteurs globaux (badges des dossiers façon Outlook)
// Doit être déclaré AVANT la route '/:id' pour que "counts" ne soit pas capté par celle-ci.
router.get('/counts', async (req, res) => {
  try {
    const scope = await buildEmailScope(req.user);
    const counts = await getInboxCounts(scope);
    res.json(counts);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Erreur de calcul des compteurs' });
  }
});

// Marque les emails d'une conversation (ou plusieurs) comme lus / non lus.
// body: { key: 'conv-123' } | { keys: [...] } | { ids: [1,2] } + { read: boolean }
router.post('/read', async (req, res) => {
  const { key, keys, ids, read } = req.body || {};
  const targetRead = read === undefined ? true : !!read;
  const orClauses = [];
  if (key) {
    if (String(key).startsWith('single-')) {
      orClauses.push({ id: Number(String(key).slice('single-'.length)) });
    } else {
      orClauses.push({ conversationId: key });
    }
  }
  if (Array.isArray(keys)) {
    for (const k of keys) {
      if (String(k).startsWith('single-')) orClauses.push({ id: Number(String(k).slice('single-'.length)) });
      else orClauses.push({ conversationId: k });
    }
  }
  if (Array.isArray(ids) && ids.length > 0) {
    orClauses.push({ id: { in: ids.map(Number).filter(Boolean) } });
  }
  if (orClauses.length === 0) return res.status(400).json({ error: 'key, keys ou ids requis' });

  try {
    // Un demandeur ne marque comme lu que les emails qui le concernent
    const scope = await buildEmailScope(req.user);
    const where = scope ? { AND: [scope, { OR: orClauses }] } : { OR: orClauses };
    const result = await prisma.incomingEmail.updateMany({ where, data: { isRead: targetRead } });
    res.json({ updated: result.count, read: targetRead });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Erreur mise à jour statut lecture' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// DOSSIERS CUSTOM (AVANT /:id pour éviter la capture par le paramètre dynamique)
// ══════════════════════════════════════════════════════════════════════════════

// Lister tous les dossiers (built-in + custom de l'utilisateur)
router.get('/folders', async (req, res) => {
  try {
    const folders = await prisma.inboxFolder.findMany({
      where: { OR: [{ isSystem: true }, { createdById: req.user.sub }] },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    const folderIds = folders.map((f) => f.id);
    const counts = folderIds.length > 0
      ? await prisma.incomingEmail.groupBy({ by: ['folderId'], where: { folderId: { in: folderIds } }, _count: true })
      : [];
    const countMap = Object.fromEntries(counts.map((c) => [c.folderId, c._count]));
    const result = folders.map((f) => ({ ...f, emailCount: countMap[f.id] || 0 }));
    res.json(result);
  } catch (err) {
    console.error('[inbox/folders] Erreur:', err.message, err.stack);
    return res.status(500).json({ error: err.message || 'Erreur lors du chargement des dossiers' });
  }
});

router.post('/folders', [body('name').trim().isLength({ min: 1, max: 50 })], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { name, icon, color } = req.body;
  const existing = await prisma.inboxFolder.findUnique({ where: { name_createdById: { name, createdById: req.user.sub } } });
  if (existing) return res.status(409).json({ error: 'Un dossier avec ce nom existe déjà' });
  const maxPos = await prisma.inboxFolder.aggregate({ where: { createdById: req.user.sub }, _max: { position: true } });
  const folder = await prisma.inboxFolder.create({
    data: { name, icon: icon || null, color: color || null, position: (maxPos._max.position || 0) + 1, createdById: req.user.sub },
  });
  res.status(201).json(folder);
});

// Déplacer des emails vers un dossier (ou null pour revenir en inbox)
// DOIT être AVANT /folders/:id pour éviter la capture par ':id'
router.post('/folders/move', [body('ids').isArray({ min: 1 })], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { ids, folderId } = req.body;
  if (folderId !== null && folderId !== undefined) {
    const folder = await prisma.inboxFolder.findUnique({ where: { id: folderId } });
    if (!folder) return res.status(404).json({ error: 'Dossier introuvable' });
  }
  const result = await prisma.incomingEmail.updateMany({
    where: { id: { in: ids.map(Number) } },
    data: { folderId: folderId || null },
  });
  res.json({ moved: result.count });
});

router.patch('/folders/:id', [body('name').optional().trim().isLength({ min: 1, max: 50 })], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const id = Number(req.params.id);
  const folder = await prisma.inboxFolder.findUnique({ where: { id } });
  if (!folder || (folder.createdById !== req.user.sub && !folder.isSystem)) {
    return res.status(404).json({ error: 'Dossier introuvable' });
  }
  if (folder.isSystem) return res.status(403).json({ error: 'Impossible de modifier un dossier système' });
  const data = {};
  if (req.body.name !== undefined) data.name = req.body.name;
  if (req.body.icon !== undefined) data.icon = req.body.icon || null;
  if (req.body.color !== undefined) data.color = req.body.color || null;
  if (req.body.position !== undefined) data.position = req.body.position;
  const updated = await prisma.inboxFolder.update({ where: { id }, data });
  res.json(updated);
});

router.delete('/folders/:id', async (req, res) => {
  const id = Number(req.params.id);
  const folder = await prisma.inboxFolder.findUnique({ where: { id } });
  if (!folder || (folder.createdById !== req.user.sub && !folder.isSystem)) {
    return res.status(404).json({ error: 'Dossier introuvable' });
  }
  if (folder.isSystem) return res.status(403).json({ error: 'Impossible de supprimer un dossier système' });
  await prisma.incomingEmail.updateMany({ where: { folderId: id }, data: { folderId: null } });
  await prisma.inboxFolder.delete({ where: { id } });
  res.json({ message: 'Dossier supprimé' });
});

// ══════════════════════════════════════════════════════════════════════════════
// RÈGLES DE TRI (AVANT /:id)
// ══════════════════════════════════════════════════════════════════════════════

router.get('/rules', async (req, res) => {
  const rules = await prisma.inboxRule.findMany({
    where: { createdById: req.user.sub },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });
  res.json(rules);
});

router.post('/rules', [
  body('label').trim().isLength({ min: 1, max: 100 }),
  body('conditions').isArray({ min: 1 }),
  body('action').isIn(['move_to_folder', 'mark_read', 'mark_spam', 'mark_category']),
  body('actionConfig').isObject(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { label, conditions, conditionOperator, action, actionConfig } = req.body;
  if (action === 'move_to_folder' && actionConfig.folderId) {
    const folder = await prisma.inboxFolder.findUnique({ where: { id: actionConfig.folderId } });
    if (!folder) return res.status(400).json({ error: 'Dossier de destination introuvable' });
  }
  const maxPos = await prisma.inboxRule.aggregate({ where: { createdById: req.user.sub }, _max: { position: true } });
  const rule = await prisma.inboxRule.create({
    data: {
      label, conditions, conditionOperator: conditionOperator || 'AND', action, actionConfig,
      position: (maxPos._max.position || 0) + 1, createdById: req.user.sub,
    },
  });
  res.status(201).json(rule);
});

router.patch('/rules/:id', async (req, res) => {
  const id = Number(req.params.id);
  const rule = await prisma.inboxRule.findUnique({ where: { id } });
  if (!rule || rule.createdById !== req.user.sub) return res.status(404).json({ error: 'Règle introuvable' });
  const data = {};
  for (const key of ['label', 'isEnabled', 'position', 'conditions', 'conditionOperator', 'action', 'actionConfig']) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }
  const updated = await prisma.inboxRule.update({ where: { id }, data });
  res.json(updated);
});

router.patch('/rules/:id/toggle', async (req, res) => {
  const id = Number(req.params.id);
  const rule = await prisma.inboxRule.findUnique({ where: { id } });
  if (!rule || rule.createdById !== req.user.sub) return res.status(404).json({ error: 'Règle introuvable' });
  const updated = await prisma.inboxRule.update({ where: { id }, data: { isEnabled: !rule.isEnabled } });
  res.json(updated);
});

router.delete('/rules/:id', async (req, res) => {
  const id = Number(req.params.id);
  const rule = await prisma.inboxRule.findUnique({ where: { id } });
  if (!rule || rule.createdById !== req.user.sub) return res.status(404).json({ error: 'Règle introuvable' });
  await prisma.inboxRule.delete({ where: { id } });
  res.json({ message: 'Règle supprimée' });
});

router.post('/rules/:id/test', async (req, res) => {
  const id = Number(req.params.id);
  const rule = await prisma.inboxRule.findUnique({ where: { id } });
  if (!rule || rule.createdById !== req.user.sub) return res.status(404).json({ error: 'Règle introuvable' });
  const { matchRuleAgainstEmails } = require('../services/inboxRuleEngine');
  const count = await matchRuleAgainstEmails(rule);
  res.json({ matchCount: count });
});

// Appliquer une règle sur tous les emails existants (rétroactif)
router.post('/rules/:id/apply', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rule = await prisma.inboxRule.findUnique({ where: { id } });
    if (!rule || rule.createdById !== req.user.sub) return res.status(404).json({ error: 'Règle introuvable' });
    const { evaluateRule, applyRuleAction } = require('../services/inboxRuleEngine');
    const emails = await prisma.incomingEmail.findMany({
      where: { status: 'DONE' },
      orderBy: { receivedAt: 'desc' },
      take: 5000,
    });
    let applied = 0;
    for (const email of emails) {
      if (evaluateRule(rule, email)) {
        await applyRuleAction(rule, email.id);
        applied++;
      }
    }
    res.json({ applied, total: emails.length });
  } catch (err) {
    console.error('[inbox/rules/apply] Erreur:', err.message, err.stack);
    return res.status(500).json({ error: err.message, stack: err.stack, errorDetail: err.errorDetail || null });
  }
});

// Détail complet d'un fil de conversation (corps HTML + jambes envoyées/reçues)
// Doit être déclaré AVANT la route '/:id' pour que "thread" ne soit pas capté par celle-ci.
router.get('/thread', async (req, res) => {
  const key = req.query.key;
  if (!key) return res.status(400).json({ error: 'Paramètre key requis' });
  const scope = await buildEmailScope(req.user);
  const thread = await getThread(key, scope);
  if (!thread) return res.status(404).json({ error: 'Conversation introuvable' });
  res.json(thread);
});

// Détail d'un email reçu
router.get('/:id', async (req, res) => {
  const scope = await buildEmailScope(req.user);
  const item = await prisma.incomingEmail.findFirst({
    where: { id: Number(req.params.id), ...(scope || {}) },
  });
  if (!item) return res.status(404).json({ error: 'Email introuvable' });
  res.json(item);
});

// Déclenche manuellement un cycle de polling + pipeline IA (ADMIN/TECHNICIAN)
router.post('/sync', requirePermission('inbox.sync', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  try {
    const results = await runEmailPipeline();
    res.json({ processed: results.length, results });
  } catch (err) {
    res.status(502).json({ error: err.message, errorDetail: err.errorDetail || null });
  }
});

// Test : analyse un email fictif sans créer de ticket (pour vérifier que Gemini fonctionne)
router.post('/test-analyze', requirePermission('inbox.sync', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const { subject, body, from, fromName } = req.body;
  if (!subject || !body) return res.status(400).json({ error: 'subject et body sont requis' });
  try {
    const analysis = await analyzeEmail({ subject, body, from: from || 'test@example.com', fromName });
    res.json(analysis);
  } catch (err) {
    res.status(502).json({ error: err.message, errorDetail: err.errorDetail || null });
  }
});

// Simulation complète du pipeline email (sans Outlook connecté) — crée un vrai ticket
router.post('/simulate', requirePermission('inbox.sync', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const { subject, body, from, fromName, conversationId, cc, simulatedAttachments } = req.body;
  if (!subject || !body) return res.status(400).json({ error: 'subject et body sont requis' });

  // Utiliser le premier compte email disponible pour la simulation
  const realAccount = await prisma.emailAccount.findFirst({ where: { isActive: true } });
  const fakeAccount = realAccount || { id: 1, emailAddress: 'simulation@ia-hub.local', label: 'Simulation' };

  // Message Graph fictif
  const fakeMessage = {
    id: `SIM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    subject,
    bodyPreview: body.substring(0, 255),
    body: { content: body, contentType: 'text' },
    from: { emailAddress: { address: from || 'utilisateur@test.com', name: fromName || 'Utilisateur Test' } },
    ccRecipients: Array.isArray(cc) ? cc.map((addr) => ({ emailAddress: { address: addr } })) : [],
    receivedDateTime: new Date().toISOString(),
    conversationId: conversationId || `SIM-CONV-${Date.now()}`,
    internetMessageId: null,
    inReplyTo: null,
    references: null,
    simulatedAttachments: Array.isArray(simulatedAttachments) ? simulatedAttachments : undefined,
  };

  try {
    const result = await processMessage(fakeMessage, fakeAccount);
    res.json({
      message: 'Pipeline simulé avec succès',
      incomingEmail: result,
      ticketId: result?.erpTicketId,
      glpiTicketId: result?.glpiTicketId,
    });
  } catch (err) {
    res.status(502).json({ error: err.message, errorDetail: err.errorDetail || null });
  }
});

// Réimport d'emails par plage de dates depuis Microsoft Graph.
// Les emails déjà traités (graphMessageId existant dans IncomingEmail) sont ignorés — pas de doublons.
router.post(
  '/reimport',
  requirePermission('inbox.sync', ['ADMIN', 'TECHNICIAN']),
  [
    body('dateFrom').optional({ nullable: true }).isISO8601().withMessage('Format YYYY-MM-DD requis'),
    body('dateTo').optional({ nullable: true }).isISO8601().withMessage('Format YYYY-MM-DD requis'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { dateFrom, dateTo } = req.body;
    try {
      const accounts = await prisma.emailAccount.findMany({
        where: { provider: 'OUTLOOK', isActive: true, refreshToken: { not: null } },
      });

      if (accounts.length === 0) {
        return res.status(422).json({ error: 'Aucun compte Outlook actif configuré' });
      }

      let totalFetched = 0;
      let totalProcessed = 0;
      let totalSkipped = 0;
      const accountResults = [];

      for (const account of accounts) {
        const messages = await fetchEmailsByDateRange(account, dateFrom, dateTo);
        totalFetched += messages.length;

        let processed = 0;
        let skipped = 0;

        for (const msg of messages) {
          const existing = await prisma.incomingEmail.findUnique({ where: { graphMessageId: msg.id } });
          if (existing) {
            skipped++;
            continue;
          }
          try {
            await processMessage(msg, account);
            processed++;
          } catch (err) {
            console.error(`[inbox/reimport] Erreur traitement email ${msg.id}:`, err.message);
          }
        }

        totalProcessed += processed;
        totalSkipped += skipped;
        accountResults.push({
          account: account.emailAddress,
          fetched: messages.length,
          processed,
          skipped,
        });
      }

      return res.json({ totalFetched, totalProcessed, totalSkipped, accounts: accountResults });
    } catch (err) {
      return res.status(502).json({ error: err.message || 'Erreur de réimport emails' });
    }
  }
);

// ── Relancer les emails DEAD_LETTER / ERROR, avec plage de dates optionnelle ──
// Body optionnel : { from?: ISO, to?: ISO } — filtre sur receivedAt (inclusif)
// ⚠️ Doit être AVANT /:id/retry pour éviter le conflit de route
router.post('/retry-all', requirePermission('inbox.sync', ['ADMIN']), async (req, res) => {
  try {
    const { from, to } = req.body || {};

    // Filtre temporel optionnel (plage de dates couvrant toute la journée côté client)
    const receivedAt = {};
    if (from) {
      const dFrom = new Date(from);
      if (!Number.isNaN(dFrom.getTime())) receivedAt.gte = dFrom;
    }
    if (to) {
      const dTo = new Date(to);
      if (!Number.isNaN(dTo.getTime())) receivedAt.lte = dTo;
    }

    const where = { status: { in: ['DEAD_LETTER', 'ERROR'] } };
    if (Object.keys(receivedAt).length > 0) where.receivedAt = receivedAt;

    const failed = await prisma.incomingEmail.findMany({
      where,
      orderBy: { receivedAt: 'asc' },
    });

    const rangeLabel = Object.keys(receivedAt).length > 0
      ? ` sur la période du ${new Date(receivedAt.gte).toLocaleDateString('fr-FR')} au ${new Date(receivedAt.lte || Date.now()).toLocaleDateString('fr-FR')}`
      : '';

    if (failed.length === 0) return res.json({ message: `Aucun email en erreur à relancer${rangeLabel}`, retried: 0, errors: 0, total: 0 });

    let retried = 0;
    let errors = 0;

    for (const incoming of failed) {
      try {
        const account = await prisma.emailAccount.findUnique({ where: { id: incoming.emailAccountId } });
        if (!account) { errors++; continue; }

        const message = {
          id: incoming.graphMessageId,
          from: { emailAddress: { address: incoming.fromEmail, name: incoming.fromName || '' } },
          subject: incoming.subject,
          bodyPreview: incoming.bodyPreview,
          body: { content: incoming.bodyHtml || '' },
          receivedDateTime: incoming.receivedAt?.toISOString?.() || new Date().toISOString(),
          conversationId: incoming.conversationId,
          internetMessageId: incoming.internetMessageId,
          hasAttachments: incoming.hasAttachments,
          toRecipients: [],
          ccRecipients: (incoming.ccRecipients || []).map(e => ({ emailAddress: { address: e } })),
          internetMessageHeaders: [],
        };

        await prisma.incomingEmail.update({
          where: { id: incoming.id },
          data: { status: 'PROCESSING', error: null, lastError: null, retryCount: 0 },
        });

        const { processMessage: pm } = require('../services/emailPipeline');
        await pm(message, account);
        retried++;
      } catch (err) {
        console.error(`[inbox/retry-all] Erreur email #${incoming.id}:`, err.message);
        errors++;
      }
    }

    return res.json({
      message: `${retried} email(s) relancé(s)${rangeLabel}, ${errors} erreur(s)`,
      retried,
      errors,
      total: failed.length,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erreur lors du relancement groupé', errorDetail: err.errorDetail || null });
  }
});

// ── Relancer un email en erreur / DEAD_LETTER ────────────────────────────────
router.post('/:id/retry', requirePermission('inbox.sync', ['ADMIN']), async (req, res) => {
  try {
    const incoming = await prisma.incomingEmail.findUnique({ where: { id: Number(req.params.id) } });
    if (!incoming) return res.status(404).json({ error: 'Email introuvable' });
    if (!['ERROR', 'DEAD_LETTER', 'RETRY'].includes(incoming.status)) {
      return res.status(400).json({ error: `Impossible de relancer un email en statut « ${incoming.status} »` });
    }

    // Trouver le compte email associé
    const account = await prisma.emailAccount.findUnique({ where: { id: incoming.emailAccountId } });
    if (!account) return res.status(400).json({ error: 'Compte email associé introuvable' });

    // Reconstruire un objet message minimal pour reprocessMessage
    const message = {
      id: incoming.graphMessageId,
      from: { emailAddress: { address: incoming.fromEmail, name: incoming.fromName || '' } },
      subject: incoming.subject,
      bodyPreview: incoming.bodyPreview,
      body: { content: incoming.bodyHtml || '' },
      receivedDateTime: incoming.receivedAt?.toISOString?.() || new Date().toISOString(),
      conversationId: incoming.conversationId,
      internetMessageId: incoming.internetMessageId,
      hasAttachments: incoming.hasAttachments,
      toRecipients: [],
      ccRecipients: (incoming.ccRecipients || []).map(e => ({ emailAddress: { address: e } })),
      internetMessageHeaders: [],
    };

    // Réinitialiser le statut pour que processMessage le traite à nouveau
    await prisma.incomingEmail.update({
      where: { id: incoming.id },
      data: { status: 'PROCESSING', error: null, lastError: null, retryCount: 0 },
    });

    const { processMessage: pm } = require('../services/emailPipeline');
    const result = await pm(message, account);

    return res.json({ message: 'Email relancé avec succès', status: result?.status, id: result?.id });
  } catch (err) {
    console.error('[inbox/retry] Erreur:', err.message);
    return res.status(500).json({ error: err.message || 'Erreur lors du relancement', errorDetail: err.errorDetail || null });
  }
});

module.exports = router;
