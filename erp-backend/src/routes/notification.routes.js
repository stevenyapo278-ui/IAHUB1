const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');

// Middleware d'authentification
const { authenticate } = require('../middleware/auth');

// Toutes les routes nécessitent un utilisateur authentifié
router.use(authenticate);

// ── Liste des notifications de l'utilisateur connecté ──────────────────────
// Triées par date décroissante, avec pagination (20 par page par défaut).
// Inclut le compteur des notifications non lues.
// GET /api/notifications?limit=20&offset=0
router.get('/', async (req, res) => {
  try {
    const userId = req.user.sub;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Number(req.query.offset) || 0;

    const [notifications, unreadCount, total] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.notification.count({
        where: { userId, isRead: false },
      }),
      prisma.notification.count({
        where: { userId },
      }),
    ]);

    res.json({
      ok: true,
      notifications,
      unreadCount,
      total,
      hasMore: offset + limit < total,
    });
  } catch (err) {
    console.error('[notifications] Erreur liste:', err.message);
    res.status(500).json({ ok: false, error: 'Erreur lors du chargement des notifications' });
  }
});

// ── Marquer une notification comme lue ─────────────────────────────────────
// PATCH /api/notifications/:id/read
router.patch('/:id/read', async (req, res) => {
  try {
    const userId = req.user.sub;
    const id = Number(req.params.id);

    const notification = await prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!notification) {
      return res.status(404).json({ ok: false, error: 'Notification introuvable' });
    }

    await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[notifications] Erreur marquage lu:', err.message);
    res.status(500).json({ ok: false, error: 'Erreur lors du marquage' });
  }
});

// ── Marquer toutes les notifications comme lues ────────────────────────────
// POST /api/notifications/read-all
router.post('/read-all', async (req, res) => {
  try {
    const userId = req.user.sub;

    const result = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    res.json({ ok: true, count: result.count });
  } catch (err) {
    console.error('[notifications] Erreur marquage tout lu:', err.message);
    res.status(500).json({ ok: false, error: 'Erreur lors du marquage' });
  }
});

module.exports = router;
