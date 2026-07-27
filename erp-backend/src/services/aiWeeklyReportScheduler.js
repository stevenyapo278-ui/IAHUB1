const prisma = require('../prismaClient');

async function generateWeeklyReport() {
  const endDate = new Date();
  const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const corrections = await prisma.ticketFieldCorrection.findMany({
    where: { createdAt: { gte: startDate, lte: endDate } },
    include: { ticket: { select: { title: true, content: true, category: true, priority: true } } },
  });

  const rejections = await prisma.ticket.findMany({
    where: {
      approvalStatus: 'REJECTED',
      approvedAt: { gte: startDate, lte: endDate },
    },
    select: { id: true, title: true, content: true, approvalNote: true, category: true, priority: true },
  });

  if (corrections.length === 0 && rejections.length === 0) {
    return null;
  }

  const patternMap = {};

  for (const c of corrections) {
    const key = `${c.fieldName}:${c.oldValue || 'null'}->${c.newValue || 'null'}`;
    if (!patternMap[key]) {
      patternMap[key] = {
        fieldName: c.fieldName,
        oldValue: c.oldValue,
        newValue: c.newValue,
        count: 0,
        samples: [],
      };
    }
    patternMap[key].count += 1;
    if (patternMap[key].samples.length < 3 && c.ticket?.title) {
      patternMap[key].samples.push(c.ticket.title);
    }
  }

  const proposedRules = [];

  for (const key of Object.keys(patternMap)) {
    const p = patternMap[key];
    if (p.count >= 1) {
      proposedRules.push({
        label: `Ajustement automatique ${p.fieldName} (${p.oldValue || 'indéfini'} → ${p.newValue})`,
        matchField: 'subject_or_body',
        matchType: 'contains',
        matchValue: p.samples[0] ? p.samples[0].substring(0, 30) : p.fieldName,
        fieldName: p.fieldName,
        suggestedValue: p.newValue,
        category: p.fieldName === 'category' ? p.newValue : null,
        ticketPriority: p.fieldName === 'priority' ? p.newValue : null,
        occurrenceCount: p.count,
        sampleTitles: p.samples,
        confidence: Math.min(0.95, 0.6 + p.count * 0.1),
      });
    }
  }

  for (const r of rejections) {
    proposedRules.push({
      label: `Filtrage de rejet : ${r.approvalNote || r.title}`,
      matchField: 'subject_or_body',
      matchType: 'contains',
      matchValue: r.title.substring(0, 30),
      isSpam: true,
      reason: r.approvalNote || 'Rejeté par la Hotline',
      occurrenceCount: 1,
      confidence: 0.8,
    });
  }

  const report = await prisma.aiWeeklyPatternReport.create({
    data: {
      startDate,
      endDate,
      totalCorrections: corrections.length,
      totalRejections: rejections.length,
      proposedRules,
      status: 'PENDING',
    },
  });

  return report;
}

module.exports = { generateWeeklyReport };
