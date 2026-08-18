// Regroupement des emails par conversation (façon Outlook).
// Clé de fil : `conversationId` Outlook, sinon un identifiant propre pour chaque email isolé.
// La "jambe envoyée" (réponses parties depuis l'ERP) est reconstituée via les TicketMessage OUTBOUND
// partageant le même conversationId, pour afficher la conversation complète reçus/envoyés.

const prisma = require('../prismaClient');

// Limite de fenêtre analysée : on regroupe parmi les emails les plus récents.
const MAX_EMAILS = 3000;

function threadKeyFor(email) {
  return email.conversationId || `single-${email.id}`;
}

function matchesSearch(email, q) {
  const haystack = [email.subject, email.fromEmail, email.fromName, email.bodyPreview]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

// Convertit un email entrant en message unifié du fil
function inboundToMessage(email) {
  return {
    kind: 'inbound',
    emailId: email.id,
    conversationId: email.conversationId,
    fromEmail: email.fromEmail,
    fromName: email.fromName,
    sender: email.fromEmail,
    subject: email.subject,
    date: email.receivedAt,
    receivedAt: email.receivedAt,
    status: email.status,
    aiPriority: email.aiPriority,
    aiSummary: email.aiSummary,
    aiCategory: email.aiCategory,
    aiTeam: email.aiTeam,
    aiConfidence: email.aiConfidence,
    aiIntent: email.aiIntent,
    aiIsSpam: email.aiIsSpam,
    glpiTicketId: email.glpiTicketId,
    erpTicketId: email.erpTicketId,
    hasAttachments: email.hasAttachments,
    ccRecipients: email.ccRecipients || [],
    isRead: email.isRead,
    attachments: Array.isArray(email.attachments)
      ? email.attachments.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType }))
      : [],
    error: email.error,
    bodyPreview: email.bodyPreview,
    bodyHtml: email.bodyHtml,
  };
}

// Convertit un message du ticket (réponse envoyée) en message unifié du fil
function ticketMessageToMessage(tm) {
  return {
    kind: 'sent',
    messageId: tm.id,
    conversationId: tm.conversationId,
    fromName: tm.sender,
    fromEmail: tm.sender,
    sender: tm.sender,
    recipients: tm.recipients || [],
    ccRecipients: tm.ccRecipients || [],
    subject: tm.subject || '',
    date: tm.timestamp,
    timestamp: tm.timestamp,
    body: tm.body,
    bodyHtml: tm.bodyHtml,
    ticketId: tm.ticketId,
  };
}

// Trie une liste de messages unifiés par date croissante
function byDateAsc(a, b) {
  return new Date(a.date) - new Date(b.date);
}

// Regroupe des emails (+ jambes envoyées) en fils de conversation.
// Retourne les fils triés du plus récent au plus ancien.
function buildThreads(emails, sentMessages, { status, q }) {
  const ql = q?.trim().toLowerCase();

  // 1) Regrouper les emails entrants par clé (filtre status + recherche au niveau du fil)
  const groups = new Map();
  for (const email of emails) {
    if (status && email.status !== status) continue;
    if (ql && !matchesSearch(email, ql)) continue;
    const key = threadKeyFor(email);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(email);
  }

  const conversations = new Set([...groups.keys()].filter((k) => !k.startsWith('single-')));

  const threads = [];
  for (const [key, list] of groups) {
    const inbound = list.map(inboundToMessage);
    const sent = sentMessages
      .filter((m) => m.conversationId === key && m.direction === 'OUTBOUND')
      .map(ticketMessageToMessage);

    const participants = new Map();
    for (const msg of inbound) {
      if (msg.fromEmail) participants.set(msg.fromEmail.toLowerCase(), { email: msg.fromEmail, name: msg.fromName || msg.fromEmail });
    }
    for (const msg of sent) {
      for (const addr of msg.recipients || []) {
        if (addr && !participants.has(addr.toLowerCase())) {
          participants.set(addr.toLowerCase(), { email: addr, name: addr });
        }
      }
    }

    const messages = [...inbound, ...sent].sort(byDateAsc);
    const latest = messages[messages.length - 1];

    // Agrégats au niveau du fil (façon Outlook)
    const unreadCount = inbound.filter((m) => !m.isRead).length;
    const hasAttachments = messages.some((m) => m.hasAttachments || (m.attachments && m.attachments.length > 0));
    const ccAll = inbound.flatMap((m) => m.ccRecipients || []);
    const ccRecipients = [...new Set(ccAll.map((addr) => String(addr).toLowerCase()))].map((addr) => {
      const original = ccAll.find((c) => String(c).toLowerCase() === addr);
      return original;
    });

    threads.push({
      id: key,
      conversationId: conversations.has(key) ? key : null,
      count: messages.length,
      inboundCount: inbound.length,
      sentCount: sent.length,
      participants: [...participants.values()],
      latest,
      messages,
      // Extras façon Outlook
      unreadCount,
      isUnread: unreadCount > 0,
      hasAttachments,
      ccRecipients,
    });
  }

  return threads.sort((a, b) => new Date(b.latest.date) - new Date(a.latest.date));
}

