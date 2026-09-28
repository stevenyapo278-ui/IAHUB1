const prisma = require('../prismaClient');
const { calculatePriority } = require('./emailPriorityMatrix');

// Même périmètre que ticketAutoAssign.js : charge active, corbeille et tickets
// non validés (PENDING/REJECTED) exclus du calcul.
const ACTIVE_STATUSES = ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER'];
const CHARGE_BASE = { deletedAt: null, approvalStatus: { notIn: ['PENDING', 'REJECTED'] } };

const countOf = (row) => (typeof row?._count === 'object' ? row._count?.id || 0 : row?._count || 0);

// ── Collecte des candidats ────────────────────────────────────────────────────
// Compétence exacte → compétence partielle (mots ≥ 3) → membres de l'équipe.
// Retourne TOUS les candidats (contrairement à findBestTechnician qui ne garde que le top)
// afin de les scorer avec l'historique et la charge.
async function collectCandidates(skillName, teamName) {
  const userWhere = { isActive: true, role: { in: ['TECHNICIAN', 'ADMIN', 'SUPERADMIN'] } };
  const candidates = [];
  let method = 'team';
  let skill = skillName || null;

  // Étape 1 : compétence exacte
  if (skill && skill.trim()) {
    const exact = await prisma.userSkill.findMany({
      where: { skill: { name: { equals: skill.trim(), mode: 'insensitive' } }, user: userWhere },
      include: { user: { select: { id: true, fullName: true, teamId: true } } },
    });
    if (exact.length > 0) {
      for (const s of exact) candidates.push({ id: s.user.id, fullName: s.user.fullName, teamId: s.user.teamId, skillLevel: s.level, method: 'skill' });
      method = 'skill';
    } else {
      // Étape 1b : compétence partielle — union des skills matchant un mot significant
      const words = skill.trim().split(/\s+/).filter((w) => w.length >= 3);
      const seen = new Set();
      for (const word of words) {
        const partial = await prisma.userSkill.findMany({
          where: { skill: { name: { contains: word, mode: 'insensitive' } }, user: userWhere },
          include: { user: { select: { id: true, fullName: true, teamId: true } } },
        });
        for (const s of partial) {
          if (seen.has(s.user.id)) continue;
          seen.add(s.user.id);
          candidates.push({ id: s.user.id, fullName: s.user.fullName, teamId: s.user.teamId, skillLevel: s.level, method: 'skill_partial' });
        }
        if (seen.size > 0) { method = 'skill_partial'; break; }
      }
    }
  }

  // Étape 2 : membres de l'équipe (par nom d'équipe, sinon par catégorie)
  if (candidates.length === 0 && teamName) {
    const team = await prisma.team.findFirst({
      where: { name: { equals: teamName, mode: 'insensitive' } },
      include: { members: { where: userWhere, select: { id: true, fullName: true, teamId: true } } },
    });
    if (team) {
      for (const m of team.members) candidates.push({ id: m.id, fullName: m.fullName, teamId: m.teamId, skillLevel: null, method: 'team' });
      method = 'team';
    }
  }

  return { candidates, method, skill };
}

// ── Historique et charge des candidats ────────────────────────────────────────
async function buildHistory(techIds, category) {
  if (techIds.length === 0) return { history: {}, maxLoad: 0 };

  const [loads, totals, sameCategory, resolvedSame, corrected] = await Promise.all([
    prisma.ticket.groupBy({
      by: ['assignedToId'],
      where: { ...CHARGE_BASE, assignedToId: { in: techIds }, status: { in: ACTIVE_STATUSES } },
      _count: { id: true },
    }),
    prisma.ticket.groupBy({
      by: ['assignedToId'],
      where: { deletedAt: null, approvalStatus: { notIn: ['PENDING', 'REJECTED'] }, assignedToId: { in: techIds } },
      _count: { id: true },
    }),
    category
      ? prisma.ticket.groupBy({
          by: ['assignedToId'],
          where: { deletedAt: null, approvalStatus: { notIn: ['PENDING', 'REJECTED'] }, assignedToId: { in: techIds }, category: { equals: category, mode: 'insensitive' } },
          _count: { id: true },
        })
      : Promise.resolve([]),
    category
      ? prisma.ticket.groupBy({
          by: ['assignedToId'],
          where: { deletedAt: null, approvalStatus: { notIn: ['PENDING', 'REJECTED'] }, assignedToId: { in: techIds }, category: { equals: category, mode: 'insensitive' }, status: { in: ['SOLVED', 'CLOSED'] } },
          _count: { id: true },
        })
      : Promise.resolve([]),
    prisma.reassignmentLog.groupBy({
      by: ['previousTechnicianId'],
      where: { previousTechnicianId: { in: techIds }, wasAutoAssigned: true },
      _count: { id: true },
    }),
  ]);

  const history = {};
  for (const id of techIds) history[id] = { load: 0, handled: 0, same: 0, resolvedSame: 0, corrected: 0 };
  for (const r of loads) if (history[r.assignedToId]) history[r.assignedToId].load = countOf(r);
  for (const r of totals) if (history[r.assignedToId]) history[r.assignedToId].handled = countOf(r);
  for (const r of sameCategory) if (history[r.assignedToId]) history[r.assignedToId].same = countOf(r);
  for (const r of resolvedSame) if (history[r.assignedToId]) history[r.assignedToId].resolvedSame = countOf(r);
  for (const r of corrected) if (history[r.previousTechnicianId]) history[r.previousTechnicianId].corrected = countOf(r);

  const maxLoad = Math.max(1, ...techIds.map((id) => history[id].load));
  return { history, maxLoad };
}

