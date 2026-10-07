const prisma = require('../prismaClient');
const { logEvent } = require('./ticketEvent');
const { emitSlaBreach } = require('../utils/socket');
const { sendSlaBreachEmail } = require('./emailSender');
const { runEscalationMonitor } = require('./escalationService');

// Seuils SLA par défaut (en heures), appliqués si SystemSettings.slaHours est vide ou partiel.
// Simple par conception : un seul seuil de réponse et un seul seuil de résolution par priorité,
// sans horaires ouvrés ni pauses (choix du plan Phase 1).
const DEFAULT_SLA_HOURS = {
  P1: { response: 1, resolution: 4 },
  P2: { response: 2, resolution: 8 },
  P3: { response: 4, resolution: 24 },
  P4: { response: 8, resolution: 72 },
};

const ACTIVE_STATUSES = ['NEW', 'OPEN', 'PLANNED', 'PENDING'];
const CLOSED_STATUSES = ['SOLVED', 'CLOSED'];

// Fusionne la config stockée (JSON) avec les valeurs par défaut : un champ absent d'une priorité
// retombe sur le défaut, une priorité absente de la config garde ses valeurs par défaut.
function parseSlaHours(raw) {
  const merged = JSON.parse(JSON.stringify(DEFAULT_SLA_HOURS));
  if (!raw || typeof raw !== 'object') return merged;
  for (const priority of Object.keys(DEFAULT_SLA_HOURS)) {
    const entry = raw[priority];
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.response === 'number' && entry.response >= 0) merged[priority].response = entry.response;
    if (typeof entry.resolution === 'number' && entry.resolution >= 0) merged[priority].resolution = entry.resolution;
  }
  return merged;
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 3600 * 1000);
}

// Calcule les échéances SLA à partir d'un point de départ et de la priorité.
// `start` (date d'approbation) prime sur `createdAt` : le SLA ne démarre qu'une fois
// le ticket approuvé. Fonction pure et testable. Seuil à 0 = SLA désactivé.
function computeSlaDeadlines({ createdAt, start, priority, slaHours }) {
  const cfg = parseSlaHours(slaHours)[priority] || DEFAULT_SLA_HOURS[priority] || { response: 0, resolution: 0 };
  const from = start || createdAt || new Date();
  return {
    slaResponseDueAt: cfg.response > 0 ? addHours(from, cfg.response) : null,
    slaResolutionDueAt: cfg.resolution > 0 ? addHours(from, cfg.resolution) : null,
  };
}

// Point de départ du SLA :
//  - PENDING / REJECTED / SUPERSEDED : aucun SLA (le chrono démarre à l'approbation) ;
//  - APPROVED : la date d'approbation (approvedAt), sinon la création ;
//  - approbation non requise (NOT_REQUIRED) : la création.
// Retourne null = « pas encore de SLA à courir ».
function resolveSlaStart({ approvalStatus, approvedAt, createdAt } = {}) {
  if (approvalStatus === 'PENDING' || approvalStatus === 'REJECTED' || approvalStatus === 'SUPERSEDED') return null;
  if (approvalStatus === 'APPROVED' && approvedAt) return approvedAt;
  return createdAt || new Date();
}

// Recalcule et persiste les échéances SLA d'un ticket (création, approbation,
// changement de priorité). Log un événement SLA_UPDATED uniquement si elles ont changé.
async function applySla(ticket) {
  if (!ticket || CLOSED_STATUSES.includes(ticket.status)) return ticket;

  // Certains appelants passent un objet partiel (select réduit) : sans les champs
  // d'approbation on risquerait de démarrer le SLA « à la création » sur un ticket
  // encore PENDING — on va donc les lire en base.
  let { approvalStatus, approvedAt, createdAt } = ticket;
  if (approvalStatus === undefined || approvedAt === undefined || createdAt === undefined) {
    const fresh = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      select: { approvalStatus: true, approvedAt: true, createdAt: true },
    });
    if (fresh) ({ approvalStatus, approvedAt, createdAt } = fresh);
  }

  const start = resolveSlaStart({ approvalStatus, approvedAt, createdAt });
  const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  const deadlines = start
    ? computeSlaDeadlines({ start, priority: ticket.priority, slaHours: settings?.slaHours })
    : { slaResponseDueAt: null, slaResolutionDueAt: null };

  const changed =
    (ticket.slaResponseDueAt?.getTime() || null) !== (deadlines.slaResponseDueAt?.getTime() || null) ||
    (ticket.slaResolutionDueAt?.getTime() || null) !== (deadlines.slaResolutionDueAt?.getTime() || null) ||
    (!!ticket.slaBreachedAt && !start);

  const data = { ...deadlines };
  // Sans échéance, un éventuel dépassement enregistré ne peut plus être valable.
  if (!start && ticket.slaBreachedAt) data.slaBreachedAt = null;

  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data,
  });

  if (changed) {
    await logEvent(ticket.id, 'SLA_UPDATED', 'SYSTEM', {
      priority: ticket.priority,
      approvalStatus: approvalStatus || null,
      slaResponseDueAt: deadlines.slaResponseDueAt,
      slaResolutionDueAt: deadlines.slaResolutionDueAt,
    });
  }
  return updated;
}

