const prisma = require('../prismaClient');
const { getSystemSettings } = require('./systemSettings');
const { logger } = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// TRACKING DE CONSOMMATION DE TOKENS IA
// ═══════════════════════════════════════════════════════════════════════════

// Cache en mémoire pour les alerts (évite d'envoyer 100 emails en 1 minute)
let _lastAlertDate = null;
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 heures entre les alerts

/**
 * Vérifie si l'IA est activée globalement.
 * Si le toggle aiEnabled est false, tous les appels IA doivent être bloqués.
 */
async function isAiEnabled() {
  try {
    const settings = await getSystemSettings();
    return settings.aiEnabled !== false; // défaut true
  } catch {
    return true; // en cas d'erreur, laisser passer (ne pas casser le pipeline)
  }
}

/**
 * Enregistre l'appel IA et track les tokens consommés.
 * Appelé après chaque appel provider réussi (chat, email, embeddings, vision,
 * vocal, rerank, tests…).
 *
 * @param {Object} usage - { promptTokens, completionTokens, totalTokens }
 * @param {string} provider - nom du provider (gemini, openai, etc.)
 * @param {string} usageContext - feature (email, chatbot, background, vision, voice, embedding, rerank, test)
 * @param {Object} [options]
 * @param {string} [options.model] - nom du modèle appelé
 * @param {number} [options.userId] - utilisateur à l'origine (null = système)
 * @param {number} [options.durationMs] - durée de l'appel réseau
 * @param {boolean} [options.estimated] - true si tokens estimés (len/4) et non rapportés par le provider
 * @param {string} [options.source] - tâche précise appelante (analyzeEmail, dailySummary, skillLearning…)
 *                                     — permet de découper le contexte coarse 'background'
 */
async function trackAiUsage(usage, provider, usageContext = 'email', options = {}) {
  if (!usage || !usage.totalTokens) return;

  try {
    // Log en BDD
    await prisma.aiUsageLog.create({
      data: {
        provider: provider || 'unknown',
        usage: usageContext,
        source: options.source || null,
        model: options.model || null,
        userId: options.userId ?? null,
        promptTokens: usage.promptTokens || 0,
        completionTokens: usage.completionTokens || 0,
        totalTokens: usage.totalTokens || 0,
        durationMs: Number.isFinite(options.durationMs) ? Math.round(options.durationMs) : null,
        estimated: options.estimated === true,
      },
    });

    // Vérifier le budget et alerter si nécessaire
    await checkTokenBudget();
  } catch (err) {
    logger.warn(`[aiUsageTracker] Échec log token: ${err.message}`);
  }
}

/**
 * Vérifie la consommation journalière et envoie une alerte si le seuil est dépassé.
 */
