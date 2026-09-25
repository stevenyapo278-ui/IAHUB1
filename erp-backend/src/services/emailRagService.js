const prisma = require('../prismaClient');
const { generateEmbedding, toVectorLiteral } = require('../utils/embeddings');
const { rerank, listRerankCandidates } = require('../utils/reranking');

// ── Helpers ───────────────────────────────────────────────────────────
function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildIncomingEmailContent(email) {
  const parts = [];
  if (email.subject) parts.push(`Objet: ${email.subject}`);
  if (email.fromName || email.fromEmail) parts.push(`De: ${email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail}`);
  if (email.ccRecipients && email.ccRecipients.length) parts.push(`Cc: ${email.ccRecipients.join(', ')}`);
  if (email.receivedAt) parts.push(`Date: ${new Date(email.receivedAt).toLocaleString('fr-FR')}`);
  if (email.aiSummary) parts.push(`Résumé IA: ${email.aiSummary}`);
  if (email.bodyPreview) parts.push(`Aperçu: ${email.bodyPreview}`);
  const body = stripHtml(email.bodyHtml) || email.bodyPreview || '';
  if (body) parts.push(`Contenu:\n${body.substring(0, 6000)}`);
  if (email.erpTicketId) parts.push(`Ticket lié: #${email.erpTicketId}`);
  if (email.conversationId) parts.push(`Fil: ${email.conversationId}`);
  return parts.join('\n\n');
}

function buildTicketMessageContent(msg) {
  const parts = [];
  if (msg.subject) parts.push(`Objet: ${msg.subject}`);
  parts.push(`De: ${msg.sender} → À: ${(msg.recipients || []).join(', ')}`);
  if (msg.ccRecipients && msg.ccRecipients.length) parts.push(`Cc: ${msg.ccRecipients.join(', ')}`);
  parts.push(`Direction: ${msg.direction} | Date: ${new Date(msg.timestamp).toLocaleString('fr-FR')}`);
  if (msg.ticketStatusAtTime) parts.push(`Statut ticket à ce moment: ${msg.ticketStatusAtTime}`);
  if (msg.summary) parts.push(`Résumé IA: ${msg.summary}`);
  const body = stripHtml(msg.bodyHtml) || msg.body || '';
  if (body) parts.push(`Contenu:\n${body.substring(0, 6000)}`);
  if (msg.conversationId) parts.push(`Fil: ${msg.conversationId}`);
  parts.push(`Ticket: #${msg.ticketId}`);
  return parts.join('\n\n');
}

function chunkText(text, maxLen = 1500, overlap = 200) {
  if (!text || text.length <= maxLen) return [text];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxLen, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - overlap;
  }
  return chunks;
}

// ── Indexation ────────────────────────────────────────────────────────
async function indexIncomingEmail(emailId) {
  const email = await prisma.incomingEmail.findUnique({ where: { id: emailId } });
  if (!email) return null;
  const content = buildIncomingEmailContent(email);
  const chunks = chunkText(content);
  // Supprimer anciens chunks
  await prisma.emailRagChunk.deleteMany({ where: { sourceType: 'INCOMING_EMAIL', sourceId: emailId } });
  for (let i = 0; i < chunks.length; i++) {
    const chunkContent = chunks[i];
    let embedding = null;
    try {
      const vector = await generateEmbedding(chunkContent);
      embedding = toVectorLiteral(vector);
    } catch (e) {
      console.warn(`[emailRag] embedding INCOMING_EMAIL ${emailId} chunk ${i} échoué:`, e.message);
    }
    const metadata = {
      ticketId: email.erpTicketId || null,
      conversationId: email.conversationId || null,
      fromEmail: email.fromEmail,
      fromName: email.fromName,
      subject: email.subject,
      receivedAt: email.receivedAt,
      // Un email entrant est toujours reçu : sans ce champ, un filtre
      // direction=INBOUND exclurait tout l'historique Outlook.
      direction: 'INBOUND',
      source: 'IncomingEmail',
      hasAttachments: email.hasAttachments,
      erpTicketId: email.erpTicketId,
    };
    if (embedding) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "EmailRagChunk" ("sourceType", "sourceId", "chunkIndex", content, embedding, metadata, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb, now(), now())`,
        'INCOMING_EMAIL', emailId, i, chunkContent, embedding, JSON.stringify(metadata)
      );
    } else {
      await prisma.emailRagChunk.create({
        data: { sourceType: 'INCOMING_EMAIL', sourceId: emailId, chunkIndex: i, content: chunkContent, metadata },
      });
    }
  }
  return chunks.length;
}

async function indexTicketMessage(messageId) {
  const msg = await prisma.ticketMessage.findUnique({ where: { id: messageId } });
  if (!msg) return null;
  const content = buildTicketMessageContent(msg);
  const chunks = chunkText(content);
  await prisma.emailRagChunk.deleteMany({ where: { sourceType: 'TICKET_MESSAGE', sourceId: messageId } });
  for (let i = 0; i < chunks.length; i++) {
    const chunkContent = chunks[i];
    let embedding = null;
    try {
      const vector = await generateEmbedding(chunkContent);
      embedding = toVectorLiteral(vector);
    } catch (e) {
      console.warn(`[emailRag] embedding TICKET_MESSAGE ${messageId} chunk ${i} échoué:`, e.message);
    }
    const metadata = {
      ticketId: msg.ticketId,
      conversationId: msg.conversationId,
      fromEmail: msg.sender,
      subject: msg.subject,
      receivedAt: msg.timestamp,
      direction: msg.direction,
      source: 'TicketMessage',
    };
    if (embedding) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "EmailRagChunk" ("sourceType", "sourceId", "chunkIndex", content, embedding, metadata, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb, now(), now())`,
        'TICKET_MESSAGE', messageId, i, chunkContent, embedding, JSON.stringify(metadata)
      );
    } else {
      await prisma.emailRagChunk.create({
        data: { sourceType: 'TICKET_MESSAGE', sourceId: messageId, chunkIndex: i, content: chunkContent, metadata },
      });
    }
  }
  return chunks.length;
}