// Score composite 0-100 : compétence (35 %) + taux de résolution historique (40 %)
// + disponibilité/charge (25 %), moins une pénalité pour les auto-assignments corrigées.
function scoreCandidate({ skillLevel, hist, maxLoad }) {
  const skillScore = skillLevel ? skillLevel / 5 : 0.35; // neutre si aucune compétence déclarée
  let histScore = 0.5;
  if (hist.same > 0) histScore = hist.resolvedSame / hist.same;
  else if (hist.handled > 0) histScore = Math.min(1, (hist.handled - hist.corrected) / hist.handled);
  const chargeScore = 1 - hist.load / maxLoad;
  const base = 100 * (0.35 * skillScore + 0.4 * histScore + 0.25 * chargeScore);
  return Math.max(0, Math.round(base - Math.min(30, hist.corrected * 10)));
}

function buildReasons(candidate, hist, skillName) {
  const reasons = [];
  if (candidate.skillLevel) reasons.push(`Compétence ${skillName} : niveau ${candidate.skillLevel}/5`);
  else if (skillName) reasons.push(`Compétence ${skillName} non déclarée — score fondé sur l'historique`);
  if (hist.same > 0) {
    const pct = Math.round((hist.resolvedSame / hist.same) * 100);
    reasons.push(`${hist.same} ticket(s) de même catégorie traités, ${hist.resolvedSame} résolus (${pct} %)`);
  } else if (hist.handled > 0) {
    reasons.push(`${hist.handled} ticket(s) traités au total`);
  } else {
    reasons.push('Aucun historique — candidat débutant sur ce périmètre');
  }
  reasons.push(hist.load === 0 ? 'Aucun ticket en cours (disponible)' : `${hist.load} ticket(s) en cours`);
  if (hist.corrected > 0) reasons.push(`${hist.corrected} auto-assignation(s) corrigée(s) par le passé`);
  return reasons;
}