async function checkTokenBudget() {
  try {
    const settings = await getSystemSettings();
    const budget = settings.aiDailyTokenBudget || 0;
    if (budget <= 0) return; // budget illimité

    const todayTokens = await getTodayTokenUsage();
    const ratio = todayTokens / budget;

    if (ratio >= (settings.aiTokenAlertThreshold || 0.8)) {
      // Cooldown : pas d'alerte toutes les 6 heures
      const now = Date.now();
      if (_lastAlertDate && (now - _lastAlertDate) < ALERT_COOLDOWN_MS) return;
      _lastAlertDate = now;

      const percentage = Math.round(ratio * 100);
      const recipients = settings.aiTokenAlertRecipients || [];

      if (recipients.length > 0) {
        const { sendEmail } = require('./emailSender');
        await sendEmail({
          to: recipients,
          subject: `[Alerte IA] ${percentage}% du budget journalier consommé`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #f59e0b;">Alerte consommation IA</h2>
              <p>La consommation de tokens IA a atteint <strong>${percentage}%</strong> du budget journalier.</p>
              <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                <tr><td style="padding: 8px; border: 1px solid #e5e7eb;">Tokens consommés</td><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">${todayTokens.toLocaleString()}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #e5e7eb;">Budget journalier</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${budget.toLocaleString()}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #e5e7eb;">Restant</td><td style="padding: 8px; border: 1px solid #e5e7eb; color: ${budget - todayTokens > 0 ? '#16a34a' : '#dc2626'};">${Math.max(0, budget - todayTokens).toLocaleString()}</td></tr>
              </table>
              <p style="color: #6b7280; font-size: 12px;">Configurez le seuil et les destinataires dans Paramètres > Intelligence Artificielle.</p>
            </div>
          `,
        }).catch((err) => logger.error(`[aiUsageTracker] Échec envoi alerte quota: ${err.message}`));
      }

      logger.warn(`[aiUsageTracker] Alerte quota IA : ${todayTokens}/${budget} tokens (${percentage}%)`);
    }
  } catch (err) {
    logger.warn(`[aiUsageTracker] Échec vérification budget: ${err.message}`);
  }
}

/**
 * Retourne la consommation totale de tokens pour aujourd'hui.
 */
async function getTodayTokenUsage() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const result = await prisma.aiUsageLog.aggregate({
    where: { createdAt: { gte: today } },
    _sum: { totalTokens: true },
  });

  return result._sum?.totalTokens || 0;
}

/**
 * Retourne les statistiques de consommation IA pour le dashboard.
 */
async function getAiUsageStats(days = 7) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Plage horaire : au plus 7 jours glissants (24 × 7 buckets max, restent lisibles)
  const hourSince = new Date(Math.max(since.getTime(), Date.now() - 7 * 24 * 60 * 60 * 1000));

  const [totalTokens, todayTokens, byProvider, byFeature, bySource, byModel, byUser, byDay, byHour, totalCalls] = await Promise.all([
    prisma.aiUsageLog.aggregate({ where: { createdAt: { gte: since } }, _sum: { totalTokens: true } }),
    prisma.aiUsageLog.aggregate({ where: { createdAt: { gte: today } }, _sum: { totalTokens: true } }),
    prisma.aiUsageLog.groupBy({
      by: ['provider'],
      where: { createdAt: { gte: since } },
      _sum: { totalTokens: true, promptTokens: true, completionTokens: true },
      _count: { id: true },
      orderBy: { _sum: { totalTokens: 'desc' } },
    }),
    prisma.aiUsageLog.groupBy({
      by: ['usage'],
      where: { createdAt: { gte: since } },
      _sum: { totalTokens: true, promptTokens: true, completionTokens: true },
      _count: { id: true },
      orderBy: { _sum: { totalTokens: 'desc' } },
    }),
    prisma.aiUsageLog.groupBy({
      by: ['source', 'usage'],
      where: { createdAt: { gte: since } },
      _sum: { totalTokens: true, promptTokens: true, completionTokens: true },
      _count: { id: true },
      orderBy: { _sum: { totalTokens: 'desc' } },
    }),
    prisma.aiUsageLog.groupBy({
      by: ['model'],
      where: { createdAt: { gte: since }, model: { not: null } },
      _sum: { totalTokens: true },
      _count: { id: true },
      orderBy: { _sum: { totalTokens: 'desc' } },
      take: 20,
    }),
    prisma.$queryRaw`
      SELECT u."id" as "userId", u."fullName", u."email",
             SUM(a."totalTokens") as "totalTokens", COUNT(a."id") as calls
      FROM "AiUsageLog" a
      JOIN "User" u ON u."id" = a."userId"
      WHERE a."createdAt" >= ${since} AND a."userId" IS NOT NULL
      GROUP BY u."id", u."fullName", u."email"
      ORDER BY SUM(a."totalTokens") DESC
      LIMIT 20
    `,
    prisma.$queryRaw`
      SELECT DATE("createdAt") as date, SUM("totalTokens") as "totalTokens", COUNT(*) as calls
      FROM "AiUsageLog"
      WHERE "createdAt" >= ${since}
      GROUP BY DATE("createdAt")
      ORDER BY date
    `,
    // Découpage horaire × tâche appelante : borné à 7 jours glissants pour éviter
    // des dizaines de milliers de buckets quand on sélectionne 90 jours.
    // Chaque pic horaire est ainsi imputable à une tâche précise.
    prisma.$queryRaw`
      SELECT to_char(date_trunc('hour', "createdAt"), 'YYYY-MM-DD HH24:00') as hour,
             "source" as source,
             SUM("totalTokens") as "totalTokens", COUNT(*) as calls
      FROM "AiUsageLog"
      WHERE "createdAt" >= ${hourSince}
      GROUP BY 1, 2
      ORDER BY 1
    `,
    prisma.aiUsageLog.count({ where: { createdAt: { gte: since } } }),
  ]);

  const settings = await getSystemSettings();

  return {
    periodDays: days,
    totalTokens: totalTokens._sum?.totalTokens || 0,
    todayTokens: todayTokens._sum?.totalTokens || 0,
    totalCalls,
    dailyBudget: settings.aiDailyTokenBudget || 0,
    alertThreshold: settings.aiTokenAlertThreshold || 0.8,
    budgetUsagePercent: settings.aiDailyTokenBudget > 0
      ? Math.round((todayTokens._sum?.totalTokens || 0) / settings.aiDailyTokenBudget * 100)
      : null,
    byProvider,
    byFeature,
    // Découpe fine par tâche appelante ('background' y est déplié : dailySummary,
    // closureScanner, skillLearning, knowledgeDraft, threadSummary…)
    bySource: (bySource || []).map((r) => ({
      source: r.source,
      usage: r.usage,
      totalTokens: r._sum?.totalTokens || 0,
      promptTokens: r._sum?.promptTokens || 0,
      completionTokens: r._sum?.completionTokens || 0,
      calls: r._count?.id || 0,
    })),
    byModel,
    byUser: (byUser || []).map((r) => ({
      userId: r.userId,
      fullName: r.fullName,
      email: r.email,
      totalTokens: Number(r.totalTokens || 0),
      calls: Number(r.calls || 0),
    })),
    // SUM/COUNT en SQL brut sont des bigint (BigInt côté Node) : comme byUser,
    // on convertit en Number sinon res.json() échoue (« Do not know how to
    // serialize a BigInt ») et toute la vue suivi de consommation tombe en 500.
    byDay: (byDay || []).map((r) => ({
      date: r.date,
      totalTokens: Number(r.totalTokens || 0),
      calls: Number(r.calls || 0),
    })),
    byHour: aggregateHourly(byHour || []),
    byHourSource: (byHour || []).map((r) => ({
      hour: r.hour,
      source: r.source ?? null,
      totalTokens: Number(r.totalTokens || 0),
      calls: Number(r.calls || 0),
    })),
    byHourPeriodStart: hourSince.toISOString(),
  };
}

// À partir des lignes horaires × tâche, recalcule l'agrégat horaire total.
function aggregateHourly(rows) {
  const byBucket = new Map();
  for (const r of rows) {
    const key = r.hour;
    const bucket = byBucket.get(key) || { hour: key, totalTokens: 0, calls: 0 };
    bucket.totalTokens += Number(r.totalTokens || 0);
    bucket.calls += Number(r.calls || 0);
    byBucket.set(key, bucket);
  }
  return [...byBucket.values()].sort((a, b) => (a.hour < b.hour ? -1 : a.hour > b.hour ? 1 : 0));
}

module.exports = { isAiEnabled, trackAiUsage, getAiUsageStats, getTodayTokenUsage, checkTokenBudget };
