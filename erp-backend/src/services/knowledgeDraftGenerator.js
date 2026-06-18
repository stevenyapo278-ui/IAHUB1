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

// Génère automatiquement un KnowledgeDraft à partir d'un ticket résolu
async function generateKnowledgeDraft({ ticketId, resolutionNote, technicianEmail }) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { messages: { orderBy: { timestamp: 'asc' } }, followups: true },
  });
  if (!ticket) throw new Error('Ticket introuvable');

  const existing = await prisma.knowledgeDraft.findFirst({ where: { ticketId } });
  if (existing) return existing;

  const apiKey = await getGeminiKey();
  if (!apiKey) throw new Error('Aucune clé Gemini configurée');

  const history = ticket.messages
    .map((m) => `[${m.direction}] ${m.sender}: ${m.body?.substring(0, 300)}`)
    .join('\n');

  const prompt = `Tu es un expert ITSM. À partir de ce ticket résolu, génère un article de base de connaissances en JSON.

Ticket :
- Titre : ${ticket.title}
- Catégorie : ${ticket.category || 'Non définie'}
- Priorité : ${ticket.priority}
- Résumé IA : ${ticket.aiSummary || ''}
- Note de résolution du technicien : ${resolutionNote || 'Non fournie'}
- Historique échanges :
${history || ticket.content?.substring(0, 500)}

Retourne UNIQUEMENT ce JSON :
{
  "title": "titre de l'article",
  "problem": "description du problème",
  "cause": "cause identifiée",
  "solution": "solution appliquée étape par étape",
  "keywords": ["mot1", "mot2", "mot3"]
}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
      }),
    }
  );

  if (!res.ok) throw new Error(`Erreur Gemini : ${res.status}`);
  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Gemini n\'a pas retourné un JSON valide');

  const draft = JSON.parse(jsonMatch[0]);

  const { logEvent } = require('./ticketEvent');

  const created = await prisma.knowledgeDraft.create({
    data: {
      ticketId,
      title: draft.title,
      problem: draft.problem,
      cause: draft.cause,
      solution: draft.solution,
      keywords: draft.keywords || [],
      status: 'PENDING',
    },
  });

  await logEvent(ticketId, 'KNOWLEDGE_CREATED', technicianEmail || 'AI', { draftId: created.id });

  return created;
}

module.exports = { generateKnowledgeDraft };
