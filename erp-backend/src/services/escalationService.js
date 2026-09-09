const prisma = require('../prismaClient');
const { logEvent } = require('./ticketEvent');
const { emitTicketEscalated, emitTicketAssigned } = require('../utils/socket');
const { sendEscalationEmail, sendRequesterEscalationEmail } = require('./emailSender');

const ACTIVE_STATUSES = ['NEW', 'OPEN', 'PLANNED', 'PENDING'];

// Planifie une escalade automatique sur le ticket (règle de triage avec autoEscalateMinutes).
// Appelé à la création du ticket (pipeline email) — le moniteur déclenche l'escalade à l'échéance.
async function scheduleEscalation(ticketId, minutes, triageRuleId = null) {
  if (!minutes || minutes <= 0) return null;
  return prisma.ticket.update({
    where: { id: ticketId },
    data: { escalateAt: new Date(Date.now() + minutes * 60000), triageRuleId: triageRuleId || null },
  });
}

// Escalade = TRANSFERT DE RESPONSABILITÉ vers une équipe (jamais un « niveau ») :
// la sécurité valide une demande d'ouverture de port, mais c'est le Système qui l'exécute —
// le ticket change donc d'équipe responsable (et éventuellement de technicien).
// Partagée entre le moniteur automatique et le bouton manuel : événement tracé,
// notification socket, emails (équipe cible, admins, technicien sortant, demandeur).
//
// Gardes de statut : une escalade n'a de sens que sur un ticket ACTIF — il y a un travail
// en cours à pousser vers la bonne équipe. Sur un ticket résolu/fermé/rejeté/corbeille,
// il n'y a plus rien à transférer : l'escalade ne ferait que déclencher des notifications
// parasites et gonfler le niveau d'escalade. WAITING_FOR_USER reste escaladable (état
// actif de traitement : demandeur silencieux, besoin de relance par la bonne équipe).
const ESCALATABLE_STATUSES = ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER'];
const ESCALATION_STATUS_ERROR = "Impossible d'escalader un ticket résolu, fermé ou rejeté — rouvrez-le d'abord si le problème persiste.";

