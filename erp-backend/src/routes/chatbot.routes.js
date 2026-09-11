const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/permissions');
const { handleMessage } = require('../services/chatbotService');
const { auditLog } = require('../services/auditLogService');
const prisma = require('../prismaClient');

const router = Router();

// ── Rate limit par user : 30 messages / 15 min ───────────────────────

const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => `chat:${req.user.sub}`,
  message: { error: 'Trop de messages. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Quota journalier : 100 messages / jour / user ────────────────────

async function dailyQuotaCheck(req, res, next) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const count = await prisma.chatMessage.count({
      where: {
        userId: req.user.sub,
        role: 'user',
        createdAt: { gte: today },
      },
    });

    if (count >= 100) {
      return res.status(429).json({
        error: 'Quota journalier atteint (100 messages/jour). Réessayez demain.',
        quotaUsed: count,
        quotaMax: 100,
      });
    }

    req.chatQuotaUsed = count;
    next();
  } catch (err) {
    next();
  }
}

// ── Détection prompt injection ────────────────────────────────────────

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i,
  /you\s+are\s+now\s+(a|an|the)/i,
  /act\s+as\s+if\s+you\s+(are|were)/i,
  /pretend\s+you\s+(are|were|have\s+no)/i,
  /disregard\s+(all|any|your)\s+(previous|prior|instructions?)/i,
  /system\s*:\s*/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /\bDAN\b.*\bjailbreak\b/i,
  /developer\s+mode/i,
  /reveal\s+(your|the)\s+(system|original)\s+prompt/i,
  /what\s+(is|are)\s+your\s+(system|initial)\s+(prompt|instructions?)/i,
  /output\s+your\s+(system|full)\s+prompt/i,
];

function detectPromptInjection(message) {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(message)) return true;
  }
  return false;
}

// ── Génération de titre auto à partir du 1er message user ─────────────

function generateConversationTitle(message) {
  const clean = message.replace(/\n/g, ' ').trim();
  if (clean.length <= 40) return clean;
  return clean.substring(0, 40).trim() + '...';
}

// ── Extraction des sujets récurrents ──────────────────────────────────
// Mots significatifs (hors mots vides) extraits des messages user, pour déterminer
// les sujets qui reviennent le plus souvent (ex: imprimante, vpn, caisse...).
const TOPIC_STOP_WORDS = new Set([
  'les', 'des', 'aux', 'une', 'que', 'qui', 'quoi', 'sur', 'pour', 'avec', 'par', 'dans',
  'est', 'sont', 'était', 'ont', 'mais', 'plus', 'très', 'bien', 'faire', 'peux', 'peut',
  'être', 'etre', 'avoir', 'cette', 'cet', 'ainsi', 'chez', 'alors', 'comme', 'tout', 'tous',
  'toute', 'toutes', 'autre', 'autres', 'même', 'aussi', 'donc', 'vous', 'nous', 'notre', 'votre',
  'mon', 'mes', 'ton', 'tes', 'son', 'ses', 'leur', 'leurs', 'elle', 'elles', 'quand', 'comment',
  'pourquoi', 'combien', 'rien', 'chose', 'quelle', 'quelles', 'quels', 'leur', 'jour', 'matin',
  'bonjour', 'bonsoir', 'salut', 'merci', 'svp', 'stp', 'ticket', 'tickets', 'problème', 'probleme',
  'souci', 'soucis', 'demande', 'besoin', 'possible', 'encore', 'new', 'the', 'and', 'for', 'with',
  'this', 'that', 'have', 'has', 'was', 'were', 'are',
]);

function extractTopics(message) {
  if (!message) return [];
  return (message.toLowerCase().match(/[a-zàâäéèêëîïôöùûüç0-9]{3,}/g) || []).filter(
    (w) => !TOPIC_STOP_WORDS.has(w)
  );
}

// ══════════════════════════════════════════════════════════════════════
// CONVERSATIONS CRUD
// ══════════════════════════════════════════════════════════════════════

// GET /api/chat/conversations — liste les conversations (hors archivées par défaut)
router.get('/conversations', authenticate, async (req, res) => {
  try {
    const { archived, pinned } = req.query;
    const where = { userId: req.user.sub };

    if (archived === 'true') {
      where.archived = true;
    } else if (archived === 'only') {
      // toutes les archivées
    } else {
      where.archived = false; // défaut : pas archivées
    }

    if (pinned === 'true') where.pinned = true;

    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: [
        { pinned: 'desc' },
        { updatedAt: 'desc' },
      ],
      include: {
        _count: { select: { messages: true } },
        messages: {
          where: { role: 'assistant' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true },
        },
      },
    });

    res.json(conversations.map((c) => ({
      id: c.id,
      title: c.title || 'Nouvelle conversation',
      pinned: c.pinned,
      archived: c.archived,
      messageCount: c._count.messages,
      lastReply: c.messages[0]?.content?.substring(0, 120) || null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })));
  } catch (err) {
    res.status(500).json({ error: 'Erreur de chargement.' });
  }
});