// Backfill : indexe tous les mails/messages non encore indexés (limité)
async function backfillEmailRag({ limit = 100 } = {}) {
  let indexed = 0;
  const incomingEmails = await prisma.incomingEmail.findMany({
    take: limit,
    orderBy: { receivedAt: 'desc' },
    select: { id: true },
  });
  for (const e of incomingEmails) {
    const exists = await prisma.emailRagChunk.findFirst({ where: { sourceType: 'INCOMING_EMAIL', sourceId: e.id } });
    if (!exists) {
      await indexIncomingEmail(e.id).catch(() => {});
      indexed++;
    }
  }
  const ticketMessages = await prisma.ticketMessage.findMany({
    take: limit,
    orderBy: { timestamp: 'desc' },
    select: { id: true },
  });
  for (const m of ticketMessages) {
    const exists = await prisma.emailRagChunk.findFirst({ where: { sourceType: 'TICKET_MESSAGE', sourceId: m.id } });
    if (!exists) {
      await indexTicketMessage(m.id).catch(() => {});
      indexed++;
    }
  }
  return indexed;
}

// ── Recherche hybride ─────────────────────────────────────────────────
/**
 * Recherche dans le corpus mails (IncomingEmail + TicketMessage)
 * @param {string} query
 * @param {object} opts {topK, fromEmail, ticketId, conversationId, dateFrom, dateTo, direction}
 */
