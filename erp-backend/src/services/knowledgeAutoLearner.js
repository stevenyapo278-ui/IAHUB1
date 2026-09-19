const prisma = require('../prismaClient');
const { generateKnowledgeDraft } = require('./knowledgeDraftGenerator');

const SIMILARITY_THRESHOLD = 0.70;
const STOPWORDS = new Set([
  'le','la','les','de','du','des','un','une','et','est','en','au','aux','sur','par',
  'pour','que','qui','ne','pas','plus','je','il','nous','vous','ils','bonjour','merci',
  'depuis','ce','notre','mon','ma','mes','son','sa','ses','avec','cette','tout','tous',
  'etre','avoir','faire','pouvoir','vouloir','savoir','aller','venir','dire','voir',
  'comme','aussi','bien','tres','mais','ou','donc','car','si','peut','fait','ete',
  'avait','ont','sont','undefined','null',
]);

function extractKeywords(text) {
  return new Set(
    (text || '')
      .toLowerCase()
      .replace(/[^a-z\u00e0\u00e4\u00e8\u00ea\u00eb\u00ee\u00ef\u00f4\u00f9\u00fb\u00fc\u00e7\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w))
  );
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1;
  const inter = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : inter / union;
}

async function findSimilarDraft(ticketTitle, ticketContent, excludeTicketId) {
  const keywords = extractKeywords(`${ticketTitle} ${ticketContent}`);

  const recentDrafts = await prisma.knowledgeDraft.findMany({
    where: {
      status: { in: ['PENDING', 'APPROVED'] },
      createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    include: {
      ticket: { select: { id: true, title: true, content: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  for (const draft of recentDrafts) {
    if (draft.ticketId === excludeTicketId) continue;

    const draftKeywords = extractKeywords(`${draft.title} ${draft.problem} ${draft.solution}`);
    const similarity = jaccardSimilarity(keywords, draftKeywords);

    if (similarity >= SIMILARITY_THRESHOLD) {
      return { draft, similarity, method: 'keyword' };
    }
  }

  return null;
}

async function autoLearnFromResolution(ticketId, technicianEmail) {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true, title: true, content: true, category: true,
        priority: true, status: true, assignedToId: true,
      },
    });

    if (!ticket) {
      console.log(`[knowledgeAutoLearner] Ticket ${ticketId} introuvable -> ignore`);
      return null;
    }

    if (!ticket.title || ticket.title.trim().length < 5) {
      console.log(`[knowledgeAutoLearner] Ticket ${ticketId} titre trop court -> ignore`);
      return null;
    }

    const existing = await prisma.knowledgeDraft.findFirst({ where: { ticketId } });
    if (existing) {
      console.log(`[knowledgeAutoLearner] Ticket ${ticketId} a deja un draft (#${existing.id}) -> ignore`);
      return null;
    }

    const similar = await findSimilarDraft(ticket.title, ticket.content, ticketId);
    if (similar) {
      console.log(
        `[knowledgeAutoLearner] Ticket ${ticketId} similaire au draft #${similar.draft.id} ` +
        `(similarite: ${(similar.similarity * 100).toFixed(0)}%) -> ignore`
      );
      return null;
    }

    console.log(`[knowledgeAutoLearner] Generation du draft pour ticket ${ticketId}...`);
    const draft = await generateKnowledgeDraft({
      ticketId,
      resolutionNote: null,
      technicianEmail: technicianEmail || null,
    });

    console.log(`[knowledgeAutoLearner] Draft #${draft.id} cree pour ticket ${ticketId}`);
    return draft;
  } catch (err) {
    console.error(`[knowledgeAutoLearner] Erreur ticket ${ticketId}:`, err.message);
    return null;
  }
}

module.exports = { autoLearnFromResolution, findSimilarDraft, jaccardSimilarity, extractKeywords };