// Filtres applicables au niveau du fil (après regroupement)
function applyThreadFilters(threads, { priority, attachments, category, read }) {
  return threads.filter((t) => {
    if (priority && t.latest.aiPriority !== priority) return false;
    if (attachments === 'with' && !t.hasAttachments) return false;
    if (attachments === 'without' && t.hasAttachments) return false;
    if (category && t.latest.aiCategory !== category) return false;
    if (read === 'unread' && !t.isUnread) return false;
    if (read === 'read' && t.isUnread) return false;
    return true;
  });
}

async function listThreads({ status, q, priority, attachments, category, read, days, page = 1, limit = 25 }) {
  const emails = await prisma.incomingEmail.findMany({
    where: days ? { receivedAt: { gte: new Date(Date.now() - days * 86400000) } } : undefined,
    orderBy: { receivedAt: 'desc' },
    take: MAX_EMAILS,
  });

  const conversations = new Set();
  for (const email of emails) {
    if (email.conversationId) conversations.add(email.conversationId);
  }

  let sentMessages = [];
  if (conversations.size > 0) {
    sentMessages = await prisma.ticketMessage.findMany({
      where: { direction: 'OUTBOUND', conversationId: { in: [...conversations] } },
    });
  }

  let threads = buildThreads(emails, sentMessages, { status, q });
  threads = applyThreadFilters(threads, { priority, attachments, category, read });
  const total = threads.length;
  const start = (page - 1) * limit;
  threads = threads.slice(start, start + limit);

  return { items: threads, total, page, pages: Math.ceil(total / limit) };
}

// Compteurs globaux pour les badges des dossiers (façon Outlook)
async function getInboxCounts() {
  const [total, pending, processing, done, error, spam, withAttachments, unread] = await Promise.all([
    prisma.incomingEmail.count(),
    prisma.incomingEmail.count({ where: { status: 'PENDING' } }),
    prisma.incomingEmail.count({ where: { status: 'PROCESSING' } }),
    prisma.incomingEmail.count({ where: { status: 'DONE' } }),
    prisma.incomingEmail.count({ where: { status: 'ERROR' } }),
    prisma.incomingEmail.count({ where: { status: 'SPAM' } }),
    prisma.incomingEmail.count({ where: { hasAttachments: true } }),
    prisma.incomingEmail.count({ where: { isRead: false } }),
  ]);
  return { total, pending, processing, done, error, spam, withAttachments, unread };
}

async function getThread(key) {
  let emails;
  let sentMessages = [];

  const attachmentSelect = { select: { id: true, filename: true, mimeType: true } };

  if (typeof key === 'string' && key.startsWith('single-')) {
    const id = Number(key.slice('single-'.length));
    const email = await prisma.incomingEmail.findUnique({
      where: { id },
      include: { attachments: attachmentSelect },
    });
    emails = email ? [email] : [];
    if (email?.conversationId) {
      sentMessages = await prisma.ticketMessage.findMany({
        where: { direction: 'OUTBOUND', conversationId: email.conversationId },
      });
    }
  } else {
    emails = await prisma.incomingEmail.findMany({
      where: { conversationId: key },
      include: { attachments: attachmentSelect },
    });
    sentMessages = await prisma.ticketMessage.findMany({
      where: { direction: 'OUTBOUND', conversationId: key },
    });
    // Si aucun email entrant sous cette clé mais des envois, on force le regroupement
    if (emails.length === 0 && sentMessages.length > 0) {
      const fallbackEmail = {
        id: -1,
        conversationId: key,
        fromEmail: sentMessages[0].recipients?.[0] || sentMessages[0].sender,
        fromName: null,
        subject: sentMessages[0].subject || '',
        bodyPreview: null,
        receivedAt: sentMessages[0].timestamp,
        status: 'DONE',
        aiPriority: null,
        aiSummary: null,
        aiCategory: null,
        aiTeam: null,
        aiConfidence: null,
        aiIntent: null,
        aiIsSpam: false,
        glpiTicketId: null,
        erpTicketId: null,
        hasAttachments: false,
        ccRecipients: [],
        isRead: true,
        attachments: [],
        bodyHtml: null,
        error: null,
      };
      emails = [fallbackEmail];
    }
  }

  if (emails.length === 0 && sentMessages.length === 0) return null;

  const thread = buildThreads(emails, sentMessages, { status: null, q: null })[0];
  return thread || null;
}

module.exports = { listThreads, getThread, buildThreads, threadKeyFor, getInboxCounts };
