const prisma = require('../prismaClient');

async function getGeminiKey() {
  const provider = await prisma.aiProvider.findUnique({
    where: { name: 'gemini' },
    include: { keys: { where: { isActive: true } } },
  });
  if (!provider || !provider.isActive) return null;
  const key = provider.keys.find((k) => k.isDefault) || provider.keys[0];
  return key?.apiKey || null;
}

// Analyse l'intention d'un email de réponse utilisateur sur un ticket existant.
// Retourne : RESOLVED | STILL_PRESENT | NEW_INFO | QUESTION | REOPEN | UNKNOWN
async function analyzeIntent({ subject, body, ticketTitle, ticketSummary }) {
  const apiKey = await getGeminiKey();
  if (!apiKey) return 'UNKNOWN';

  const prompt = `Tu es un agent ITSM. Analyse ce message de réponse utilisateur concernant un ticket de support.

Contexte du ticket :
- Titre : ${ticketTitle}
- Résumé : ${ticketSummary || 'Non disponible'}

Message reçu :
Sujet : ${subject}
Contenu : ${body?.substring(0, 1000) || ''}

Retourne UNIQUEMENT un de ces codes (sans explication) :
- RESOLVED : l'utilisateur confirme que le problème est résolu
- STILL_PRESENT : le problème persiste
- NEW_INFO : l'utilisateur ajoute des informations utiles
- QUESTION : l'utilisateur pose une question
- REOPEN : l'utilisateur signale que le problème est réapparu après résolution
- UNKNOWN : intention non déterminable`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 20, thinkingConfig: { thinkingBudget: 0 } },
      }),
    }
  );

  if (!res.ok) return 'UNKNOWN';
  const data = await res.json();
  const raw = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim().toUpperCase();
  const valid = ['RESOLVED', 'STILL_PRESENT', 'NEW_INFO', 'QUESTION', 'REOPEN', 'UNKNOWN'];
  return valid.find((v) => raw.includes(v)) || 'UNKNOWN';
}

// Applique les changements de statut selon l'intention détectée
async function applyIntentActions(ticketId, intent, actor = 'AI') {
  const { logEvent } = require('./ticketEvent');

  const updates = {};
  if (intent === 'RESOLVED') {
    updates.status = 'SOLVED';
    updates.solvedAt = new Date();
  } else if (intent === 'STILL_PRESENT' || intent === 'NEW_INFO') {
    updates.status = 'OPEN';
    updates.lastUserReplyAt = new Date();
    updates.reminderCount = 0;
    updates.reminderSentAt = null;
  } else if (intent === 'REOPEN') {
    updates.status = 'OPEN';
    updates.closedAt = null;
    updates.lastUserReplyAt = new Date();
    updates.reminderCount = 0;
    await logEvent(ticketId, 'REOPENED', actor, { intent });
  } else if (intent === 'QUESTION' || intent === 'UNKNOWN') {
    updates.status = 'WAITING_FOR_USER';
    updates.lastUserReplyAt = new Date();
  }

  if (Object.keys(updates).length > 0) {
    await prisma.ticket.update({ where: { id: ticketId }, data: updates });
    await logEvent(ticketId, 'STATUS_CHANGED', actor, { intent, newStatus: updates.status });
  }

  return intent;
}

module.exports = { analyzeIntent, applyIntentActions };
