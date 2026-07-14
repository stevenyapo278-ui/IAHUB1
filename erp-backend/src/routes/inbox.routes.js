const express = require('express');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { runEmailPipeline, processMessage } = require('../services/emailPipeline');
const { analyzeEmail } = require('../services/mailAnalyzer');

const router = express.Router();
router.use(authenticate);

// Liste des emails reçus avec pagination + recherche
router.get('/', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const status = req.query.status || undefined;
  const q = req.query.q?.trim() || undefined;

  const where = {
    ...(status ? { status } : {}),
    ...(q ? {
      OR: [
        { subject: { contains: q, mode: 'insensitive' } },
        { fromEmail: { contains: q, mode: 'insensitive' } },
        { fromName: { contains: q, mode: 'insensitive' } },
      ],
    } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.incomingEmail.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.incomingEmail.count({ where }),
  ]);

  res.json({ items, total, page, pages: Math.ceil(total / limit) });
});

// Détail d'un email reçu
router.get('/:id', async (req, res) => {
  const item = await prisma.incomingEmail.findUnique({ where: { id: Number(req.params.id) } });
  if (!item) return res.status(404).json({ error: 'Email introuvable' });
  res.json(item);
});

// Déclenche manuellement un cycle de polling + pipeline IA (ADMIN/TECHNICIAN)
router.post('/sync', requirePermission('inbox.sync', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  try {
    const results = await runEmailPipeline();
    res.json({ processed: results.length, results });
  } catch (err) {
    res.status(502).json({ error: err.message });
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
    res.status(502).json({ error: err.message });
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
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
