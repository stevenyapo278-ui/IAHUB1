const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const { transcribeAudio, synthesizeAudio, getAvailableVoices } = require('../services/voiceService');
const multer = require('multer');

const router = Router();

// ── Rate limit vocal : 30 req/15min par user (STT + TTS combinés) ────
const voiceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => `voice:${req.user.sub}`,
  message: { error: 'Trop de requêtes vocales. Réessayez dans quelques minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Multer : accepter l'audio en mémoire (max 10MB) ──────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/', 'video/webm'];
    if (allowed.some((t) => file.mimetype.startsWith(t))) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non supporté. Envoyez un fichier audio (WebM, WAV, MP3, OGG).'));
    }
  },
});

// ── POST /api/voice/stt — Speech-to-Text ──────────────────────────────
router.post('/stt', authenticate, voiceLimiter, upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier audio fourni.' });
  }

  try {
    const mimeType = req.file.mimetype || 'audio/webm';
    const result = await transcribeAudio(req.file.buffer, mimeType);
    res.json(result);
  } catch (err) {
    console.error('[voice/stt] Error:', err.message);
    res.status(500).json({ error: 'Erreur lors de la transcription audio.', detail: err.message });
  }
});

// ── POST /api/voice/tts — Text-to-Speech ──────────────────────────────
router.post('/tts', authenticate, voiceLimiter, async (req, res) => {
  const { text, voiceName } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Le texte à synthétiser est requis.' });
  }

  if (text.length > 5000) {
    return res.status(400).json({ error: 'Le texte ne doit pas dépasser 5000 caractères.' });
  }

  try {
    const result = await synthesizeAudio(text.trim(), voiceName || 'Kore');
    res.json(result);
  } catch (err) {
    console.error('[voice/tts] Error:', err.message);
    res.status(500).json({ error: 'Erreur lors de la synthèse vocale.', detail: err.message });
  }
});

// ── GET /api/voice/voices — Liste des voix disponibles ────────────────
router.get('/voices', authenticate, (req, res) => {
  res.json(getAvailableVoices());
});

module.exports = router;
