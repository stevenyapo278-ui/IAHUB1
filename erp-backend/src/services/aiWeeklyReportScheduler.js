const prisma = require('../prismaClient');
const { getSystemSettings } = require('./systemSettings');

const DAY_MS = 24 * 60 * 60 * 1000;
// Échantillon de titre retenu comme matchValue (assez long pour être discriminant,
// court pour rester lisible dans l'UI de gestion des règles).
const MATCH_SAMPLE_LEN = 120;

const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || min));

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

// Extrait un matchValue exploitable à partir d'un titre de ticket.
// Retourne null quand aucun titre exploitable n'existe — on ne fabrique JAMAIS un
// matchValue à partir de fieldName (ancien comportement qui créait des règles
// « le sujet contient « category » », source de faux positifs massifs).
function sampleMatchValue(title) {
  const t = (title || '').trim();
  if (!t) return null;
  return t.substring(0, MATCH_SAMPLE_LEN);
}

// ── Génération d'un rapport hebdomadaire ─────────────────────────────────────
// Seuils et fenêtre lisés dans SystemSettings (onglet de config de la page
// /ai-weekly-reports). Retourne :
//   { created: true,  report }                 — rapport créé
//   { created: false, reason: 'duplicate' }    — un rapport récent couvre déjà la fenêtre
//   { created: false, reason: 'empty' }        — aucune donnée sur la fenêtre
async function generateWeeklyReport() {
  const s = await getSystemSettings();
  const windowDays = clamp(s.aiWeeklyWindowDays, 1, 90);
  const minOccurrences = clamp(s.aiWeeklyMinOccurrences, 1, 50);
  const domainThreshold = clamp(s.aiWeeklyDomainThreshold, 2, 100);
  const confidenceThreshold = clamp(s.aiWeeklyConfidenceThreshold, 0, 1);

  // Dédoublonnage : une seule génération par fenêtre glissante (un rapport PENDING
  // ou APPROVED récent couvre déjà cette période). Un rapport REJECTED ne bloque
  // pas une nouvelle tentative.
  const recent = await prisma.aiWeeklyPatternReport.findFirst({
    where: {
      status: { in: ['PENDING', 'APPROVED'] },
      createdAt: { gte: new Date(Date.now() - windowDays * DAY_MS) },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (recent) return { created: false, reason: 'duplicate', report: recent };

  const endDate = new Date();
  const startDate = new Date(Date.now() - windowDays * DAY_MS);

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
    return { created: false, reason: 'empty' };
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
    // Seuil d'occurrences configurable : une correction isolée ne suffit plus
    // à proposer une règle.
    if (p.count < minOccurrences) continue;
    const matchValue = sampleMatchValue(p.samples[0]);
    if (!matchValue) continue; // pas de titre exploitable → pas de règle
    proposedRules.push({
      label: `Ajustement automatique ${p.fieldName} (${p.oldValue || 'indéfini'} → ${p.newValue})`,
      matchField: 'subject_or_body',
      matchType: 'contains',
      matchValue,
      fieldName: p.fieldName,
      suggestedValue: p.newValue,
      category: p.fieldName === 'category' ? p.newValue : null,
      ticketPriority: p.fieldName === 'priority' ? p.newValue : null,
      occurrenceCount: p.count,
      sampleTitles: p.samples,
      confidence: Math.min(0.95, 0.6 + p.count * 0.1),
    });
  }

  for (const r of rejections) {
    const matchValue = sampleMatchValue(r.title);
    if (!matchValue) continue;
    proposedRules.push({
      label: `Filtrage de rejet : ${r.approvalNote || r.title}`,
      matchField: 'subject_or_body',
      matchType: 'contains',
      matchValue,
      isSpam: true,
      reason: r.approvalNote || 'Rejeté par la Hotline',
      occurrenceCount: 1,
      confidence: 0.8,
    });
  }

  // Boucle de rétroaction : agréger les rejets par domaine d'expéditeur. Si un même domaine
  // concentre plusieurs rejets dans la période, proposer une règle anti-spam par domaine
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
    // Seuil configurable (5 par défaut) : un volume faible peut résulter d'un
    // mauvais rejet humain ponctuel.
    if (info.count < domainThreshold) continue;

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

  // Filtre de confiance configurable : n'inclure que les règles au-dessus du seuil.
  const keptRules = proposedRules.filter((r) => (r.confidence || 0) >= confidenceThreshold);

  const report = await prisma.aiWeeklyPatternReport.create({
    data: {
      startDate,
      endDate,
      totalCorrections: corrections.length,
      totalRejections: rejections.length,
      proposedRules: keptRules,
      status: 'PENDING',
    },
  });

  return { created: true, report };
}

// ── Génération automatique hebdomadaire ───────────────────────────────────────
// Appelé par le scheduler de server.js (tick court). Ne génère que si la config
// l'active et que le jour/heure configurés sont atteints (fuseau du serveur,
// Africa/Abidjan = UTC+0). Le dédoublonnage de fenêtre dans generateWeeklyReport
// protège contre les ticks multiples de la même heure.
async function maybeGenerateWeeklyReport() {
  const s = await getSystemSettings();
  if (!s.aiWeeklyAutoEnabled) return null;
  const now = new Date();
  if (now.getDay() !== s.aiWeeklyDay || now.getHours() !== s.aiWeeklyHour) return null;
  const result = await generateWeeklyReport();
  if (result.created) {
    console.log(`[aiWeeklyReport] Rapport hebdomadaire auto #${result.report.id} généré automatiquement`);
  } else if (result.reason === 'duplicate') {
    console.log(`[aiWeeklyReport] Génération auto ignorée : rapport récent déjà présent (#${result.report?.id})`);
  } else {
    console.log('[aiWeeklyReport] Génération auto ignorée : aucune donnée sur la fenêtre');
  }
  return result;
}

module.exports = { generateWeeklyReport, maybeGenerateWeeklyReport };