// ── Candidats scorés (compétence + historique + charge) ───────────────────────
// Utilisé par findBestTechnician (auto-assign à la création) et par suggestTriage.
// options.fallbackAll : pour le Centre de Validation, ne jamais renvoyer vide —
// équipe ayant le plus traité la catégorie, sinon tous les techniciens actifs
// (score fondé sur l'historique et la charge seuls).
async function scoreCandidates(skillName, teamName, category, options = {}) {
  const { ranked: baseRanked, method, skill } = await scoreCandidateList(skillName, teamName, category);
  if (baseRanked.length > 0 || !options.fallbackAll) return { ranked: baseRanked, method, skill };

  // Fallback 1 : membres de l'équipe ayant le plus traité cette catégorie
  let candidates = [];
  let fallbackMethod = 'historique';
  if (category) {
    const byCat = await prisma.ticket.groupBy({
      by: ['teamId'],
      where: { deletedAt: null, approvalStatus: { notIn: ['PENDING', 'REJECTED'] }, teamId: { not: null }, category: { equals: category, mode: 'insensitive' } },
      _count: { id: true },
    });
    byCat.sort((a, b) => countOf(b) - countOf(a));
    for (const row of byCat) {
      const members = await prisma.team.findMany({
        where: { id: row.teamId, members: { some: { isActive: true, role: { in: ['TECHNICIAN', 'ADMIN', 'SUPERADMIN'] } } } },
        select: { id: true, name: true, members: { where: { isActive: true, role: { in: ['TECHNICIAN', 'ADMIN', 'SUPERADMIN'] } }, select: { id: true, fullName: true, teamId: true } } },
      });
      if (members[0]?.members?.length) {
        candidates = members[0].members.map((m) => ({ id: m.id, fullName: m.fullName, teamId: m.teamId, skillLevel: null, method: 'historique' }));
        break;
      }
    }
  }

  // Fallback 2 : tous les techniciens actifs (score compétence nul → historique + charge)
  if (candidates.length === 0) {
    const all = await prisma.user.findMany({
      where: { isActive: true, role: { in: ['TECHNICIAN', 'ADMIN', 'SUPERADMIN'] } },
      select: { id: true, fullName: true, teamId: true },
    });
    candidates = all.map((u) => ({ id: u.id, fullName: u.fullName, teamId: u.teamId, skillLevel: null, method: 'fallback' }));
    fallbackMethod = 'fallback';
  }
  if (candidates.length === 0) return { ranked: [], method: fallbackMethod, skill };

  const ids = candidates.map((c) => c.id);
  const { history, maxLoad } = await buildHistory(ids, category);
  const ranked = candidates
    .map((c) => {
      const hist = history[c.id];
      return { ...c, hist, score: scoreCandidate({ skillLevel: c.skillLevel, hist, maxLoad }) };
    })
    .sort((a, b) => (b.score - a.score) || a.hist.load - b.hist.load);
  return { ranked, method: fallbackMethod, skill };
}

async function scoreCandidateList(skillName, teamName, category) {
  const { candidates, method, skill } = await collectCandidates(skillName, teamName);
  if (candidates.length === 0) return { ranked: [], method, skill };

  const ids = candidates.map((c) => c.id);
  const { history, maxLoad } = await buildHistory(ids, category);

  const ranked = candidates
    .map((c) => {
      const hist = history[c.id];
      return { ...c, hist, score: scoreCandidate({ skillLevel: c.skillLevel, hist, maxLoad }) };
    })
    .sort((a, b) => (b.score - a.score) || a.hist.load - b.hist.load);

  return { ranked, method, skill };
}

// ── Suggestion d'équipe ───────────────────────────────────────────────────────
// Hiérarchie : équipe suggérée par l'IA → équipe ayant le plus traité cette
// catégorie (historique) → équipe du meilleur candidat → équipe par nom.
async function suggestTeam({ aiTeam, aiTeamId, category, bestCandidate }) {
  if (aiTeamId) {
    const team = await prisma.team.findUnique({ where: { id: aiTeamId }, select: { id: true, name: true } });
    if (team) return { ...team, reasons: [`Équipe suggérée par l'IA (${aiTeam || category})`], source: 'ia' };
  }

  const byCategory = await prisma.ticket.groupBy({
    by: ['teamId'],
    where: { deletedAt: null, approvalStatus: { notIn: ['PENDING', 'REJECTED'] }, teamId: { not: null }, ...(category ? { category: { equals: category, mode: 'insensitive' } } : {}) },
    _count: { id: true },
  });
  if (byCategory.length > 0) {
    byCategory.sort((a, b) => countOf(b) - countOf(a));
    const top = await prisma.team.findUnique({ where: { id: byCategory[0].teamId }, select: { id: true, name: true } });
    if (top) return { ...top, reasons: [`Historique : ${countOf(byCategory[0])} ticket(s) de la catégorie ${category || '(toutes)'} traités par cette équipe`], source: 'historique' };
  }

  if (bestCandidate?.teamId) {
    const team = await prisma.team.findUnique({ where: { id: bestCandidate.teamId }, select: { id: true, name: true } });
    if (team) return { ...team, reasons: [`Équipe du technicien suggéré (${bestCandidate.fullName})`], source: 'candidat' };
  }

  if (category) {
    const team = await prisma.team.findFirst({ where: { name: { equals: category, mode: 'insensitive' } }, select: { id: true, name: true } });
    if (team) return { ...team, reasons: [`Équipe correspondant à la catégorie ${category}`], source: 'nom' };
  }
  return null;
}

