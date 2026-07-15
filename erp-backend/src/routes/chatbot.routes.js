const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { handleMessage } = require('../services/chatbotService');
const prisma = require('../prismaClient');

const router = Router();

// POST /api/chat — envoie un message et retourne la réponse
router.post('/', authenticate, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Le message ne peut pas être vide.' });
    }

    // Sauvegarder le message utilisateur
    await prisma.chatMessage.create({
      data: { userId: req.user.sub, role: 'user', content: message.trim() },
    });

    const result = await handleMessage(message.trim(), history, req.user.sub);

    // Sauvegarder la réponse assistant
    await prisma.chatMessage.create({
      data: {
        userId: req.user.sub,
        role: 'assistant',
        content: result.reply,
        sources: result.sources || [],
      },
    });

    res.json(result);
  } catch (err) {
    console.error('[chatbot] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur interne du chatbot.' });
  }
});

// GET /api/chat/history — récupère l'historique de conversation
router.get('/history', authenticate, async (req, res) => {
  try {
    const messages = await prisma.chatMessage.findMany({
      where: { userId: req.user.sub },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Erreur de chargement.' });
  }
});

// POST /api/chat/feedback — enregistre le rating d'un message
router.post('/feedback', authenticate, async (req, res) => {
  try {
    const { messageId, rating } = req.body;
    if (!messageId || ![1, -1].includes(rating)) {
      return res.status(400).json({ error: 'Paramètres invalides.' });
    }

    await prisma.chatMessage.updateMany({
      where: { id: messageId, userId: req.user.sub, role: 'assistant' },
      data: { rating },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur.' });
  }
});

module.exports = router;