async function escalateTicket(ticketId, {
  reason = null,
  actor = 'SYSTEM',
  source = 'auto',
  targetTeamId = null,
  assignedToId = undefined, // undefined = ne pas toucher à l'assignation ; null = désassigner explicitement
} = {}) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      assignedTo: { select: { id: true, email: true, fullName: true } },
      requester: { select: { id: true, email: true, fullName: true } },
      team: { select: { id: true, name: true } },
      // NB : sourceEmail / sourceName sont des CHAMPS SCALAIRES — ils sont renvoyés
      // d'office par Prisma quand on utilise `include` sans `select`. Les lister ici
      // levait une erreur de validation (« Invalid scalar field for include ») et
      // faisait échouer TOUTE escalade (500) — c'est ce qui rendait le bouton
      // « Escalader » inopérant. Fallback demandeur pour les tickets créés par email :
      // lire ticket.sourceEmail / ticket.sourceName directement sur l'objet.
    },
  });
  if (!ticket) throw new Error('Ticket introuvable');
  if (ticket.deletedAt) throw new Error('Ticket introuvable'); // corbeille : ne pas révéler son existence
  // Garde de statut partagée auto + manuel : le moniteur filtre déjà via ACTIVE_STATUSES
  // en amont, mais la défense en profondeur garantit qu'aucun chemin (API, UI périmée)
  // ne peut escalader un ticket dont le travail est terminé.
  if (ticket.status && !ESCALATABLE_STATUSES.includes(ticket.status)) {
    throw new Error(ESCALATION_STATUS_ERROR);
  }

  // Résolution de l'équipe cible : fournie explicitement, sinon l'équipe courante
  // (escalade « au sein de l'équipe » = simple alerte de prise en charge prioritaire).
  let targetTeam = ticket.team;
  if (targetTeamId != null && targetTeamId !== '' && Number(targetTeamId) !== ticket.team?.id) {
    targetTeam = await prisma.team.findUnique({
      where: { id: Number(targetTeamId) },
      select: {
        id: true, name: true, groupEmail: true,
        // Observateurs par défaut de l'équipe cible — ils suivent le ticket lors du
        // transfert (même convention que le changement d'équipe manuel dans l'interface).
        defaultObservers: { select: { id: true } },
      },
    });
    if (!targetTeam) throw new Error('Équipe cible introuvable');
  }

  // Résolution du technicien cible : doit exister, être un TECHNICIEN actif et,
  // quand une équipe cible est définie, appartenir à cette équipe.
  let targetTechnician = null;
  if (assignedToId != null && assignedToId !== '') {
    targetTechnician = await prisma.user.findFirst({
      where: { id: Number(assignedToId), role: 'TECHNICIAN', isActive: true },
      select: { id: true, email: true, fullName: true, teamId: true },
    });
    if (!targetTechnician) throw new Error('Le technicien sélectionné est introuvable ou n\'a pas le rôle technicien');
    if (targetTeam && targetTechnician.teamId !== targetTeam.id) {
      throw new Error('Le technicien sélectionné n\'appartient pas à l\'équipe cible');
    }
  }

  const now = new Date();
  const teamChanged = targetTeam && targetTeam.id !== ticket.team?.id;
  const data = { escalatedAt: now, escalateAt: null };
  if (teamChanged) data.teamId = targetTeam.id;
  if (assignedToId !== undefined) {
    // assignedToId explicite (valeur ou null) : on applique ; sinon on ne touche pas à l'assignation.
    data.assignedToId = targetTechnician ? targetTechnician.id : null;
    // Synchroniser la relation many-to-many assignees : l'interface « Attribué à » affiche
    // assignees en priorité — sans cette synchro, l'ancien technicien restait affiché malgré
    // le changement d'assignedToId (escalade « ne changeait pas le technicien »).
    data.assignees = targetTechnician ? { set: [{ id: targetTechnician.id }] } : { set: [] };
  } else if (teamChanged) {
    // Transfert d'équipe sans technicien explicite : l'ancien technicien n'a plus la main —
    // le ticket retourne dans le pool de l'équipe cible (auto-assignation ou prise en charge manuelle).
    data.assignedToId = null;
    data.assignees = { set: [] };
  }
  // Transfert d'équipe : les observateurs par défaut de l'équipe cible suivent le ticket
  // (remplacement complet — même convention que le changement d'équipe manuel dans l'interface).
  if (teamChanged && targetTeam && Array.isArray(targetTeam.defaultObservers) && targetTeam.defaultObservers.length > 0) {
    data.observers = { set: targetTeam.defaultObservers.map((o) => ({ id: o.id })) };
  }
  // L'escalade reste marquée sur le ticket (historique/audit) mais ne « monte » plus de niveau :
  // le compteur suit uniquement le nombre de transferts successifs.
  const escalationLevel = (ticket.escalationLevel || 0) + 1;
  data.escalationLevel = escalationLevel;

  const updated = await prisma.ticket.update({ where: { id: ticketId }, data });

  await logEvent(ticketId, 'ESCALATED', actor, {
    source,
    reason,
    escalationLevel,
    fromTeam: ticket.team ? { id: ticket.team.id, name: ticket.team.name } : null,
    toTeam: teamChanged ? { id: targetTeam.id, name: targetTeam.name } : null,
    assignedToId: data.assignedToId !== undefined ? data.assignedToId : undefined,
  });

  emitTicketEscalated(updated, { reason, escalationLevel, targetTeamName: teamChanged ? targetTeam.name : null });
  if (teamChanged || data.assignedToId !== undefined) {
    // Recharge minimal pour la notif d'assignation (noms d'équipe/technicien à jour)
    const fresh = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, title: true, teamId: true, assignedToId: true, team: { select: { id: true, name: true } }, assignedTo: { select: { id: true, fullName: true } } },
    });
    if (fresh) emitTicketAssigned(fresh);
  }

  // ── Notifications email (dédupliquées par adresse) ─────────────────────────
  try {
    const alreadyNotified = new Set();

    // 1. Équipe cible : adresse de groupe + membres actifs — ce sont eux qui doivent
    //    désormais prendre en charge le ticket.
    let targetMembers = [];
    if (targetTeam) {
      targetMembers = await prisma.user.findMany({
        where: { teamId: targetTeam.id, isActive: true, email: { not: null } },
        select: { email: true, fullName: true },
      });
    }
    const targetRecipients = [
      ...(targetTeam?.groupEmail ? [{ email: targetTeam.groupEmail, fullName: targetTeam.name }] : []),
      ...targetMembers,
    ];
    for (const member of targetRecipients) {
      if (!member.email || alreadyNotified.has(member.email.toLowerCase())) continue;
      alreadyNotified.add(member.email.toLowerCase());
      sendEscalationEmail({
        ticketId,
        ticketTitle: ticket.title,
        priority: ticket.priority,
        reason,
        escalationLevel,
        targetTeamName: teamChanged ? targetTeam.name : null,
        recipientEmail: member.email,
        recipientName: member.fullName,
      }).catch((err) => console.error(`[escalationService] Échec email escalade équipe (ticket ${ticketId}):`, err.message));
    }

    // 2. Admins (ils n'ont pas toujours l'application ouverte)
    const admins = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPERADMIN'] }, isActive: true, email: { not: null } },
      select: { email: true, fullName: true },
    });
    for (const admin of admins) {
      if (!admin.email || alreadyNotified.has(admin.email.toLowerCase())) continue;
      alreadyNotified.add(admin.email.toLowerCase());
      sendEscalationEmail({
        ticketId,
        ticketTitle: ticket.title,
        priority: ticket.priority,
        reason,
        escalationLevel,
        targetTeamName: teamChanged ? targetTeam.name : null,
        recipientEmail: admin.email,
        recipientName: admin.fullName,
      }).catch((err) => console.error(`[escalationService] Échec email escalade admin (ticket ${ticketId}):`, err.message));
    }

    // 3. Technicien sortant (s'il est remplacé, il doit savoir qu'il n'a plus la main)
    const previousTechnician = ticket.assignedTo;
    if (data.assignedToId !== undefined && previousTechnician?.email
      && (!targetTechnician || previousTechnician.id !== targetTechnician.id)
      && !alreadyNotified.has(previousTechnician.email.toLowerCase())) {
      alreadyNotified.add(previousTechnician.email.toLowerCase());
      sendEscalationEmail({
        ticketId,
        ticketTitle: ticket.title,
        priority: ticket.priority,
        reason,
        escalationLevel,
        targetTeamName: teamChanged ? targetTeam.name : null,
        recipientEmail: previousTechnician.email,
        recipientName: previousTechnician.fullName,
      }).catch((err) => console.error(`[escalationService] Échec email escalade technicien sortant (ticket ${ticketId}):`, err.message));
    }

    // 4. Demandeur : utilisateur interne du ticket, sinon expéditeur du mail d'origine (sourceEmail)
    const requesterEmail = ticket.requester?.email || ticket.sourceEmail;
    const requesterName = ticket.requester?.fullName || ticket.sourceName;
    if (requesterEmail && !alreadyNotified.has(requesterEmail.toLowerCase())) {
      sendRequesterEscalationEmail({
        ticketId,
        ticketTitle: ticket.title,
        priority: ticket.priority,
        reason,
        targetTeamName: teamChanged ? targetTeam.name : null,
        recipientEmail: requesterEmail,
        recipientName: requesterName,
      }).catch((err) => console.error(`[escalationService] Échec email escalade demandeur (ticket ${ticketId}):`, err.message));
    }
  } catch (err) {
    console.error('[escalationService] Échec envoi emails escalade:', err.message);
  }

  return updated;
}

