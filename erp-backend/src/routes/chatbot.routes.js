const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { handleMessage } = require('../services/chatbotService');

const router = Router();

// POST /api/chat — envoie un message au chatbot et retourne la réponse
router.post('/', authenticate, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Le message ne peut pas être vide.' });
    }

    const result = await handleMessage(message.trim(), history, req.user.sub);
    res.json(result);
  } catch (err) {
    console.error('[chatbot] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur interne du chatbot.' });
  }
});

module.exports = router;