// POST /api/chat/conversations — créer une conversation vide
router.post('/conversations', authenticate, async (req, res) => {
  try {
    const conv = await prisma.conversation.create({
      data: { userId: req.user.sub, title: 'Nouvelle conversation' },
    });
    res.status(201).json(conv);
  } catch (err) {
    res.status(500).json({ error: 'Erreur de création.' });
  }
});

// PATCH /api/chat/conversations/:id — éditer titre / pin / archive
router.patch('/conversations/:id', authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const conv = await prisma.conversation.findUnique({ where: { id } });
    if (!conv || conv.userId !== req.user.sub) {
      return res.status(404).json({ error: 'Conversation introuvable.' });
    }

    const { title, pinned, archived } = req.body;
    const data = {};
    if (title !== undefined) data.title = title;
    if (pinned !== undefined) data.pinned = !!pinned;
    if (archived !== undefined) data.archived = !!archived;

    const updated = await prisma.conversation.update({ where: { id }, data });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Erreur de mise à jour.' });
  }
});

// DELETE /api/chat/conversations/:id — supprimer une conversation + ses messages
router.delete('/conversations/:id', authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const conv = await prisma.conversation.findUnique({ where: { id } });
    if (!conv || conv.userId !== req.user.sub) {
      return res.status(404).json({ error: 'Conversation introuvable.' });
    }

    // Supprimer les messages liés puis la conversation
    await prisma.chatMessage.deleteMany({ where: { conversationId: id } });
    await prisma.conversation.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur de suppression.' });
  }
});

// POST /api/chat/conversations/:id/pin — basculer épinglage
router.post('/conversations/:id/pin', authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const conv = await prisma.conversation.findUnique({ where: { id } });
    if (!conv || conv.userId !== req.user.sub) {
      return res.status(404).json({ error: 'Conversation introuvable.' });
    }

    const updated = await prisma.conversation.update({
      where: { id },
      data: { pinned: !conv.pinned },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Erreur.' });
  }
});

// POST /api/chat/conversations/:id/archive — basculer archivage
router.post('/conversations/:id/archive', authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const conv = await prisma.conversation.findUnique({ where: { id } });
    if (!conv || conv.userId !== req.user.sub) {
      return res.status(404).json({ error: 'Conversation introuvable.' });
    }

    const updated = await prisma.conversation.update({
      where: { id },
      data: { archived: !conv.archived },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Erreur.' });
  }
});

// ══════════════════════════════════════════════════════════════════════
// MESSAGES (avec conversationId)
// ══════════════════════════════════════════════════════════════════════

