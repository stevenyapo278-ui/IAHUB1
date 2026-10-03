const express = require('express');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { generateWeeklyReport } = require('../services/aiWeeklyReportScheduler');

const router = express.Router();
router.use(authenticate);
router.use(requirePermission('aiweeklyreports.manage', ['ADMIN', 'SUPERADMIN', 'HOTLINE']));

const DAY_MS = 24 * 60 * 60 * 1000;

// Bornes de la configuration (page /ai-weekly-reports) — mêmes garde-fous que le scheduler.
const SETTINGS_BOUNDS = {
  aiWeeklyDay: { min: 0, max: 6 },
  aiWeeklyHour: { min: 0, max: 23 },
  aiWeeklyMinOccurrences: { min: 1, max: 50 },
  aiWeeklyDomainThreshold: { min: 2, max: 100 },
  aiWeeklyConfidenceThreshold: { min: 0, max: 1, float: true },
  aiWeeklyWindowDays: { min: 1, max: 90 },
};
const SETTINGS_KEYS = ['aiWeeklyAutoEnabled', ...Object.keys(SETTINGS_BOUNDS)];

// Liste des règles de triage (issues de l'apprentissage ou manuelles) — permet de voir,
// depuis la page Apprentissage IA, toutes les règles que le système applique au triage.
// ?source=learning filtre sur les règles créées par l'approbation d'un rapport hebdo.
router.get('/rules', async (req, res) => {
  const where = {};
  if (req.query.source === 'learning') where.priority = 10; // valeur fixée à la création depuis un rapport
  const rules = await prisma.triageRule.findMany({
    where,
    orderBy: [{ isActive: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }],
  });
  return res.json(rules);
});

// Active/désactive une règle de triage sans la supprimer (réversible, pas de perte d'historique)
router.patch('/rules/:id/toggle', async (req, res) => {
  const id = Number(req.params.id);
  const rule = await prisma.triageRule.findUnique({ where: { id } });
  if (!rule) return res.status(404).json({ error: 'Règle introuvable' });
  const updated = await prisma.triageRule.update({
    where: { id },
    data: { isActive: !rule.isActive },
  });
  return res.json(updated);
});

// Supprime définitivement une règle de triage
router.delete('/rules/:id', async (req, res) => {
  const id = Number(req.params.id);
  const rule = await prisma.triageRule.findUnique({ where: { id } });
  if (!rule) return res.status(404).json({ error: 'Règle introuvable' });
  await prisma.triageRule.delete({ where: { id } });
  return res.json({ ok: true });
});

// ── Configuration de la feature (panneau « Paramètres » de la page) ──────────
router.get('/settings', async (req, res) => {
  const s = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  const out = {};
  for (const k of SETTINGS_KEYS) out[k] = s?.[k];
  return res.json(out);
});

router.patch('/settings', async (req, res) => {
  const data = {};
  for (const [key, bound] of Object.entries(SETTINGS_BOUNDS)) {
    if (req.body[key] === undefined) continue;
    const v = Number(req.body[key]);
    if (!Number.isFinite(v) || v < bound.min || v > bound.max) {
      return res.status(400).json({ error: `${key} doit être compris entre ${bound.min} et ${bound.max}` });
    }
    data[key] = bound.float ? v : Math.round(v);
  }
  if (req.body.aiWeeklyAutoEnabled !== undefined) {
    data.aiWeeklyAutoEnabled = req.body.aiWeeklyAutoEnabled === true;
  }
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'Aucune configuration à mettre à jour' });
  }
  const updated = await prisma.systemSettings.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
  });
  const out = {};
  for (const k of SETTINGS_KEYS) out[k] = updated[k];
  return res.json(out);
});

