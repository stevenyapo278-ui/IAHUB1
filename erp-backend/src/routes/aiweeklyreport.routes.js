const express = require('express');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { generateWeeklyReport } = require('../services/aiWeeklyReportScheduler');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission('aiweeklyreports.manage', ['ADMIN', 'SUPERADMIN', 'HOTLINE']), async (req, res) => {
  const reports = await prisma.aiWeeklyPatternReport.findMany({
    include: { reviewedBy: { select: { id: true, fullName: true, email: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return res.json(reports);
});

router.get('/:id', requirePermission('aiweeklyreports.manage', ['ADMIN', 'SUPERADMIN', 'HOTLINE']), async (req, res) => {
  const report = await prisma.aiWeeklyPatternReport.findUnique({
    where: { id: Number(req.params.id) },
    include: { reviewedBy: { select: { id: true, fullName: true, email: true } } },
  });
  if (!report) return res.status(404).json({ error: 'Rapport introuvable' });
  return res.json(report);
});

router.get('/stats', requirePermission('aiweeklyreports.manage', ['ADMIN', 'SUPERADMIN', 'HOTLINE']), async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalCorrections,
      totalRejections,
      activeRules,
      rulesFromLearning,
      approvedReports,
      recentCorrections,
      correctionsByField,
    ] = await Promise.all([
      prisma.ticketFieldCorrection.count(),
      prisma.ticket.count({ where: { approvalStatus: 'REJECTED' } }),
      prisma.triageRule.count({ where: { isActive: true } }),
      prisma.triageRule.count(),
      prisma.aiWeeklyPatternReport.count({ where: { status: 'APPROVED' } }),
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
    ]);

    return res.json({
      totalCorrections,
      totalRejections,
      activeRules,
      totalRules: rulesFromLearning,
      approvedReports,
      recentCorrections,
      correctionsByField: correctionsByField.map((c) => ({ field: c.fieldName, count: c._count.fieldName })),
      accuracyRate: totalCorrections > 0
        ? Math.round(((totalCorrections - totalRejections) / totalCorrections) * 100)
        : 100,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/generate', requirePermission('aiweeklyreports.manage', ['ADMIN', 'SUPERADMIN', 'HOTLINE']), async (req, res) => {
  try {
    const report = await generateWeeklyReport();
    if (!report) return res.status(200).json({ message: 'Aucune nouvelle correction à analyser pour les 7 derniers jours.' });
    return res.status(201).json(report);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/:id/approve', requirePermission('aiweeklyreports.manage', ['ADMIN', 'SUPERADMIN', 'HOTLINE']), async (req, res) => {
  const id = Number(req.params.id);
  const report = await prisma.aiWeeklyPatternReport.findUnique({ where: { id } });
  if (!report) return res.status(404).json({ error: 'Rapport introuvable' });

  const rules = Array.isArray(report.proposedRules) ? report.proposedRules : [];
  let createdRulesCount = 0;

  for (const r of rules) {
    if (!r.matchValue) continue;
    try {
      await prisma.triageRule.create({
        data: {
          label: r.label || 'Règle issue de l\'apprentissage Hotline',
          matchField: r.matchField || 'subject_or_body',
          matchType: r.matchType || 'contains',
          matchValue: r.matchValue,
          category: r.category || null,
          ticketPriority: r.ticketPriority || null,
          isSpam: r.isSpam === true,
          isActive: true,
          priority: 10,
        },
      });
      createdRulesCount++;
    } catch (err) {
      console.error('[aiweeklyreport.routes] Échec création règle de triage:', err.message);
    }
  }

  const updatedReport = await prisma.aiWeeklyPatternReport.update({
    where: { id },
    data: {
      status: 'APPROVED',
      reviewedById: req.user.sub,
      reviewedAt: new Date(),
      reviewNote: req.body.note || `Approuvé par batch (${createdRulesCount} règles créées)`,
    },
  });

  return res.json({ report: updatedReport, createdRulesCount });
});

router.post('/:id/reject', requirePermission('aiweeklyreports.manage', ['ADMIN', 'SUPERADMIN', 'HOTLINE']), async (req, res) => {
  const id = Number(req.params.id);
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
