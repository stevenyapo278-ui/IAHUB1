const prisma = require('../prismaClient');
const { getActiveProviders, callProviderWithFallback } = require('./mailAnalyzer');
const { generateEmbedding, toVectorLiteral } = require('../utils/embeddings');

const WINDOW_HOURS = 4;
const MAJOR_INCIDENT_THRESHOLD = 3; // nb de sites pour promouvoir en incident majeur

/**
 * Cherche un ticket ouvert récent décrivant le même incident.
 * Retourne { ticketId, ticketTitle, similarity, method } ou null.
 */
async function findSimilarOpenTicket({ subject, body, category }) {
  const windowStart = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);

  const recentTickets = await prisma.ticket.findMany({
    where: {
      status: { notIn: ['CLOSED', 'SOLVED'] },
      createdAt: { gte: windowStart },
      ...(category ? { category } : {}),
    },
    select: { id: true, title: true, aiSummary: true },
    take: 10,
  });

  if (recentTickets.length === 0) return null;

  const providers = await getActiveProviders();

  if (providers.length === 0) {
    return fallbackJaccard({ subject, body }, recentTickets);
  }

  const incomingText = `Subject: ${subject}\nDescription: ${body.substring(0, 300)}`;

  for (const ticket of recentTickets) {
    const ticketText = `Subject: ${ticket.title}\nSummary: ${ticket.aiSummary || ticket.title}`;

    const prompt = `ITSM deduplication task. Two IT helpdesk tickets — are they about the SAME underlying IT problem? They may come from different users or sites but describe the same root cause.

Ticket A: "${subject}" - "${body.substring(0, 200)}"

Ticket B: "${ticket.title}" - "${ticket.aiSummary || ticket.title}"

Same problem? Reply YES or NO only.`;

    try {
      const raw = await callProviderWithFallback(providers, prompt, 'email');
      const answer = (raw || '').trim().toUpperCase();
      if (answer && (answer.startsWith('YES') || answer.startsWith('OUI'))) {
        return { ticketId: ticket.id, ticketTitle: ticket.title, similarity: 1, method: 'SIMILAR_INCIDENT' };
      }
    } catch {
      return fallbackJaccard({ subject, body }, recentTickets);
    }
  }

  return null;
}

/**
 * Rattache un site impacté au ticket et promeut en MAJOR_INCIDENT si le seuil est atteint.
 * Retourne true si le ticket vient d'être promu en incident majeur.
 */
async function attachSiteToTicket(ticketId, fromEmail, fromName) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { impactedSites: true, isMajorIncident: true, firstDetectedAt: true },
  });

  if (!ticket) return false;

  const site = fromName || fromEmail;
  const alreadyListed = ticket.impactedSites.includes(site);
  const updatedSites = alreadyListed ? ticket.impactedSites : [...ticket.impactedSites, site];
  const becomesMajor = !ticket.isMajorIncident && updatedSites.length >= MAJOR_INCIDENT_THRESHOLD;

  await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      impactedSites: updatedSites,
      lastDetectedAt: new Date(),
      firstDetectedAt: ticket.firstDetectedAt || new Date(),
      ...(becomesMajor ? { isMajorIncident: true, priority: 'P1' } : {}),
    },
  });

  return becomesMajor;
}