// Enregistre le temps de première réponse : fixé au premier followup d'un technicien
// (ou à l'assignation), jamais écrasé ensuite.
async function recordFirstResponse(ticketId, actorId) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { firstResponseAt: true, id: true } });
  if (!ticket || ticket.firstResponseAt) return ticket;
  return prisma.ticket.update({
    where: { id: ticket.id },
    data: { firstResponseAt: new Date() },
  });
}

// Détecte les dépassements de délai de réponse des tickets actifs et notifie.
// Tourne à slaMonitorIntervalSeconds (Paramètres > Automatisation), 0 = désactivé.
// Déclenche aussi le moniteur d'escalade (même cycle de surveillance).
async function runSlaMonitor() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  const slaHours = parseSlaHours(settings?.slaHours);
  const now = new Date();

  const overdue = await prisma.ticket.findMany({
    where: {
      status: { in: ACTIVE_STATUSES },
      // Le SLA ne court que sur un ticket approuvé (garde de sécurité : les échéances
      // des tickets non approuvées sont normalement nulles).
      approvalStatus: { notIn: ['PENDING', 'REJECTED', 'SUPERSEDED'] },
      slaResponseDueAt: { not: null, lt: now },
      slaBreachedAt: null,
    },
    include: {
      assignedTo: { select: { id: true, email: true, fullName: true } },
      requester: { select: { id: true, email: true, fullName: true } },
      observers: { select: { id: true } },
    },
  });

  let breachedCount = 0;
  for (const ticket of overdue) {
    await prisma.ticket.update({ where: { id: ticket.id }, data: { slaBreachedAt: now } });
    await logEvent(ticket.id, 'SLA_BREACHED', 'SYSTEM', {
      slaResponseDueAt: ticket.slaResponseDueAt,
      breachedAt: now,
      overdueMinutes: Math.round((now - ticket.slaResponseDueAt) / 60000),
    });

    emitSlaBreach(ticket, slaHours[ticket.priority]);

    if (ticket.assignedTo?.email) {
      sendSlaBreachEmail({
        ticketId: ticket.id,
        ticketTitle: ticket.title,
        priority: ticket.priority,
        slaResponseDueAt: ticket.slaResponseDueAt,
        technicianEmail: ticket.assignedTo.email,
        technicianName: ticket.assignedTo.fullName,
      }).catch((err) => console.error(`[slaService] Échec email dépassement SLA (ticket ${ticket.id}):`, err.message));
    }
    breachedCount += 1;
  }

  // Même cycle de surveillance : déclenche les escalades planifiées arrivées à échéance
  let escalatedCount = 0;
  try {
    const escResult = await runEscalationMonitor();
    escalatedCount = escResult.escalatedCount;
  } catch (err) {
    console.error('[slaService] Erreur moniteur d\'escalade:', err.message);
  }

  return { breachedCount, escalatedCount };
}

// Recalage one-shot (au démarrage) des échéances sur la date d'approbation :
//  - tickets non approuvés : échéances purgées (le SLA ne doit pas courir avant) ;
//  - tickets approuvés : échéances recalculées depuis approvedAt, et dépassement
//    éventellement effacé si la nouvelle échéance est encore dans le futur.
// Idempotent, sans événement SLA_UPDATED : c'est une reprise de données, pas un
// changement de suivi.
async function realignSlaWithApproval() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  const now = new Date();
  const candidates = await prisma.ticket.findMany({
    where: {
      deletedAt: null,
      status: { notIn: CLOSED_STATUSES },
      OR: [
        { approvalStatus: { in: ['PENDING', 'REJECTED', 'SUPERSEDED'] } },
        { approvalStatus: 'APPROVED', approvedAt: { not: null } },
      ],
    },
    select: {
      id: true, approvalStatus: true, approvedAt: true, createdAt: true, priority: true,
      slaResponseDueAt: true, slaResolutionDueAt: true, slaBreachedAt: true,
    },
  });

  let updatedCount = 0;
  for (const t of candidates) {
    const start = resolveSlaStart(t);
    const deadlines = start
      ? computeSlaDeadlines({ start, priority: t.priority, slaHours: settings?.slaHours })
      : { slaResponseDueAt: null, slaResolutionDueAt: null };

    const changed =
      (t.slaResponseDueAt?.getTime() || null) !== (deadlines.slaResponseDueAt?.getTime() || null) ||
      (t.slaResolutionDueAt?.getTime() || null) !== (deadlines.slaResolutionDueAt?.getTime() || null);
    const breachStale = !!t.slaBreachedAt && (
      !start ||
      (deadlines.slaResponseDueAt && deadlines.slaResponseDueAt > now)
    );
    if (!changed && !breachStale) continue;

    const data = { ...deadlines };
    if (breachStale) data.slaBreachedAt = null;
    await prisma.ticket.update({ where: { id: t.id }, data });
    updatedCount += 1;
  }
  return { scannedCount: candidates.length, updatedCount };
}

module.exports = {
  DEFAULT_SLA_HOURS,
  ACTIVE_STATUSES,
  parseSlaHours,
  computeSlaDeadlines,
  resolveSlaStart,
  applySla,
  realignSlaWithApproval,
  recordFirstResponse,
  runSlaMonitor,
};