async function searchEmailRag(query, opts = {}) {
  const {
    topK = 5,
    fromEmail = null,
    ticketId = null,
    conversationId = null,
    dateFrom = null,
    dateTo = null,
    direction = null,
    useHybrid = true,
    // Seuils de pertinence : évite de renvoyer au LLM des chunks hors sujet
    // (il pourrait halluciner à partir d'un résultat non pertinent).
    // minScore est un plancher ABSOLU volontairement bas : ts_rank est faible
    // (~0.1) et la similarité cosinus se dilue quand la requête est courte et
    // le document long. La vraie coupe se fait via relativeFloor (queue longue).
    minScore = 0.12,
    minVectorScore = 0.2,
    relativeFloor = 0.3,
  } = typeof opts === 'number' ? { topK: opts } : opts;

  if (!query || !query.trim()) return [];

  let embedding = null;
  try {
    const vector = await generateEmbedding(query);
    embedding = toVectorLiteral(vector);
  } catch (e) {
    console.warn('[emailRag] generateEmbedding échoué, fallback FTS seul:', e.message);
  }

  const rerankCandidates = await listRerankCandidates();
  const hasActiveReranker = rerankCandidates.length > 0;
  const dbLimit = hasActiveReranker ? Math.max(30, topK * 3) : Math.min(topK * 4, 30);

  // Filtres metadata JSONB — construits par branche, car l'index des
  // placeholders dépend des paramètres déjà consommés ($1/$2/$3).
  //   hybride  : $1=embedding, $2=query,  $3=limit  → filtres $4...
  //   vecteur  : $1=embedding,              $2=limit  → filtres $3...
  //   FTS seul : $1=query,                  $2=limit  → filtres $3...
  const buildFilters = (startIdx) => {
    const conditions = [];
    const values = [];
    let i = startIdx;
    const add = (sql, value) => {
      // replaceAll : un même fragment peut apparaître 2× (ex: fromEmail OU fromName)
      conditions.push(sql.replaceAll('$?', `$${i}`));
      values.push(value);
      i++;
    };
    if (fromEmail) {
      add(`(metadata->>'fromEmail' ILIKE $? OR metadata->>'fromName' ILIKE $?)`, `%${fromEmail}%`);
    }
    if (ticketId) {
      add(`(metadata->>'ticketId')::int = $?`, Number(ticketId));
    }
    if (conversationId) {
      add(`metadata->>'conversationId' = $?`, String(conversationId));
    }
    if (direction) {
      add(`metadata->>'direction' = $?`, String(direction).toUpperCase());
    }
    if (dateFrom) {
      add(`(metadata->>'receivedAt')::timestamp >= $?::timestamp`, new Date(`${dateFrom}T00:00:00`).toISOString());
    }
    if (dateTo) {
      // Fin de journée incluse (sinon les mails après minuit sont exclus)
      add(`(metadata->>'receivedAt')::timestamp <= $?::timestamp`, new Date(`${dateTo}T23:59:59.999`).toISOString());
    }
    return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', values };
  };

  let results;
  if (embedding && useHybrid) {
    // $1=embedding, $2=query, $3=limit, $4=minScore, filtres $5...
    const { where, values } = buildFilters(5);
    results = await prisma.$queryRawUnsafe(
      `SELECT * FROM (
         SELECT id, "sourceType", "sourceId", "chunkIndex", content, metadata, "createdAt",
                 1 - (embedding <=> $1::vector) AS similarity,
                 ts_rank(to_tsvector('french', content), plainto_tsquery('french', $2)) AS text_rank,
                 (0.7 * (1 - (embedding <=> $1::vector)) + 0.3 * ts_rank(to_tsvector('french', content), plainto_tsquery('french', $2))) AS combined_score
          FROM "EmailRagChunk"
          ${where}
          ORDER BY combined_score DESC
          LIMIT $3
       ) t WHERE t.combined_score >= $4`,
      embedding, query, dbLimit, minScore, ...values
    );
  } else if (embedding) {
    // $1=embedding, $2=limit, $3=minVectorScore, filtres $4...
    const { where, values } = buildFilters(4);
    results = await prisma.$queryRawUnsafe(
      `SELECT * FROM (
         SELECT id, "sourceType", "sourceId", "chunkIndex", content, metadata, "createdAt",
                 1 - (embedding <=> $1::vector) AS similarity,
                 0 AS text_rank,
                 (1 - (embedding <=> $1::vector)) AS combined_score
          FROM "EmailRagChunk"
          ${where}
          ORDER BY combined_score DESC
          LIMIT $2
       ) t WHERE t.combined_score >= $3`,
      embedding, dbLimit, minVectorScore, ...values
    );
  } else {
    // Fallback FTS pur si pas d'embedding : $1=query, $2=limit, filtres $3...
    // On filtre avec l'opérateur @@ (vrai booléen de correspondance) et NON avec
    // ts_rank > 0 : ts_rank renvoie 1e-20 (epsilon interne) au lieu de 0 pour une
    // absence de correspondance, ce qui ferait passer des chunks hors sujet.
    const { where, values } = buildFilters(3);
    const matchPredicate = `to_tsvector('french', content) @@ plainto_tsquery('french', $1)`;
    // `where` contient déjà le préfixe WHERE
    const innerWhere = where ? `${where} AND ${matchPredicate}` : `WHERE ${matchPredicate}`;
    results = await prisma.$queryRawUnsafe(
      `SELECT id, "sourceType", "sourceId", "chunkIndex", content, metadata, "createdAt",
              0 AS similarity,
              ts_rank(to_tsvector('french', content), plainto_tsquery('french', $1)) AS text_rank,
              ts_rank(to_tsvector('french', content), plainto_tsquery('french', $1)) AS combined_score
       FROM "EmailRagChunk"
       ${innerWhere}
       ORDER BY text_rank DESC
       LIMIT $2`,
      query, dbLimit, ...values
    );
  }

  // Coupe relative : supprime la queue longue de résultats faibles, tout en
  // gardant le(s) meilleur(s) même si leurs scores absolus sont modestes.
  // Indispensable car la distribution des scores varie selon le modèle d'embedding.
  let finalResults = results;
  if (results.length > 1 && relativeFloor > 0) {
    const best = Math.max(...results.map((r) => Number(r.combined_score) || 0));
    if (best > 0) {
      const cut = best * relativeFloor;
      const kept = results.filter((r) => (Number(r.combined_score) || 0) >= cut);
      finalResults = kept.length > 0 ? kept : results.slice(0, 1);
    }
  }

  // Reranking
  if (hasActiveReranker && finalResults.length > 0) {
    try {
      const reranked = await rerank(query, finalResults.map((r) => ({ ...r, content: r.content })));
      finalResults = reranked.slice(0, topK);
    } catch {
      finalResults = finalResults.slice(0, topK);
    }
  } else {
    finalResults = finalResults.slice(0, topK);
  }

  return finalResults;
}

module.exports = {
  buildIncomingEmailContent,
  buildTicketMessageContent,
  chunkText,
  indexIncomingEmail,
  indexTicketMessage,
  backfillEmailRag,
  searchEmailRag,
};