// Fallback sans API — Jaccard sur mots-clés bruts
function fallbackJaccard({ subject, body }, tickets) {
  const stopwords = new Set(['le','la','les','de','du','des','un','une','et','est','en','au','aux','sur','par','pour','que','qui','ne','pas','plus','je','il','nous','vous','ils','bonjour','merci','depuis','ce','notre','mon','ma','mes','son','sa','ses']);

  function keywords(text) {
    return new Set(text.toLowerCase().replace(/[^a-zàâäéèêëîïôùûüç\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !stopwords.has(w)));
  }

  const kIn = keywords(`${subject} ${body}`);
  let best = null, bestScore = 0;

  for (const ticket of tickets) {
    const kT = keywords(`${ticket.title} ${ticket.aiSummary || ''}`);
    const inter = [...kIn].filter((x) => kT.has(x)).length;
    const union = new Set([...kIn, ...kT]).size;
    const score = union === 0 ? 0 : inter / union;
    if (score > bestScore) { bestScore = score; best = ticket; }
  }

  if (bestScore >= 0.20 && best) {
    return { ticketId: best.id, ticketTitle: best.title, similarity: bestScore, method: 'SIMILAR_INCIDENT' };
  }
  return null;
}

/**
 * Sauvegarde l'embedding d'un ticket pour la détection future d'incidents similaires.
 * Fire-and-forget : ne doit JAMAIS bloquer le pipeline email.
 *
 * @param {number} ticketId
 * @param {string} title
 * @param {string} content
 */
async function saveTicketEmbedding(ticketId, title, content) {
  const text = `${title || ''} ${content || ''}`.substring(0, 1000);
  if (!text.trim()) return;

  try {
    const embedding = await generateEmbedding(text);
    const vectorLiteral = toVectorLiteral(embedding);

    // Mettre à jour l'embedding dans Ticket (raw SQL avec paramètre lié)
    await prisma.$executeRaw`
      UPDATE "Ticket"
      SET "contentEmbedding" = ${vectorLiteral}::vector
      WHERE id = ${ticketId}
    `;

    // Upsert TicketSimilarityIndex (find-first + create/update car ticketId n'est pas @unique)
    const summary = (title || '').substring(0, 500);
    const bodyShort = (content || '').substring(0, 200);
    const fullContent = (content || '').substring(0, 2000);
    const existing = await prisma.ticketSimilarityIndex.findFirst({ where: { ticketId } });
    if (existing) {
      await prisma.ticketSimilarityIndex.update({
        where: { id: existing.id },
        data: { summary, bodyShort, content: fullContent },
      });
    } else {
      await prisma.ticketSimilarityIndex.create({
        data: { ticketId, summary, bodyShort, content: fullContent, status: 'OPEN', requesterEmail: '' },
      });
    }

    // Mettre à jour l'embedding dans TicketSimilarityIndex (raw SQL)
    await prisma.$executeRaw`
      UPDATE "TicketSimilarityIndex"
      SET embedding = ${vectorLiteral}::vector
      WHERE "ticketId" = ${ticketId}
    `;

    console.log(`[similarIncident] Embedding sauvegardé pour ticket ${ticketId}`);
  } catch (err) {
    // Ne jamais bloquer le pipeline — c'est fire-and-forget
    console.error(`[similarIncident] Échec sauvegarde embedding ticket ${ticketId}:`, err.message);
  }
}

/**
 * Recherche de tickets similaires par similarité vectorielle (cosine distance).
 * Utilise l'embedding du ticket source pour trouver les tickets les plus proches.
 *
 * @param {number} ticketId - ID du ticket source
 * @param {number} limit - Nombre max de résultats (défaut: 5)
 * @param {number} minScore - Score minimum de similarité 0-1 (défaut: 0.5)
 * @returns {Promise<Array>} Tickets similaires avec score
 */
async function findSimilarTicketsByVector(ticketId, limit = 5, minScore = 0.5) {
  const ticket = await prisma.$queryRaw`
    SELECT "contentEmbedding"::text AS embedding_text
    FROM "Ticket"
    WHERE id = ${ticketId} AND "contentEmbedding" IS NOT NULL
  `;

  if (!ticket[0]?.embedding_text) return [];

  const results = await prisma.$queryRaw`
    SELECT
      t.id,
      t.title,
      t.status,
      t.priority,
      t.category,
      t."locationName",
      t."createdAt",
      1 - (t."contentEmbedding" <=> ${ticket[0].embedding_text}::vector) AS similarity,
      u.fullName AS "assignedToName",
      r.fullName AS "requesterName"
    FROM "Ticket" t
    LEFT JOIN "User" u ON u.id = t."assignedToId"
    LEFT JOIN "User" r ON r.id = t."requesterId"
    WHERE t.id != ${ticketId}
      AND t."contentEmbedding" IS NOT NULL
      AND t."deletedAt" IS NULL
      AND 1 - (t."contentEmbedding" <=> ${ticket[0].embedding_text}::vector) >= ${minScore}
    ORDER BY t."contentEmbedding" <=> ${ticket[0].embedding_text}::vector
    LIMIT ${limit}
  `;

  return results.map(r => ({
    id: r.id,
    title: r.title,
    status: r.status,
    priority: r.priority,
    category: r.category,
    locationName: r.locationName,
    createdAt: r.createdAt,
    similarity: Math.round(Number(r.similarity) * 100),
    assignedToName: r.assignedToName,
    requesterName: r.requesterName,
  }));
}

/**
 * Recherche de tickets similaires par texte (génère un embedding à la volée).
 * Utile quand on a une description mais pas de ticketId.
 *
 * @param {string} text - Texte à comparer
 * @param {number} limit - Nombre max de résultats
 * @param {number} minScore - Score minimum 0-1
 * @returns {Promise<Array>} Tickets similaires avec score
 */
async function findSimilarByText(text, limit = 5, minScore = 0.4) {
  const inputText = (text || '').substring(0, 1000).trim();
  if (!inputText) return [];

  try {
    const embedding = await generateEmbedding(inputText);
    const vectorLiteral = toVectorLiteral(embedding);

    const results = await prisma.$queryRaw`
      SELECT
        t.id,
        t.title,
        t.status,
        t.priority,
        t.category,
        t."locationName",
        t."createdAt",
        1 - (t."contentEmbedding" <=> ${vectorLiteral}::vector) AS similarity,
        u.fullName AS "assignedToName",
        r.fullName AS "requesterName"
      FROM "Ticket" t
      LEFT JOIN "User" u ON u.id = t."assignedToId"
      LEFT JOIN "User" r ON r.id = t."requesterId"
      WHERE t."contentEmbedding" IS NOT NULL
        AND t."deletedAt" IS NULL
        AND 1 - (t."contentEmbedding" <=> ${vectorLiteral}::vector) >= ${minScore}
      ORDER BY t."contentEmbedding" <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `;

    return results.map(r => ({
      id: r.id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      category: r.category,
      locationName: r.locationName,
      createdAt: r.createdAt,
      similarity: Math.round(Number(r.similarity) * 100),
      assignedToName: r.assignedToName,
      requesterName: r.requesterName,
    }));
  } catch (err) {
    console.error(`[similarIncident] Erreur recherche vectorielle:`, err.message);
    return [];
  }
}

module.exports = { findSimilarOpenTicket, attachSiteToTicket, saveTicketEmbedding, findSimilarTicketsByVector, findSimilarByText };
