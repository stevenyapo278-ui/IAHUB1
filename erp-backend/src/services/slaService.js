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

const ACTIVE_STATUSES = ['NEW', 'OPEN', 'PENDING'];
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

// Calcule les échéances SLA d'un ticket à partir de sa priorité et de sa date de création.
// Fonction pure et testable. Retourne null pour les seuils à 0 (SLA désactivé pour cette priorité).
function computeSlaDeadlines({ createdAt, priority, slaHours }) {
  const cfg = parseSlaHours(slaHours)[priority] || DEFAULT_SLA_HOURS[priority] || { response: 0, resolution: 0 };
  const start = createdAt || new Date();
  return {
    slaResponseDueAt: cfg.response > 0 ? addHours(start, cfg.response) : null,
    slaResolutionDueAt: cfg.resolution > 0 ? addHours(start, cfg.resolution) : null,
  };
}

// Recalcule et persiste les échéances SLA d'un ticket (création ou changement de priorité).
// Log un événement SLA_UPDATED uniquement si les échéances ont réellement changé.
async function applySla(ticket) {
  if (!ticket || CLOSED_STATUSES.includes(ticket.status)) return ticket;
  const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  const deadlines = computeSlaDeadlines({
    createdAt: ticket.createdAt,
    priority: ticket.priority,
    slaHours: settings?.slaHours,
  });

  const changed =
    (ticket.slaResponseDueAt?.getTime() || null) !== (deadlines.slaResponseDueAt?.getTime() || null) ||
    (ticket.slaResolutionDueAt?.getTime() || null) !== (deadlines.slaResolutionDueAt?.getTime() || null);

  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data: deadlines,
  });

  if (changed) {
    await logEvent(ticket.id, 'SLA_UPDATED', 'SYSTEM', {
      priority: ticket.priority,
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

module.exports = {
  DEFAULT_SLA_HOURS,
  ACTIVE_STATUSES,
  parseSlaHours,
  computeSlaDeadlines,
  applySla,
  recordFirstResponse,
  runSlaMonitor,
};
