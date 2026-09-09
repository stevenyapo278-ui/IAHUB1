const prisma = require('../prismaClient');

// Retourne l'ensemble des domaines internes (domaines des comptes email actifs configurés dans la DB).
// Ces domaines ne doivent JAMAIS être ciblés par une règle anti-spam auto-générée.
async function getInternalDomains() {
  try {
    const accounts = await prisma.emailAccount.findMany({
      where: { isActive: true },
      select: { emailAddress: true, username: true },
    });
    const domains = new Set();
    for (const acc of accounts) {
      for (const addr of [acc.emailAddress, acc.username]) {
        if (!addr) continue;
        const at = addr.lastIndexOf('@');
        if (at >= 0 && at < addr.length - 1) domains.add(addr.slice(at + 1).toLowerCase());
      }
    }
    return domains;
  } catch {
    return new Set();
  }
}

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
    select: { id: true, title: true, content: true, approvalNote: true, category: true, priority: true, sourceEmail: true },
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

  // Boucle de rétroaction : agréger les rejets par domaine d'expéditeur. Si un même domaine
  // concentre plusieurs rejets dans la semaine, proposer une règle anti-spam par domaine
  // (plus fiable qu'une règle par titre), avec une confiance croissante selon le volume.
  const domainCounts = {};
  for (const r of rejections) {
    const email = (r.sourceEmail || '').toLowerCase().trim();
    const at = email.lastIndexOf('@');
    if (at < 0 || at === email.length - 1) continue;
    const domain = email.slice(at + 1);
    if (!domainCounts[domain]) domainCounts[domain] = { count: 0, reasons: [] };
    domainCounts[domain].count += 1;
    if (r.approvalNote && domainCounts[domain].reasons.length < 3) {
      domainCounts[domain].reasons.push(r.approvalNote);
    }
  }

  // Charger les domaines internes pour ne jamais les bannir automatiquement
  const internalDomains = await getInternalDomains();

  for (const [domain, info] of Object.entries(domainCounts)) {
    // Seuil relevé à 5 rejets : un volume faible peut résulter d'un mauvais rejet humain ponctuel
    if (info.count < 5) continue;

    // Ne jamais générer une règle anti-spam sur un domaine interne (boîte email de l'organisation)
    if (internalDomains.has(domain)) {
      console.warn(`[aiWeeklyReport] Domaine interne "${domain}" ignoré pour la règle anti-spam automatique`);
      continue;
    }

    proposedRules.push({
      label: `Filtrage anti-spam du domaine ${domain} (${info.count} rejets cette semaine)`,
      matchField: 'domain',
      // 'equals' pour un match exact sur le domaine — jamais 'contains' qui risque des faux positifs
      // (ex: "prosuma.cl" en 'contains' matcherait "prosuma.ci" si l'adresse complète est testée)
      matchType: 'equals',
      matchValue: domain,
      isSpam: true,
      reason: info.reasons.join(' ; ') || `${info.count} tickets rejetés par la Hotline`,
      occurrenceCount: info.count,
      confidence: Math.min(0.95, 0.6 + info.count * 0.1),
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
