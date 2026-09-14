const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');

const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// ── Liste des notifications ────────────────────────────────────────────────
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
      prisma.notification.count({ where: { userId, isRead: false } }),
      prisma.notification.count({ where: { userId } }),
    ]);

    res.json({ ok: true, notifications, unreadCount, total, hasMore: offset + limit < total });
  } catch (err) {
    console.error('[notifications] Erreur liste:', err.message);
    res.status(500).json({ ok: false, error: 'Erreur lors du chargement' });
  }
});

// ── Supprimer TOUTES les notifications (AVANT /:id pour éviter le matching) ─
router.delete('/all', async (req, res) => {
  try {
    const userId = req.user.sub;
    const result = await prisma.notification.deleteMany({ where: { userId } });
    res.json({ ok: true, deleted: result.count });
  } catch (err) {
    console.error('[notifications] Erreur suppression toutes:', err.message);
    res.status(500).json({ ok: false, error: 'Erreur lors de la suppression' });
  }
});

// ── Marquer toutes comme lues ─────────────────────────────────────────────
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

// ── Marquer une notification comme lue ─────────────────────────────────────
router.patch('/:id/read', async (req, res) => {
  try {
    const userId = req.user.sub;
    const id = Number(req.params.id);
    const notification = await prisma.notification.findFirst({ where: { id, userId } });
    if (!notification) return res.status(404).json({ ok: false, error: 'Introuvable' });
    await prisma.notification.update({ where: { id }, data: { isRead: true } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[notifications] Erreur marquage lu:', err.message);
    res.status(500).json({ ok: false, error: 'Erreur lors du marquage' });
  }
});

// ── Supprimer une notification ─────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user.sub;
    const id = Number(req.params.id);
    const notification = await prisma.notification.findFirst({ where: { id, userId } });
    if (!notification) return res.status(404).json({ ok: false, error: 'Introuvable' });
    await prisma.notification.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[notifications] Erreur suppression:', err.message);
    res.status(500).json({ ok: false, error: 'Erreur lors de la suppression' });
  }
});

module.exports = router;