// POST /api/chat — envoyer un message
router.post('/', authenticate, chatLimiter, dailyQuotaCheck, async (req, res) => {
  const startTime = Date.now();

  try {
    const { message, history = [], conversationId } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Le message ne peut pas être vide.' });
    }
    if (message.length > 2000) {
      return res.status(400).json({
        error: 'Le message est trop long (max 2000 caractères).',
        length: message.length,
        max: 2000,
      });
    }

    const flagged = detectPromptInjection(message);

    // Créer ou récupérer la conversation
    let convId = conversationId;
    if (!convId) {
      // Créer une nouvelle conversation automatiquement
      const conv = await prisma.conversation.create({
        data: {
          userId: req.user.sub,
          title: generateConversationTitle(message),
        },
      });
      convId = conv.id;
    } else {
      // Vérifier que la conversation appartient à l'utilisateur
      const conv = await prisma.conversation.findUnique({ where: { id: convId } });
      if (!conv || conv.userId !== req.user.sub) {
        return res.status(404).json({ error: 'Conversation introuvable.' });
      }
    }

    // Sauvegarder le message user
    await prisma.chatMessage.create({
      data: {
        userId: req.user.sub,
        role: 'user',
        content: message.trim(),
        flagged,
        conversationId: convId,
      },
    });

    // Mettre à jour updatedAt de la conversation
    const conv = await prisma.conversation.findUnique({ where: { id: convId } });
    await prisma.conversation.update({
      where: { id: convId },
      data: { updatedAt: new Date() },
    });

    if (flagged) {
      await auditLog('chatbot_injection_detected', {
        actor: { id: req.user.sub, email: req.user.email },
        targetType: 'chat_message',
        targetLabel: message.substring(0, 200),
        metadata: { messageLength: message.length, ip: req.ip },
        ipAddress: req.ip,
      });
    }

    // Passer le pendingTicketData existant au handler
    // Filet de sécurité : une erreur non prévue dans le handler (ex: outil analytics en échec)
    // ne doit pas provoquer de 500 — on renvoie une réponse dégradée mais utilisable.
    let result;
    try {
      result = await handleMessage(message.trim(), history, req.user, conv?.pendingTicketData || null);
    } catch (handlerErr) {
      console.error('[chatbot] Erreur handleMessage:', handlerErr.stack || handlerErr);
      result = {
        reply: "Désolé, je n'ai pas pu traiter cette demande (erreur interne sur les données). Réessayez ou reformulez votre question.",
        intent: 'general',
        action: null,
        widget: null,
        sources: [],
        pendingTicketData: null,
      };
    }
    const durationMs = Date.now() - startTime;

    const inputTokens = Math.ceil(message.length / 4);
    const outputTokens = Math.ceil((result.reply || '').length / 4);
    const tokensUsed = inputTokens + outputTokens;

    // Sauvegarder la réponse
    await prisma.chatMessage.create({
      data: {
        userId: req.user.sub,
        role: 'assistant',
        content: result.reply,
        sources: result.sources || [],
        intent: result.intent || null,
        tokensUsed,
        durationMs,
        conversationId: convId,
      },
    });

    // Sauvegarder ou effacer les données du ticket en attente
    await prisma.conversation.update({
      where: { id: convId },
      data: { pendingTicketData: result.pendingTicketData || null },
    });

    // Audit log
    await auditLog('chatbot_message', {
      actor: { id: req.user.sub, email: req.user.email },
      targetType: 'chat_message',
      targetLabel: `[${result.intent || 'general'}] ${message.substring(0, 100)}`,
      metadata: {
        intent: result.intent,
        tokensUsed,
        durationMs,
        flagged,
        quotaUsed: (req.chatQuotaUsed || 0) + 1,
        action: result.action?.type || null,
        conversationId: convId,
      },
      ipAddress: req.ip,
    });

    res.json({ ...result, conversationId: convId });
  } catch (err) {
    console.error('[chatbot] Erreur:', err.stack || err);
    res.status(500).json({ error: 'Erreur interne du chatbot.' });
  }
});

// GET /api/chat/history — récupère l'historique (option: conversationId)
router.get('/history', authenticate, async (req, res) => {
  try {
    const { conversationId } = req.query;
    const where = { userId: req.user.sub };
    if (conversationId) where.conversationId = Number(conversationId);

    const messages = await prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: conversationId ? 200 : 50,
    });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Erreur de chargement.' });
  }
});

// DELETE /api/chat/history — réinitialise (si conversationId, sinon tout)
router.delete('/history', authenticate, async (req, res) => {
  try {
    const { conversationId } = req.query;
    if (conversationId) {
      await prisma.chatMessage.deleteMany({
        where: { userId: req.user.sub, conversationId: Number(conversationId) },
      });
      await prisma.conversation.delete({ where: { id: Number(conversationId) } });
    } else {
      await prisma.chatMessage.deleteMany({ where: { userId: req.user.sub } });
    }
    res.json({ ok: true, message: 'Conversation réinitialisée.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur.' });
  }
});

