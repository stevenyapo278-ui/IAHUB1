const prisma = require('../prismaClient');

// Rôle Prisma → libellé lisible injecté dans les prompts IA (les rôles bruts en anglais
// sont mal interprétés par le modèle dans un prompt rédigé en français).
const ROLE_LABELS = {
  SUPERADMIN: 'superadministrateur',
  ADMIN: 'administrateur',
  HOTLINE: 'hotline',
  TECHNICIAN: 'technicien',
  REQUESTER: 'demandeur',
};

// Résout l'identité plateforme d'un expéditeur email (rôle, équipes, appartenance au ticket)
// pour que les prompts de suivi sachent QUI PARLE — demandeur, technicien, ou inconnu.
// Ne lève jamais d'exception : dégrade vers une identité « inconnue ».
async function resolveSenderIdentity({ fromEmail, fromName = null, ticket = null } = {}) {
  const identity = {
    email: fromEmail || null,
    name: fromName || null,
    fullName: fromName || null,
    userId: null,
    role: null,
    teams: 'aucune',
    skills: 'aucune',
    known: false,
    isRequester: false,
  };

  if (fromEmail) {
    try {
      const user = await prisma.user.findUnique({
        where: { email: fromEmail.trim().toLowerCase() },
        select: {
          id: true,
          fullName: true,
          role: true,
          team: { select: { name: true } },
          skills: { select: { skill: { select: { name: true } } } },
        },
      });
      if (user) {
        identity.userId = user.id;
        identity.fullName = user.fullName || fromName || fromEmail;
        identity.role = user.role;
        identity.teams = user.team?.name || 'aucune';
        identity.skills = user.skills?.map((s) => s.skill.name).filter(Boolean).join(', ') || 'aucune';
        identity.known = true;
      }
    } catch (err) {
      console.warn(`[senderIdentity] Résolution expéditeur impossible (${fromEmail}) : ${err.message}`);
    }
  }

  if (ticket && fromEmail) {
    const email = fromEmail.trim().toLowerCase();
    const linkedByAccount = !!identity.userId && (
      ticket.requesterId === identity.userId
      || ticket.secondaryRequesterId === identity.userId
      || (Array.isArray(ticket.requesterIds) && ticket.requesterIds.includes(identity.userId))
    );
    const linkedBySource = !!ticket.sourceEmail && ticket.sourceEmail.trim().toLowerCase() === email;
    identity.isRequester = linkedByAccount || linkedBySource;
  }

  return identity;
}

// Variables de prompt à transmettre telles quelles à getPrompt() (analyses d'intention,
// réponses de suivi, résumés de mail).
function senderPromptVars(sender) {
  return {
    senderName: sender?.fullName || sender?.name || sender?.email || 'Inconnu',
    senderRole: sender?.known
      ? (ROLE_LABELS[sender.role] || sender.role)
      : 'inconnu (aucun compte plateforme)',
    senderIsRequester: sender?.isRequester ? 'oui' : 'non',
    senderTeams: sender?.teams || 'aucune',
  };
}

module.exports = { resolveSenderIdentity, senderPromptVars, ROLE_LABELS };