// Moniteur : déclenche les escalades planifiées arrivées à échéance sur des tickets actifs.
// Exécuté au même cycle que le moniteur SLA (slaMonitorIntervalSeconds).
// Sans équipe cible configurée sur la règle, l'escalade « alerte » l'équipe courante.
async function runEscalationMonitor() {
  const now = new Date();
  const dueTickets = await prisma.ticket.findMany({
    where: {
      status: { in: ACTIVE_STATUSES },
      escalateAt: { not: null, lte: now },
    },
    select: { id: true, title: true, priority: true, escalationLevel: true, teamId: true },
  });

  let escalatedCount = 0;
  for (const ticket of dueTickets) {
    try {
      await escalateTicket(ticket.id, {
        reason: `Escalade automatique planifiée (règle de triage, relance n°${(ticket.escalationLevel || 0) + 1})`,
        actor: 'SYSTEM',
        source: 'auto',
        // Pas d'équipe cible connue côté règle ici : l'alerte part à l'équipe courante.
      });
      escalatedCount += 1;
    } catch (err) {
      console.error(`[escalationService] Échec escalade automatique (ticket ${ticket.id}):`, err.message);
    }
  }
  return { escalatedCount };
}

module.exports = { scheduleEscalation, escalateTicket, runEscalationMonitor, ESCALATABLE_STATUSES, ESCALATION_STATUS_ERROR };