// ── Statistiques de la page (KPI, graphiques) ────────────────────────────────
// AVANT GET /:id sinon Express route /stats vers /:id et la route meurt.
router.get('/stats', async (req, res) => {
  const now = Date.now();
  const thirtyDaysAgo = new Date(now - 30 * DAY_MS);
  const trendStart = new Date(now - 8 * 7 * DAY_MS);

  const [
    totalCorrections,
    corrections30d,
    activeRules,
    totalRules,
    approvedReports,
    pendingReports,
    rejectedReports,
    recentCorrections,
    correctionsByField,
    trendCorrections,
  ] = await Promise.all([
    prisma.ticketFieldCorrection.count(),
    prisma.ticketFieldCorrection.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.triageRule.count({ where: { isActive: true } }),
    prisma.triageRule.count(),
    prisma.aiWeeklyPatternReport.count({ where: { status: 'APPROVED' } }),
    prisma.aiWeeklyPatternReport.count({ where: { status: 'PENDING' } }),
    prisma.aiWeeklyPatternReport.count({ where: { status: 'REJECTED' } }),
    prisma.ticketFieldCorrection.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      include: { ticket: { select: { title: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.ticketFieldCorrection.groupBy({
      by: ['fieldName'],
      _count: { fieldName: true },
      orderBy: { _count: { fieldName: 'desc' } },
    }),
    prisma.ticketFieldCorrection.findMany({
      where: { createdAt: { gte: trendStart } },
      select: { createdAt: true },
    }),
  ]);

  // Tendance hebdomadaire (8 semaines, semaines ISO lundi → dimanche)
  const weekOf = (d) => {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = (t.getUTCDay() + 6) % 7; // lundi = 0
    t.setUTCDate(t.getUTCDate() - day);
    return t.toISOString().slice(0, 10);
  };
  const weeklyMap = {};
  for (let i = 7; i >= 0; i -= 1) {
    const start = new Date(now - i * 7 * DAY_MS);
    weeklyMap[weekOf(start)] = 0;
  }
  for (const c of trendCorrections) {
    const key = weekOf(c.createdAt);
    if (weeklyMap[key] !== undefined) weeklyMap[key] += 1;
  }

  const decidedReports = approvedReports + rejectedReports;

  return res.json({
    totalCorrections,
    corrections30d,
    activeRules,
    totalRules,
    approvedReports,
    pendingReports,
    rejectedReports,
    recentCorrections,
    correctionsByField: correctionsByField.map((c) => ({ field: c.fieldName, count: c._count.fieldName })),
    weeklyTrend: Object.entries(weeklyMap).map(([week, count]) => ({ week, count })),
    // Taux d'approbation des rapports (APPROVED / traités) — remplace l'ancienne
    // « précision IA » qui mélangeait deux populations disjointes.
    approvalRate: decidedReports > 0 ? Math.round((approvedReports / decidedReports) * 100) : null,
  });
});

router.get('/', async (req, res) => {
  const take = Math.min(Number(req.query.take) || 50, 200);
  const reports = await prisma.aiWeeklyPatternReport.findMany({
    include: { reviewedBy: { select: { id: true, fullName: true, email: true, avatarUrl: true } } },
    orderBy: { createdAt: 'desc' },
    take,
  });
  return res.json(reports);
});

router.post('/generate', async (req, res) => {
  const result = await generateWeeklyReport();
  if (result.created) return res.status(201).json(result.report);
  if (result.reason === 'duplicate') {
    return res.status(200).json({
      message: `Un rapport couvrant cette période existe déjà (n°${result.report.id}) — inutile d'en générer un second.`,
      report: result.report,
    });
  }
  return res.status(200).json({ message: 'Aucune nouvelle correction à analyser sur cette période.' });
});

// Détail d'un rapport (utile pour recharger après approbation). AVANT /:id/approve
// n'est pas nécessaire (chemins distincts), mais après /stats et /settings.
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Identifiant invalide' });
  const report = await prisma.aiWeeklyPatternReport.findUnique({
    where: { id },
    include: { reviewedBy: { select: { id: true, fullName: true, email: true, avatarUrl: true } } },
  });
  if (!report) return res.status(404).json({ error: 'Rapport introuvable' });
  return res.json(report);
});

// ── Approbation : crée les règles de triage proposées ────────────────────────
// Garde-fous : rapport déjà traité → 409 (évite les doublons), création atomique
// (transaction) — jamais de rapport APPROVED avec des règles à moitié créées.
router.post('/:id/approve', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Identifiant invalide' });
  const report = await prisma.aiWeeklyPatternReport.findUnique({ where: { id } });
  if (!report) return res.status(404).json({ error: 'Rapport introuvable' });
  if (report.status !== 'PENDING') {
    return res.status(409).json({ error: `Rapport déjà ${report.status === 'APPROVED' ? 'approuvé' : 'rejeté'} — impossible de le ré-approuver.` });
  }

  // Récupérer les domaines internes pour bloquer toute règle anti-spam qui les ciblerait
  const activeAccounts = await prisma.emailAccount.findMany({ where: { isActive: true }, select: { emailAddress: true, username: true } });
  const internalDomains = new Set();
  for (const acc of activeAccounts) {
    for (const addr of [acc.emailAddress, acc.username]) {
      if (!addr) continue;
      const at = addr.lastIndexOf('@');
      if (at >= 0 && at < addr.length - 1) internalDomains.add(addr.slice(at + 1).toLowerCase());
    }
  }

  const rules = Array.isArray(report.proposedRules) ? report.proposedRules : [];

  // Résolution teamId → nom d'équipe : le moteur de triage cible un teamName, pas un id.
  const teamIds = [...new Set(
    rules
      .filter((r) => r.fieldName === 'teamId' && r.suggestedValue)
      .map((r) => Number(r.suggestedValue))
      .filter(Number.isFinite),
  )];
  const teams = teamIds.length > 0
    ? await prisma.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true } })
    : [];
  const teamNamesById = new Map(teams.map((t) => [t.id, t.name]));

  let createdRulesCount = 0;
  let skippedInternalDomainCount = 0;

  await prisma.$transaction(async (tx) => {
    for (const r of rules) {
      if (!r.matchValue) continue;

      // Filet de sécurité : ne jamais créer une règle spam qui bloquerait un domaine interne
      if (r.isSpam && r.matchField === 'domain') {
        const targetDomain = (r.matchValue || '').toLowerCase();
        const wouldBlockInternal = [...internalDomains].some(
          (d) => d === targetDomain || d.endsWith(`.${targetDomain}`) || targetDomain.endsWith(`.${d}`)
        );
        if (wouldBlockInternal) {
          console.warn(`[aiweeklyreport] Règle anti-spam ignorée à l'approbation : domaine interne protégé "${targetDomain}"`);
          skippedInternalDomainCount += 1;
          continue;
        }
      }

      // Label lisible dans la gestion des règles : pattern + action apprise.
      const label = `${r.label || 'Règle issue de l\'apprentissage'} — « ${String(r.matchValue).substring(0, 60)} »`;

      let teamName = null;
      if (r.fieldName === 'teamId' && r.suggestedValue) {
        teamName = teamNamesById.get(Number(r.suggestedValue)) || null;
      }

      try {
        await tx.triageRule.create({
          data: {
            label,
            matchField: r.matchField || 'subject_or_body',
            matchType: r.matchType || 'contains',
            matchValue: r.matchValue,
            category: r.category || null,
            teamName,
            ticketPriority: r.ticketPriority || null,
            isSpam: r.isSpam === true,
            isActive: true,
            priority: 10, // règle issue de l'apprentissage (filtre ?source=learning)
          },
        });
        createdRulesCount += 1;
      } catch (err) {
        console.error('[aiweeklyreport.routes] Échec création règle de triage:', err.message);
      }
    }

    await tx.aiWeeklyPatternReport.update({
      where: { id },
      data: {
        status: 'APPROVED',
        reviewedById: req.user.sub,
        reviewedAt: new Date(),
        reviewNote: req.body.note || `Approuvé par batch (${createdRulesCount} règles créées${skippedInternalDomainCount > 0 ? `, ${skippedInternalDomainCount} règle(s) sur domaine interne ignorée(s)` : ''})`,
      },
    });
  });

  const updatedReport = await prisma.aiWeeklyPatternReport.findUnique({
    where: { id },
    include: { reviewedBy: { select: { id: true, fullName: true, email: true, avatarUrl: true } } },
  });

  return res.json({ report: updatedReport, createdRulesCount, skippedInternalDomainCount });
});

router.post('/:id/reject', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Identifiant invalide' });
  const report = await prisma.aiWeeklyPatternReport.findUnique({ where: { id } });
  if (!report) return res.status(404).json({ error: 'Rapport introuvable' });
  if (report.status !== 'PENDING') {
    return res.status(409).json({ error: `Rapport déjà ${report.status === 'APPROVED' ? 'approuvé' : 'rejeté'} — traitement impossible.` });
  }
  const updatedReport = await prisma.aiWeeklyPatternReport.update({
    where: { id },
    data: {
      status: 'REJECTED',
      reviewedById: req.user.sub,
      reviewedAt: new Date(),
      reviewNote: req.body.note || 'Rapport rejeté par l\'administrateur',
    },
  });
  return res.json(updatedReport);
});

module.exports = router;
