const express = require('express');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { generateKnowledgeDraft } = require('../services/knowledgeDraftGenerator');
const { summarizeTicketThread } = require('../services/ticketThreadSummarizer');
const { runReminderScheduler } = require('../services/reminderScheduler');
const { logEvent } = require('../services/ticketEvent');
const { searchKnowledge } = require('../services/knowledgeSearch');
const { getSystemSettings } = require('../services/systemSettings');
const { runTechnicianReminderScheduler } = require('../services/technicianReminderScheduler');

const router = express.Router();
router.use(authenticate);

// Un demandeur n'accède qu'aux messages/événements/assistance de ses propres tickets (404 = masque l'existence)
async function assertRequesterOwnsTicket(user, ticketId) {
  if (user.role !== 'REQUESTER') return true;
  const ticket = await prisma.ticket.findFirst({
    where: { id: Number(ticketId), requesterId: user.sub },
    select: { id: true },
  });
  return !!ticket;
}

// Historique complet des messages d'un ticket
router.get('/tickets/:id/messages', async (req, res) => {
  if (!(await assertRequesterOwnsTicket(req.user, req.params.id))) {
    return res.status(404).json({ error: 'Ticket introuvable' });
  }
  const messages = await prisma.ticketMessage.findMany({
    where: { ticketId: Number(req.params.id) },
    orderBy: { timestamp: 'asc' },
  });
  res.json(messages);
});

// Journal d'audit d'un ticket
router.get('/tickets/:id/events', async (req, res) => {
  if (!(await assertRequesterOwnsTicket(req.user, req.params.id))) {
    return res.status(404).json({ error: 'Ticket introuvable' });
  }
  const events = await prisma.ticketEvent.findMany({
    where: { ticketId: Number(req.params.id) },
    orderBy: { createdAt: 'desc' },
  });
  res.json(events);
});

// Assistance IA pour un ticket : analyse + incidents similaires + actions recommandées
router.get('/tickets/:id/intelligence', async (req, res) => {
  if (!(await assertRequesterOwnsTicket(req.user, req.params.id))) {
    return res.status(404).json({ error: 'Ticket introuvable' });
  }
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

// Résumer les échanges et commentaires d'un ticket, rédigés comme un suivi.
// Le texte est renvoyé tel quel : c'est le front qui le propose dans l'éditeur
// de suivi, l'utilisateur relit et valide — rien n'est écrit en base ici.
router.post('/tickets/:id/summarize-thread', async (req, res) => {
  if (!(await assertRequesterOwnsTicket(req.user, req.params.id))) {
    return res.status(404).json({ error: 'Ticket introuvable' });
  }
  try {
    const result = await summarizeTicketThread({ ticketId: Number(req.params.id) });
    res.json(result);
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
  res.json(config || { autoCloseDays: 15, isActive: true });
});

router.put('/reminders/config', requirePermission('automation.manage', ['ADMIN']), async (req, res) => {
  const { autoCloseDays, firstReminderDays, secondReminderDays, preCloseDays, isActive } = req.body;
  const existing = await prisma.reminderConfig.findFirst();
  const data = { autoCloseDays };
  // Délais optionnels des relances (J+2 / J+5 / pré-clôture par défaut) — ignorés silencieusement
  // avant, ce qui empêchait toute personnalisation depuis les Paramètres.
  if (firstReminderDays !== undefined) data.firstReminderDays = firstReminderDays;
  if (secondReminderDays !== undefined) data.secondReminderDays = secondReminderDays;
  if (preCloseDays !== undefined) data.preCloseDays = preCloseDays;
  if (isActive !== undefined) data.isActive = isActive;
  const config = existing
    ? await prisma.reminderConfig.update({ where: { id: existing.id }, data })
    : await prisma.reminderConfig.create({ data: { ...data, isActive: isActive !== undefined ? isActive : true } });
  res.json(config);
});

// ── Rappels techniciens (Paramètres > Automatisation) ──────────────────────
// Lecture/écriture de l'envoi d'email aux techniciens (ou à leur équipe) quand un
// ticket ouvert dépasse le délai configuré (ex. 24 h) sans prise en charge. Les
// valeurs vivent dans SystemSettings : le scheduler les relit à chaque passe, un
// changement s'applique donc sans redémarrage.
const TECH_REMINDER_FIELDS = {
  techReminderEnabled: { type: 'boolean' },
  techReminderDelayHours: { type: 'int', min: 1, max: 720 },
  techReminderRepeatHours: { type: 'int', min: 0, max: 720 },
  techReminderOnNoActivity: { type: 'boolean' },
  techReminderOnUnassigned: { type: 'boolean' },
};

function pickTechReminderConfig(settings) {
  const out = {};
  for (const [key, def] of Object.entries(TECH_REMINDER_FIELDS)) {
    out[key] = settings?.[key] ?? (def.type === 'boolean' ? false : def.min);
  }
  return out;
}

router.get('/reminders/technician-config', requirePermission('automation.manage', ['ADMIN']), async (req, res) => {
  res.json(pickTechReminderConfig(await getSystemSettings()));
});

router.put('/reminders/technician-config', requirePermission('automation.manage', ['ADMIN']), async (req, res) => {
  const data = {};
  for (const [key, def] of Object.entries(TECH_REMINDER_FIELDS)) {
    const value = req.body?.[key];
    if (value === undefined) continue;
    if (def.type === 'boolean') {
      data[key] = !!value;
    } else {
      // Hors bornes ou NaN : on refuse plutôt que d'enregistrer une valeur que le
      // scheduler interpréterait autrement que ce que l'admin a vu à l'écran.
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed < def.min || parsed > def.max) {
        return res.status(400).json({ error: `${key} doit être compris entre ${def.min} et ${def.max}` });
      }
      data[key] = parsed;
    }
  }
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'Aucun réglage de rappel technicien à sauvegarder' });
  }
  const settings = await prisma.systemSettings.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
  res.json(pickTechReminderConfig(settings));
});

// Exécution manuelle (bouton « Lancer maintenant » des Paramètres) — même moteur que le cron.
router.post('/reminders/run-technician', requirePermission('automation.manage', ['ADMIN']), async (req, res) => {
  try {
    const results = await runTechnicianReminderScheduler();
    res.json({ processed: results.length, results });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
