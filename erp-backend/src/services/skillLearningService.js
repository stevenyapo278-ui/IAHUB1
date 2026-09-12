const prisma = require('../prismaClient');
const { getActiveProviders, callProviderWithFallback } = require('./mailAnalyzer');
const { getPrompt } = require('./promptTemplates');

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-APPRENTISSAGE POST-RÉSOLUTION
// ═══════════════════════════════════════════════════════════════════════════
// Quand un ticket passe en SOLVED/CLOSED, ce service :
// 1. Crée (upsert) une compétence = catégorie du ticket
// 2. Analyse le ticket via IA pour extraire une sous-compétence fine
// 3. Associe le technicien résolvant avec un niveau basé sur la priorité
//
// Mapping priorité → niveau :
//   P1 (Critique) → 5 (Expert)
//   P2 (Haute)    → 4 (Avancé)
//   P3 (Moyenne)  → 3 (Confirmé)
//   P4 (Basse)    → 2 (Junior)

const PRIORITY_TO_LEVEL = { P1: 5, P2: 4, P3: 3, P4: 2 };

// ═══════════════════════════════════════════════════════════════════════════
// POINT D'ENTRÉE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Apprend d'un ticket résolu : crée les compétences et associe le technicien.
 * Appelé de manière asynchrone (fire-and-forget) depuis les routes de résolution.
 * Ne doit JAMAIS bloquer la résolution du ticket.
 *
 * @param {number} ticketId
 * @returns {{ categorySkill: object|null, fineSkill: object|null, userSkills: object[] }}
 */
