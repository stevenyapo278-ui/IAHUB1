// Timesheet — temps passé par technicien sur chaque ticket (module « Plan » de GLPI).
// Saisie manuelle (POST /timesheet) ou via timer start/stop (une entrée est créée à l'arrêt).
// Les timers actifs sont conservés en mémoire (process) : un redémarrage du serveur
// les perd — acceptable pour un déploiement mono-instance.

const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(authenticate);

// Timers actifs : userId → { ticketId, startedAt }
const activeTimers = new Map();

// Arrondit la durée en minutes (minimum 1 minute)
function toMinutes(ms) {
  return Math.max(1, Math.round(ms / 60000));
}

// ── Ajout manuel d'une entrée de temps ───────────────────────────────────
router.post(
  '/',
  requirePermission('tickets.timesheet'),
  [
    body('ticketId').isInt({ min: 1 }).withMessage('ticketId invalide'),
    body('minutes').isInt({ min: 1, max: 1440 }).withMessage('minutes doit être entre 1 et 1440'),
    body('description').optional().isString().isLength({ max: 2000 }),
    body('entryDate').optional().isISO8601().withMessage('entryDate invalide'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { ticketId, minutes, description } = req.body;
    const ticket = await prisma.ticket.findUnique({ where: { id: Number(ticketId) }, select: { id: true } });
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

    const entry = await prisma.ticketTimeEntry.create({
      data: {
        ticketId: Number(ticketId),
        userId: req.user.sub,
        minutes: Number(minutes),
        description: description?.trim() || null,
        entryDate: req.body.entryDate ? new Date(req.body.entryDate) : new Date(),
      },
      include: { user: { select: { id: true, fullName: true } } },
    });
    return res.status(201).json(entry);
  }
);

// ── Démarrer un timer sur un ticket ──────────────────────────────────────
router.post(
  '/timer/start',
  requirePermission('tickets.timesheet'),
  [body('ticketId').isInt({ min: 1 }).withMessage('ticketId invalide')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const ticketId = Number(req.body.ticketId);
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { id: true } });
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

    // Un seul timer actif par utilisateur : si un timer tourne déjà, on le bascule
    // sur ce ticket (le temps écoulé sur l'ancien est perdu — l'utilisateur doit arrêter d'abord).
    activeTimers.set(req.user.sub, { ticketId, startedAt: Date.now() });
    return res.json({ ok: true, ticketId, startedAt: new Date(activeTimers.get(req.user.sub).startedAt).toISOString() });
  }
);

// ── Arrêter le timer → crée l'entrée de temps ────────────────────────────
router.post(
  '/timer/stop',
  requirePermission('tickets.timesheet'),
  [body('ticketId').isInt({ min: 1 }).withMessage('ticketId invalide')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const timer = activeTimers.get(req.user.sub);
    if (!timer || timer.ticketId !== Number(req.body.ticketId)) {
      return res.status(400).json({ error: 'Aucun timer actif sur ce ticket' });
    }

    const minutes = toMinutes(Date.now() - timer.startedAt);
    activeTimers.delete(req.user.sub);

    const entry = await prisma.ticketTimeEntry.create({
      data: {
        ticketId: timer.ticketId,
        userId: req.user.sub,
        minutes,
        description: req.body.description?.trim() || null,
        entryDate: new Date(timer.startedAt),
      },
      include: { user: { select: { id: true, fullName: true } } },
    });
    return res.status(201).json(entry);
  }
);

// ── Timer actif de l'utilisateur courant (pour reprendre l'affichage) ────
router.get('/timer/active', requirePermission('tickets.timesheet'), async (req, res) => {
  const timer = activeTimers.get(req.user.sub);
  if (!timer) return res.json({ active: false });
  return res.json({ active: true, ticketId: timer.ticketId, startedAt: new Date(timer.startedAt).toISOString() });
});

// ── Liste + agrégats (total, par jour) avec filtres ──────────────────────
router.get('/', requirePermission('tickets.timesheet'), async (req, res) => {
  const ticketId = req.query.ticketId ? Number(req.query.ticketId) : undefined;
  const userId = req.query.userId ? Number(req.query.userId) : undefined;
  const from = req.query.from ? new Date(req.query.from) : undefined;
  const to = req.query.to ? new Date(req.query.to) : undefined;

  const where = {};
  if (ticketId) where.ticketId = ticketId;
  if (userId) where.userId = userId;
  if (from || to) {
    where.entryDate = {};
    if (from) where.entryDate.gte = from;
    if (to) where.entryDate.lte = to;
  }

  const entries = await prisma.ticketTimeEntry.findMany({
    where,
    orderBy: { entryDate: 'desc' },
    include: { user: { select: { id: true, fullName: true, email: true } } },
  });

  // Agrégats : total + répartition par jour
  const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);
  const byDay = new Map();
  for (const e of entries) {
    const day = e.entryDate.toISOString().slice(0, 10);
    const bucket = byDay.get(day) || { date: day, minutes: 0, count: 0 };
    bucket.minutes += e.minutes;
    bucket.count += 1;
    byDay.set(day, bucket);
  }

  return res.json({
    entries,
    totalMinutes,
    dailyBreakdown: [...byDay.values()].sort((a, b) => (a.date < b.date ? 1 : -1)),
  });
});

// ── Suppression d'une entrée (auteur ou ADMIN/SUPERADMIN) ────────────────
router.delete('/:id', requirePermission('tickets.timesheet'), async (req, res) => {
  const id = Number(req.params.id);
  const entry = await prisma.ticketTimeEntry.findUnique({ where: { id } });
  if (!entry) return res.status(404).json({ error: 'Entrée introuvable' });

  const isAuthor = entry.userId === req.user.sub;
  const isAdmin = req.user.role === 'SUPERADMIN' || req.user.role === 'ADMIN';
  if (!isAuthor && !isAdmin) return res.status(403).json({ error: 'Suppression non autorisée' });

  await prisma.ticketTimeEntry.delete({ where: { id } });
  return res.json({ ok: true });
});

module.exports = router;