// ── Suggestion d'observateurs ─────────────────────────────────────────────────
// DefaultObservers de l'équipe + techniciens ayant traité cette catégorie
// (hors technicien assigné) — maximum 4, triés par score décroissant.
// `db` permet d'utiliser la connexion d'une transaction (ticketCreator).
async function suggestObservers({ teamId, category, excludeIds = [], db = prisma }) {
  const suggestions = [];
  const seen = new Set(excludeIds);

  if (teamId) {
    const team = await db.team.findUnique({
      where: { id: teamId },
      select: { defaultObservers: { select: { id: true, fullName: true } } },
    });
    for (const o of team?.defaultObservers || []) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      suggestions.push({ ...o, reasons: ['Observateur par défaut de l\'équipe'], source: 'equipe' });
    }
  }

  if (category && suggestions.length < 4) {
    const byCat = await db.ticket.groupBy({
      by: ['assignedToId'],
      where: { deletedAt: null, approvalStatus: { notIn: ['PENDING', 'REJECTED'] }, assignedToId: { not: null }, category: { equals: category, mode: 'insensitive' } },
      _count: { id: true },
    });
    byCat.sort((a, b) => countOf(b) - countOf(a));
    const ids = byCat.map((r) => r.assignedToId).filter((id) => !seen.has(id)).slice(0, 4 - suggestions.length);
    if (ids.length > 0) {
      const users = await db.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, fullName: true } });
      const countById = Object.fromEntries(byCat.map((r) => [r.assignedToId, countOf(r)]));
      for (const u of users) {
        if (seen.has(u.id)) continue;
        seen.add(u.id);
        suggestions.push({ ...u, reasons: [`Historique : a traité ${countById[u.id]} ticket(s) de cette catégorie`], source: 'historique' });
      }
    }
  }

  return suggestions.slice(0, 4);
}

// ── Suggestion de priorité ────────────────────────────────────────────────────
// Matrice impact×urgency (règle ITIL, déterministe) confrontée à la priorité
// dominante de l'historique de la catégorie.
async function suggestPriority({ ticket }) {
  const reasons = [];
  const matrix = calculatePriority(ticket.impact, ticket.urgency, ticket.type);
  const ALIASES = { VERY_LOW: 'LOW', VERY_HIGH: 'CRITICAL', MAJOR: 'CRITICAL' };
  const aliased = [ALIASES[(ticket.impact || '').toUpperCase()], ALIASES[(ticket.urgency || '').toUpperCase()]].filter(Boolean);
  reasons.push(
    `Matrice impact × urgence : ${ticket.impact || 'MEDIUM'} / ${ticket.urgency || 'MEDIUM'}${aliased.length ? ` (≡ ${aliased.join(' / ')})` : ''} → ${matrix}`,
  );

  let historical = null;
  if (ticket.category) {
    const byPrio = await prisma.ticket.groupBy({
      by: ['priority'],
      where: { deletedAt: null, approvalStatus: { notIn: ['PENDING', 'REJECTED'] }, category: { equals: ticket.category, mode: 'insensitive' } },
      _count: { id: true },
    });
    if (byPrio.length > 0) {
      byPrio.sort((a, b) => countOf(b) - countOf(a));
      historical = byPrio[0].priority;
      reasons.push(`Historique de la catégorie ${ticket.category} : priorité dominante ${historical} (${countOf(byPrio[0])} ticket(s))`);
    }
  }

  // La matrice ITIL prime (déterministe) ; l'historique sert d'indice affiché
  return { value: matrix, historical, reasons, current: ticket.priority };
}