// POST /api/chat/feedback
router.post('/feedback', authenticate, async (req, res) => {
  try {
    const { messageId, rating } = req.body;
    if (!messageId || ![1, -1].includes(rating)) {
      return res.status(400).json({ error: 'Paramètres invalides.' });
    }

    await prisma.chatMessage.updateMany({
      where: { id: messageId, userId: req.user.sub, role: 'assistant' },
      data: { rating },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur.' });
  }
});

// ══════════════════════════════════════════════════════════════════════
// STATS SUPERADMIN
// ══════════════════════════════════════════════════════════════════════

router.get('/stats', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [totalMessages, totalUsers, flaggedCount, totalConversations] = await Promise.all([
      prisma.chatMessage.count({ where: { role: 'user' } }),
      prisma.chatMessage.findMany({ where: { role: 'user' }, distinct: ['userId'], select: { userId: true } }),
      prisma.chatMessage.count({ where: { role: 'user', flagged: true } }),
      // NB : userId est un champ obligatoire du modèle Conversation — un simple count() suffit.
      // ({ where: { userId: { not: null } } }) fait échouer Prisma 5 avec "Argument `not` must not be null".
      prisma.conversation.count(),
    ]);

    const todayMessages = await prisma.chatMessage.count({
      where: { role: 'user', createdAt: { gte: today } },
    });
    const weekMessages = await prisma.chatMessage.count({
      where: { role: 'user', createdAt: { gte: weekAgo } },
    });
    const monthMessages = await prisma.chatMessage.count({
      where: { role: 'user', createdAt: { gte: monthAgo } },
    });

    const tokenAgg = await prisma.chatMessage.aggregate({
      where: { role: 'assistant', tokensUsed: { not: null } },
      _sum: { tokensUsed: true },
      _avg: { tokensUsed: true },
    });

    const durationAgg = await prisma.chatMessage.aggregate({
      where: { role: 'assistant', durationMs: { not: null } },
      _avg: { durationMs: true },
    });

    // NB : l'intent n'est enregistré que sur les messages 'assistant' — ne pas filtrer sur role: 'user'.
    const recentIntents = await prisma.chatMessage.groupBy({
      by: ['intent'],
      where: { role: 'assistant', intent: { not: null }, createdAt: { gte: weekAgo } },
      _count: { intent: true },
      orderBy: { _count: { intent: 'desc' } },
      take: 10,
    });

    const topUsers = await prisma.chatMessage.groupBy({
      by: ['userId'],
      where: { role: 'user', createdAt: { gte: weekAgo } },
      _count: { userId: true },
      orderBy: { _count: { userId: 'desc' } },
      take: 10,
    });

    // Sujets qui reviennent le plus souvent : on extrait les mots significatifs des messages
    // user récents (30 derniers jours) et on agrège leurs occurrences côté serveur.
    const topicMessages = await prisma.chatMessage.findMany({
      where: { role: 'user', createdAt: { gte: monthAgo } },
      select: { content: true },
      take: 2000,
      orderBy: { createdAt: 'desc' },
    });
    const topicCounts = {};
    for (const m of topicMessages) {
      for (const word of new Set(extractTopics(m.content))) {
        topicCounts[word] = (topicCounts[word] || 0) + 1;
      }
    }
    const topTopics = Object.entries(topicCounts)
      .map(([topic, count]) => ({ topic, count }))
      .filter((t) => t.count > 1) // ignore les mots uniques, trop de bruit
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const userIds = topUsers.map((u) => u.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true, role: true, avatarUrl: true },
    });
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

    const topUsersResolved = topUsers.map((u) => ({
      userId: u.userId,
      name: userMap[u.userId]?.fullName || 'Inconnu',
      role: userMap[u.userId]?.role || 'UNKNOWN',
      count: u._count.userId,
    }));

    const dailyCounts = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const count = await prisma.chatMessage.count({
        where: { role: 'user', createdAt: { gte: dayStart, lt: dayEnd } },
      });
      dailyCounts.push({ date: dayStart.toISOString().split('T')[0], count });
    }

    const flaggedRecent = await prisma.chatMessage.findMany({
      where: { role: 'user', flagged: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, content: true, createdAt: true,
        user: { select: { fullName: true, email: true, avatarUrl: true } },
      },
    });

    const ratings = await prisma.chatMessage.groupBy({
      by: ['rating'],
      where: { role: 'assistant', rating: { not: null } },
      _count: { rating: true },
    });

    const hourlyCounts = [];
    for (let h = 0; h < 24; h++) {
      const hourStart = new Date(today);
      hourStart.setHours(h, 0, 0, 0);
      const hourEnd = new Date(hourStart);
      hourEnd.setHours(h + 1, 0, 0, 0);
      const count = await prisma.chatMessage.count({
        where: { role: 'user', createdAt: { gte: hourStart, lt: hourEnd } },
      });
      hourlyCounts.push({ hour: h, count });
    }

    res.json({
      overview: {
        totalMessages,
        totalUsers: totalUsers.length,
        totalConversations,
        todayMessages,
        weekMessages,
        monthMessages,
        flaggedCount,
        totalTokens: tokenAgg._sum.tokensUsed || 0,
        avgTokensPerResponse: Math.round(tokenAgg._avg.tokensUsed || 0),
        avgResponseMs: Math.round(durationAgg._avg.durationMs || 0),
      },
      dailyCounts,
      hourlyCounts,
      topIntents: recentIntents.map((i) => ({ intent: i.intent, count: i._count.intent })),
      topTopics,
      topUsers: topUsersResolved,
      flaggedRecent: flaggedRecent.map((m) => ({
        id: m.id,
        content: m.content.substring(0, 200),
        userName: m.user?.fullName || 'Inconnu',
        userEmail: m.user?.email || '',
        createdAt: m.createdAt,
      })),
      ratings: {
        positive: ratings.find((r) => r.rating === 1)?._count.rating || 0,
        negative: ratings.find((r) => r.rating === -1)?._count.rating || 0,
      },
    });
  } catch (err) {
    console.error('[chatbot] Erreur stats:', err.message);
    res.status(500).json({ error: 'Erreur lors du chargement des statistiques.' });
  }
});

module.exports = router;