async function learnFromResolution(ticketId) {
  // 1. Récupérer le ticket avec les données nécessaires
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      title: true,
      content: true,
      category: true,
      priority: true,
      assignedToId: true,
      teamId: true,
      type: true,
      status: true,
    },
  });

  if (!ticket) {
    console.error(`[skillLearning] Ticket ${ticketId} introuvable`);
    return null;
  }

  // Garde-fou : pas de technicien ou pas de catégorie = rien à apprendre
  if (!ticket.assignedToId) {
    console.log(`[skillLearning] Ticket ${ticketId} sans technicien assigné → ignoré`);
    return null;
  }
  if (!ticket.category) {
    console.log(`[skillLearning] Ticket ${ticketId} sans catégorie → ignoré`);
    return null;
  }

  // Ne traiter que les tickets résolus/fermés
  if (ticket.status !== 'SOLVED' && ticket.status !== 'CLOSED') {
    console.log(`[skillLearning] Ticket ${ticketId} status "${ticket.status}" → ignoré`);
    return null;
  }

  const level = PRIORITY_TO_LEVEL[ticket.priority] || 3;
  const result = { categorySkill: null, fineSkill: null, userSkills: [] };

  try {
    // 2. Upsert compétence catégorie
    result.categorySkill = await upsertCategorySkill(ticket.category, ticket.teamId);

    // 3. Associer le technicien à la compétence catégorie
    if (result.categorySkill) {
      const us = await upsertUserSkill(ticket.assignedToId, result.categorySkill.id, level);
      if (us) result.userSkills.push(us);
    }

    // 4. Analyse IA pour compétence fine (optionnel, ne pas bloquer en cas d'échec)
    try {
      result.fineSkill = await extractAndCreateFineSkill(ticket, level);
      if (result.fineSkill) {
        const us = await upsertUserSkill(ticket.assignedToId, result.fineSkill.id, level);
        if (us) result.userSkills.push(us);
      }
    } catch (err) {
      console.error(`[skillLearning] Analyse IA échouée (ticket ${ticketId}):`, err.message);
    }

    console.log(`[skillLearning] Ticket ${ticketId} traité : catégorie="${ticket.category}", fine="${result.fineSkill?.name || 'aucune'}", tech=${ticket.assignedToId}, niveau=${level}`);
    return result;
  } catch (err) {
    console.error(`[skillLearning] Échec apprentissage ticket ${ticketId}:`, err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPÉTENCE CATÉGORIE
// ═══════════════════════════════════════════════════════════════════════════

async function upsertCategorySkill(categoryName, teamId) {
  const name = String(categoryName).trim();
  if (!name) return null;

  try {
    const existing = await prisma.skill.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) return existing;

    const created = await prisma.skill.create({
      data: {
        name,
        category: name,
        description: `Compétence auto-créée depuis la catégorie "${name}"`,
      },
    });
    console.log(`[skillLearning] Compétence catégorie créée : "${created.name}"`);
    return created;
  } catch (err) {
    // Concur run race : un autre processus a peut-être créé la skill entre-temps
    if (err.code === 'P2002') {
      return prisma.skill.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    }
    console.error(`[skillLearning] Échec upsert catégorie "${name}":`, err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPÉTENCE FINE (IA)
// ═══════════════════════════════════════════════════════════════════════════

async function extractAndCreateFineSkill(ticket, level) {
  const providers = await getActiveProviders();
  if (providers.length === 0) {
    console.log('[skillLearning] Aucun provider IA configuré → compétence fine ignorée');
    return null;
  }

  const prompt = await getPrompt('extractSkill', {
    ticketTitle: ticket.title || '',
    ticketContent: (ticket.content || '').substring(0, 3000),
    ticketCategory: ticket.category || '',
  });

  const raw = await callProviderWithFallback(providers, prompt, 'background');
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.log(`[skillLearning] Pas de JSON dans la réponse IA : ${raw.substring(0, 150)}`);
    return null;
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const skillName = (parsed.skill || '').trim();
  const skillCategory = (parsed.category || ticket.category || '').trim();

  if (!skillName || skillName.length < 2 || skillName.length > 50) {
    console.log(`[skillLearning] Nom de compétence IA invalide : "${skillName}"`);
    return null;
  }

  // Ne pas créer si la compétence fine est identique à la catégorie
  if (skillName.toLowerCase() === (ticket.category || '').toLowerCase()) {
    return null;
  }

  return upsertFineSkill(skillName, skillCategory);
}

async function upsertFineSkill(name, category) {
  try {
    const existing = await prisma.skill.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) return existing;

    const created = await prisma.skill.create({
      data: {
        name,
        category: category || null,
        description: `Compétence fine auto-créée par l'IA`,
      },
    });
    console.log(`[skillLearning] Compétence fine créée : "${created.name}" (catégorie: ${category})`);
    return created;
  } catch (err) {
    if (err.code === 'P2002') {
      return prisma.skill.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    }
    console.error(`[skillLearning] Échec upsert compétence fine "${name}":`, err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ASSOCIATION TECHNI-COMPÉTENCE
// ═══════════════════════════════════════════════════════════════════════════

async function upsertUserSkill(userId, skillId, level) {
  if (!userId || !skillId) return null;

  try {
    const existing = await prisma.userSkill.findUnique({
      where: { userId_skillId: { userId, skillId } },
    });

    if (existing) {
      // Augmenter le niveau si le nouveau est supérieur (le technicien progresse)
      if (level > existing.level) {
        const updated = await prisma.userSkill.update({
          where: { id: existing.id },
          data: { level },
        });
        console.log(`[skillLearning] UserSkill mise à jour : user=${userId} skill=${skillId} niveau ${existing.level}→${level}`);
        return updated;
      }
      return existing; // Déjà à ce niveau ou supérieur, rien à faire
    }

    const created = await prisma.userSkill.create({
      data: { userId, skillId, level },
    });
    console.log(`[skillLearning] UserSkill créée : user=${userId} skill=${skillId} niveau=${level}`);
    return created;
  } catch (err) {
    console.error(`[skillLearning] Échec upsert userSkill (user=${userId}, skill=${skillId}):`, err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STATISTIQUES
// ═══════════════════════════════════════════════════════════════════════════

async function getLearningStats() {
  const [totalSkills, autoCreatedSkills, totalUserSkills, recentAssignments] = await Promise.all([
    prisma.skill.count(),
    prisma.skill.count({ where: { description: { contains: 'auto-créée' } } }),
    prisma.userSkill.count(),
    prisma.userSkill.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      include: { skill: { select: { name: true } }, user: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);

  return {
    totalSkills,
    autoCreatedSkills,
    manualSkills: totalSkills - autoCreatedSkills,
    totalUserSkills,
    recentAssignments,
  };
}

module.exports = { learnFromResolution, getLearningStats };