// ── Champs suggérés à la création + alternatives issues de l'historique ──────
// Tant que le ticket est PENDING, ses champs (titre, catégorie, type, impact,
// urgence, localisation) sont des suggestions à valider : on les renvoie avec
// leur source (IA de triage ou saisie) et, quand l'historique le permet, une
// alternative calculée (catégorie dominante du demandeur, type dominant de la
// catégorie).
async function suggestAnalysisFields(ticket) {
  const source = !ticket.aiProcessed
    ? 'Saisi manuellement'
    : ticket.origin === 'MANUAL'
      ? 'Saisie manuelle + analyse IA'
      : 'Suggéré par l\'IA de triage';
  const analysis = {
    source,
    category: ticket.category,
    categoryAlternative: null,
    type: ticket.type,
    typeHint: null,
    impact: ticket.impact,
    urgency: ticket.urgency,
    location: ticket.locationName,
  };

  // Catégorie dominante des AUTRES tickets du même demandeur (requesterId, sinon
  // email source) — proposition seulement si nette prédominance sur un historique suffisant.
  if (ticket.category && (ticket.requesterId || ticket.sourceEmail)) {
    try {
      const rawHist = await prisma.ticket.groupBy({
        by: ['category'],
        where: {
          ...(ticket.requesterId ? { requesterId: ticket.requesterId } : { sourceEmail: ticket.sourceEmail }),
          deletedAt: null,
          approvalStatus: { notIn: ['PENDING', 'REJECTED'] },
          id: { not: ticket.id },
        },
        _count: { id: true },
      });
      const hist = rawHist.filter((r) => r.category);
      const total = hist.reduce((sum, r) => sum + countOf(r), 0);
      if (total >= 3 && hist.length > 0) {
        hist.sort((a, b) => countOf(b) - countOf(a));
        const top = hist[0];
        const rate = Math.round((countOf(top) / total) * 100);
        analysis.categoryHistory = { total, top: top.category, count: countOf(top), rate };
        if (top.category !== ticket.category && rate >= 60) {
          analysis.categoryAlternative = {
            value: top.category,
            reasons: [`Historique du demandeur : ${countOf(top)}/${total} ticket(s) en catégorie « ${top.category} » (${rate} %)`],
          };
        }
      }
    } catch (err) {
      console.error('[ticketSuggestionService] Historique catégorie demandeur échoué:', err.message);
    }
  }

  // Type dominant dans la catégorie (indice, pas de proposition automatique)
  if (ticket.category) {
    try {
      const rawByType = await prisma.ticket.groupBy({
        by: ['type'],
        where: { deletedAt: null, approvalStatus: { notIn: ['PENDING', 'REJECTED'] }, category: { equals: ticket.category, mode: 'insensitive' } },
        _count: { id: true },
      });
      const byType = rawByType.filter((r) => r.type);
      const total = byType.reduce((sum, r) => sum + countOf(r), 0);
      if (total >= 3 && byType.length > 0) {
        byType.sort((a, b) => countOf(b) - countOf(a));
        const top = byType[0];
        const rate = Math.round((countOf(top) / total) * 100);
        analysis.typeHint = { dominant: top.type, rate, count: countOf(top), total };
      }
    } catch (err) {
      console.error('[ticketSuggestionService] Historique type catégorie échoué:', err.message);
    }
  }

  return analysis;
}

// ── Suggestions complètes d'un ticket ─────────────────────────────────────────
async function suggestTriage(ticket) {
  const skill = ticket.aiSkill || ticket.suggestedSkill || ticket.category || null;
  const { ranked, method, skill: resolvedSkill } = await scoreCandidates(
    skill,
    ticket.team?.name || ticket.category,
    ticket.category,
    { fallbackAll: true },
  );

  const best = ranked[0] || null;
  const team = await suggestTeam({
    aiTeamId: ticket.teamId || null,
    aiTeam: ticket.team?.name || null,
    category: ticket.category,
    bestCandidate: best,
  });

  const technician = best
    ? {
        id: best.id,
        fullName: best.fullName,
        score: best.score,
        method,
        skillLevel: best.skillLevel,
        load: best.hist.load,
        handled: best.hist.handled,
        sameCategory: best.hist.same,
        resolvedSame: best.hist.resolvedSame,
        corrected: best.hist.corrected,
        reasons: buildReasons(best, best.hist, resolvedSkill),
        current: ticket.assignedToId === best.id,
      }
    : null;

  const [observers, priority, analysis] = await Promise.all([
    suggestObservers({
      teamId: team?.id || ticket.teamId || null,
      category: ticket.category,
      excludeIds: [best?.id, ticket.assignedToId].filter(Boolean),
    }),
    suggestPriority({ ticket }),
    suggestAnalysisFields(ticket),
  ]);

  return {
    analysis,
    technician,
    team: team ? { ...team, current: ticket.teamId === team.id } : null,
    observers,
    priority,
    ranked: ranked.slice(0, 5).map((c) => ({
      id: c.id, fullName: c.fullName, score: c.score, skillLevel: c.skillLevel,
      load: c.hist.load, same: c.hist.same, resolvedSame: c.hist.resolvedSame,
      reasons: buildReasons(c, c.hist, resolvedSkill),
    })),
  };
}

module.exports = { suggestTriage, suggestAnalysisFields, scoreCandidates, suggestObservers, suggestPriority, collectCandidates, buildHistory, scoreCandidate };
