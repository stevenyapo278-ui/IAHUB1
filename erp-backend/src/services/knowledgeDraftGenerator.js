const prisma = require('../prismaClient');
const { getActiveProviders, callProviderWithFallback } = require('./mailAnalyzer');
const { getPrompt } = require('./promptTemplates');

// Génère automatiquement un KnowledgeDraft à partir d'un ticket résolu
async function generateKnowledgeDraft({ ticketId, resolutionNote, technicianEmail }) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { messages: { orderBy: { timestamp: 'asc' } }, followups: true },
  });
  if (!ticket) throw new Error('Ticket introuvable');

  const existing = await prisma.knowledgeDraft.findFirst({ where: { ticketId } });
  if (existing) return existing;

  const providers = await getActiveProviders();
  if (providers.length === 0) throw new Error('Aucun provider IA configuré (Paramètres → Intelligence Artificielle)');

  const history = ticket.messages
    .map((m) => `[${m.direction}] ${m.sender}: ${m.body?.substring(0, 300)}`)
    .join('\n');

  const prompt = await getPrompt('generateKnowledgeDraft', {
    title: ticket.title,
    category: ticket.category || 'Non définie',
    priority: ticket.priority,
    aiSummary: ticket.aiSummary || '',
    resolutionNote: resolutionNote || 'Non fournie',
    history: history || ticket.content?.substring(0, 500) || '',
  });

  const raw = await callProviderWithFallback(providers, prompt);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Le provider IA n'a pas retourné un JSON valide`);

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
      category: draft.category || ticket.category,
      tags: draft.tags || [],
      status: 'PENDING',
    },
  });

  await logEvent(ticketId, 'KNOWLEDGE_CREATED', technicianEmail || 'AI', { draftId: created.id });

  return created;
}

module.exports = { generateKnowledgeDraft };
