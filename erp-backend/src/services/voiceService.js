const prisma = require('../prismaClient');
const { getBreaker } = require('../utils/circuitBreaker');
const { logger } = require('../utils/logger');

// ── Circuit breaker dédié au vocal ────────────────────────────────────
const voiceBreaker = getBreaker('ai-voice', { maxFailures: 5, resetTimeoutMs: 30000, halfOpenMaxRequests: 1 });

// ── Récupérer le provider Gemini actif + clé ──────────────────────────
async function getGeminiConfig() {
  const provider = await prisma.aiProvider.findFirst({
    where: { name: 'gemini', isActive: true, isDeleted: false },
    include: {
      keys: { where: { isActive: true }, orderBy: { isDefault: 'desc' } },
      models: { where: { isActive: true, isDeleted: false }, orderBy: { isDefault: 'desc' } },
    },
  });
  if (!provider || provider.keys.length === 0) {
    throw new Error('Aucun provider Gemini actif configuré. Ajoutez une clé API Gemini dans Paramètres > Providers IA.');
  }
  const apiKey = provider.keys[0].apiKey;
  const baseUrl = provider.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  return { provider, apiKey, baseUrl };
}

// ── STT : Transcription audio → texte ─────────────────────────────────
// Accepte un buffer audio (WebM, WAV, MP3, OGG, etc.) et retourne le texte transcrit.
async function transcribeAudio(audioBuffer, mimeType = 'audio/webm') {
  return voiceBreaker.call(async () => {
    const { apiKey, baseUrl } = await getGeminiConfig();

    // Modèle Gemini pour la transcription (gemini-3.5-flash, stable et rapide)
    const model = 'gemini-3.5-flash';

    const audioBase64 = Buffer.isBuffer(audioBuffer)
      ? audioBuffer.toString('base64')
      : Buffer.from(audioBuffer).toString('base64');

    const payload = {
      contents: [{
        parts: [
          {
            text: 'Transcris cet audio en texte exactement tel qu\'il est dit. Si c\'est en français, garde le français. Retourne UNIQUEMENT le texte transcrit, sans guillemets, sans commentaire, sans astérisque.',
          },
          {
            inlineData: {
              mimeType,
              data: audioBase64,
            },
          },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingBudget: 0 },
      },
    };

    logger.info(`[voice] STT request — mime=${mimeType}, size=${audioBase64.length} b64 chars`);

    const res = await fetch(`${baseUrl}/models/${model}:generateContent`, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const bodyText = await res.text();
      logger.error(`[voice] STT error ${res.status}: ${bodyText.substring(0, 500)}`);
      throw new Error(`Gemini STT error: ${res.status}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    logger.info(`[voice] STT result: "${text.substring(0, 100)}"`);
    return { text };
  });
}

// ── TTS : Texte → audio synthétisé ────────────────────────────────────
// Retourne { audio: base64, mimeType: 'audio/wav', sampleRate: 24000 }
async function synthesizeAudio(text, voiceName = 'Kore') {
  return voiceBreaker.call(async () => {
    const { apiKey, baseUrl } = await getGeminiConfig();

    // Modèle TTS dédié Gemini
    const model = 'gemini-2.5-flash-preview-tts';

    const payload = {
      contents: [{
        parts: [{ text }],
      }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName,
            },
          },
        },
      },
    };

    logger.info(`[voice] TTS request — voice="${voiceName}", textLen=${text.length}`);

    const res = await fetch(`${baseUrl}/models/${model}:generateContent`, {
      method: 'POST',
      signal: AbortSignal.timeout(60000),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const bodyText = await res.text();
      logger.error(`[voice] TTS error ${res.status}: ${bodyText.substring(0, 500)}`);
      throw new Error(`Gemini TTS error: ${res.status}`);
    }

    const data = await res.json();
    const audioPart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);

    if (!audioPart?.inlineData?.data) {
      logger.error('[voice] TTS: no audio data in response', JSON.stringify(data).substring(0, 500));
      throw new Error('Aucune donnée audio retournée par Gemini TTS');
    }

    const sampleRate = 24000; // Gemini TTS sort du PCM 16-bit 24kHz mono
    logger.info(`[voice] TTS success — ${audioPart.inlineData.data.length} b64 chars`);

    return {
      audio: audioPart.inlineData.data,
      mimeType: 'audio/pcm',
      sampleRate,
      encoding: 'pcm_s16le',
    };
  });
}

// ── Voices : liste des voix disponibles ────────────────────────────────
const AVAILABLE_VOICES = [
  { name: 'Kore', label: 'Kore (Ferme)', style: 'Ferme et posée' },
  { name: 'Puck', label: 'Puck (Enthousiaste)', style: 'Enthousiaste et dynamique' },
  { name: 'Charon', label: 'Charon (Informatif)', style: 'Informatif et neutre' },
  { name: 'Fenrir', label: 'Fenrir (Excité)', style: 'Excité et énergique' },
  { name: 'Leda', label: 'Leda (Jeune)', style: 'Jeune et légère' },
  { name: 'Orus', label: 'Orus (Ferme)', style: 'Ferme et direct' },
  { name: 'Aoede', label: 'Aoede (Décontracté)', style: 'Décontracté et naturel' },
  { name: 'Callirrhoe', label: 'Callirrhoe (Facile)', style: 'Facile et amical' },
  { name: 'Autonoe', label: 'Autonoe (Clair)', style: 'Clair et vif' },
  { name: 'Enceladus', label: 'Enceladus (Respirant)', style: 'Respirant et doux' },
  { name: 'Iapetus', label: 'Iapetus (Clair)', style: 'Clair et précis' },
  { name: 'Umbriel', label: 'Umbriel (Facile)', style: 'Facile et naturel' },
  { name: 'Algieba', label: 'Algieba (Doux)', style: 'Doux et fluide' },
  { name: 'Despina', label: 'Despina (Doux)', style: 'Doux et agréable' },
  { name: 'Erinome', label: 'Erinome (Clair)', style: 'Clair et net' },
  { name: 'Sulafat', label: 'Sulafat (Chaleureux)', style: 'Chaleureux et accueillant' },
];

function getAvailableVoices() {
  return AVAILABLE_VOICES;
}

module.exports = {
  transcribeAudio,
  synthesizeAudio,
  getAvailableVoices,
};
