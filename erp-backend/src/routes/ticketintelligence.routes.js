const express = require('express');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { generateKnowledgeDraft } = require('../services/knowledgeDraftGenerator');
const { runReminderScheduler } = require('../services/reminderScheduler');
const { logEvent } = require('../services/ticketEvent');
const { searchKnowledge } = require('../services/knowledgeSearch');

const router = express.Router();
router.use(authenticate);

// Historique complet des messages d'un ticket
router.get('/tickets/:id/messages', async (req, res) => {
  const messages = await prisma.ticketMessage.findMany({
    where: { ticketId: Number(req.params.id) },
    orderBy: { timestamp: 'asc' },
  });
  res.json(messages);
});

// Journal d'audit d'un ticket
router.get('/tickets/:id/events', async (req, res) => {
  const events = await prisma.ticketEvent.findMany({
    where: { ticketId: Number(req.params.id) },
    orderBy: { createdAt: 'desc' },
  });
  res.json(events);
});

// Assistance IA pour un ticket : analyse + incidents similaires + actions recommandées
router.get('/tickets/:id/intelligence', async (req, res) => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: Number(req.params.id) },
    include: { messages: { orderBy: { timestamp: 'asc' }, take: 10 }, followups: true },
  });
  if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

  // Recherche dans la base de connaissances
  let similar = [];
  try {
    similar = await searchKnowledge(ticket.title + ' ' + (ticket.aiSummary || ticket.content?.substring(0, 200)));
  } catch {
    similar = [];
  }

  res.json({
    summary: ticket.aiSummary,
    category: ticket.category,
    priority: ticket.priority,
    similarKnowledge: similar.slice(0, 3),
    messageCount: ticket.messages.length,
    lastActivity: ticket.lastUserReplyAt || ticket.updatedAt,
  });
});

// Générer un KnowledgeDraft depuis un ticket résolu
router.post('/tickets/:id/generate-knowledge', requirePermission('knowledge.manage', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const { resolutionNote } = req.body;
  try {
    const draft = await generateKnowledgeDraft({
      ticketId: Number(req.params.id),
      resolutionNote,
      technicianEmail: req.user?.email,
    });
    res.json(draft);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Lancer manuellement le scheduler de relances
router.post('/reminders/run', requirePermission('automation.manage', ['ADMIN']), async (req, res) => {
  try {
    const results = await runReminderScheduler();
    res.json({ processed: results.length, results });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Obtenir / mettre à jour la config des relances — findFirst() sans filtre isActive (pas
// findFirst({ where: { isActive: true } })) pour que l'admin puisse voir et réactiver une config
// qu'il a précédemment désactivée, au lieu d'en recréer une nouvelle qui écraserait ses délais personnalisés.
router.get('/reminders/config', requirePermission('automation.manage', ['ADMIN']), async (req, res) => {
  const config = await prisma.reminderConfig.findFirst();
  res.json(config || { firstReminderDays: 2, secondReminderDays: 5, preCloseDays: 10, autoCloseDays: 15, isActive: true });
});

router.put('/reminders/config', requirePermission('automation.manage', ['ADMIN']), async (req, res) => {
  const { firstReminderDays, secondReminderDays, preCloseDays, autoCloseDays, isActive } = req.body;
  const existing = await prisma.reminderConfig.findFirst();
  const data = { firstReminderDays, secondReminderDays, preCloseDays, autoCloseDays };
  if (isActive !== undefined) data.isActive = isActive;
  const config = existing
    ? await prisma.reminderConfig.update({ where: { id: existing.id }, data })
    : await prisma.reminderConfig.create({ data: { ...data, isActive: isActive !== undefined ? isActive : true } });
  res.json(config);
});

module.exports = router;
