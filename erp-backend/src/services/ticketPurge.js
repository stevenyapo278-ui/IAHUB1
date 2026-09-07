// Purge des tickets — mise à zéro de la "session tickets" tout en conservant les référentiels
// importés depuis GLPI (équipes, catégories, lieux, utilisateurs, assets) et les données métier
// indépendantes (boîte mail entrante, base de connaissances, réglages, templates, notifications).
//
// Utilisé par :
//  - le bouton "Réinitialiser la base de tickets" (Paramètres > Avancé) via advancedsettings.routes.js
//  - le script CLI prisma/purgeTickets.js (PURGE_CONFIRM=oui node prisma/purgeTickets.js)
const fs = require('fs');
const path = require('path');

const prisma = require('../prismaClient');

// Modèles dont la FK vers Ticket est SET NULL ou absente → orphelins à purger explicitement.
const ORPHAN_MODELS = [
  { model: 'AiEmailDraft', optional: true },
  { model: 'KnowledgeDraft', optional: true },
  { model: 'TicketMapping', optional: true },
  { model: 'ReassignmentLog', optional: false },
  { model: 'TicketSimilarityIndex', optional: false },
];

// Tables avec séquences auto-incrémentées à réinitialiser après purge complète
const SEQUENCES_TO_RESET = [
  { table: 'Ticket', column: 'id' },
  { table: 'TicketMessage', column: 'id' },
  { table: 'TicketEvent', column: 'id' },
  { table: 'TicketAttachment', column: 'id' },
  { table: 'Followup', column: 'id' },
  { table: 'TicketTimeEntry', column: 'id' },
  { table: 'TicketFieldCorrection', column: 'id' },
  { table: 'TicketLink', column: 'id' },
  { table: 'AiTicketSuggestion', column: 'id' },
  { table: 'AssetTicket', column: 'id' },
  { table: 'IncomingEmail', column: 'id' },
  { table: 'AiEmailDraft', column: 'id' },
  { table: 'EmailApprovalToken', column: 'id' },
  { table: 'MailEvent', column: 'id' },
  { table: 'MailError', column: 'id' },
  { table: 'Conversation', column: 'id' },
  { table: 'ChatMessage', column: 'id' },
  { table: 'Notification', column: 'id' },
  { table: 'AuditLog', column: 'id' },
  { table: 'SyncRetry', column: 'id' },
  { table: 'SchedulerHealth', column: 'id' },
  { table: 'AiWeeklyPatternReport', column: 'id' },
];

// Supprime les fichiers locaux des pièces jointes
async function removeAttachmentFiles(ticketIds) {
  let removed = 0;
  try {
    const attachments = await prisma.ticketAttachment.findMany({
      where: ticketIds.length > 0 ? { ticketId: { in: ticketIds } } : {},
      select: { localFilepath: true },
    });
    for (const a of attachments) {
      if (!a.localFilepath) continue;
      const filePath = path.isAbsolute(a.localFilepath)
        ? a.localFilepath
        : path.join(__dirname, '..', '..', a.localFilepath);
      try {
        if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); removed++; }
      } catch { /* fichier déjà absent */ }
    }
  } catch { /* accès impossible */ }
  return removed;
}

// Réinitialise les séquences PostgreSQL à 1
async function resetSequences() {
  const reset = [];
  for (const { table, column } of SEQUENCES_TO_RESET) {
    try {
      await prisma.$executeRawUnsafe(`SELECT setval('"${table}_${column}_seq"', 1, false)`);
      reset.push(table);
    } catch { /* séquence inexistante — ignorée */ }
  }
  return reset;
}

// Purge les tickets (tous, ou uniquement ceux de ticketIds)
async function purgeTickets({ ticketIds = [] } = {}) {
  const orphans = {};
  for (const { model, optional } of ORPHAN_MODELS) {
    try {
      let where;
      if (ticketIds.length > 0) where = { ticketId: { in: ticketIds } };
      else if (optional) where = { ticketId: { not: null } };
      else where = {};
      const { count } = await prisma[model].deleteMany({ where });
      if (count > 0) orphans[model] = count;
    } catch { /* modèle absent */ }
  }

  const attachmentsFilesRemoved = await removeAttachmentFiles(ticketIds);

  const { count: ticketsDeleted } = ticketIds.length > 0
    ? await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } })
    : await prisma.ticket.deleteMany({});

  // Reset les séquences si purge complète
  const sequencesReset = ticketIds.length === 0 ? await resetSequences() : [];

  return { ticketsDeleted, orphans, attachmentsFilesRemoved, sequencesReset };
}

// ═══════════════════════════════════════════════════════════════════════════
// FRESH START — purge complète pour le déploiement prod
// Supprime TOUT sauf les données de référence et de seed.
// Conserve : User, Team, TicketCategory, Location, Skill, AiProvider, AiModel,
//            AiKey, PermissionGroup, EmailAccount, SystemSettings, ApiConfig,
//            PromptTemplate, TriageRule, SupportTeam
// ═══════════════════════════════════════════════════════════════════════════
const TABLES_TO_PURGE = [
  // Tickets + contenu
  'TicketTimeEntry', 'TicketAttachment', 'Followup', 'TicketMessage',
  'TicketEvent', 'TicketLink', 'TicketFieldCorrection', 'AiTicketSuggestion',
  'AssetTicket', 'Ticket', 'ProblemTicket', 'ProblemFollowup', 'ProblemEvent',
  'ProblemLink', 'Problem',
  // Emails
  'IncomingEmail', 'AiEmailDraft', 'EmailApprovalToken', 'MailEvent', 'MailError',
  'InboxRule', 'InboxFolder',
  // Chat
  'ChatMessage', 'Conversation',
  // Notifications & logs
  'Notification', 'AuditLog', 'SchedulerHealth', 'SyncRetry',
  // IA
  'TicketSimilarityIndex', 'ReassignmentLog', 'TicketMapping',
  'AiWeeklyPatternReport',
  // Connaissances (optionnel — garder si tu veux préserver la base)
  'KnowledgeFeedback', 'KnowledgeChunk', 'KnowledgeDocument',
  // Dashboards
  'DashboardWidget', 'Dashboard',
  // Automatisations
  'N8nWorkflow',
  // Demandeurs
  'RequesterLocation', 'SenderReputation',
];

async function freshStart() {
  const results = {};

  // 1. Purge tickets d'abord (pour les fichiers attachés + orphelins)
  const ticketResult = await purgeTickets();
  results.tickets = ticketResult;

  // 2. Purge toutes les autres tables
  for (const table of TABLES_TO_PURGE) {
    try {
      const { count } = await prisma[table].deleteMany({});
      if (count > 0) results[table] = count;
    } catch { /* table inexistante — ignorée */ }
  }

  // 3. Reset toutes les séquences
  results.sequencesReset = await resetSequences();

  // 4. Ré-exécuter le seed pour recréer les données de base
  try {
    const { execSync } = require('child_process');
    execSync('node prisma/seed.js', { cwd: path.join(__dirname, '..', '..'), timeout: 30000 });
    results.seedRan = true;
  } catch {
    results.seedRan = false;
  }

  return results;
}

module.exports = { purgeTickets, freshStart, ORPHAN_MODELS };
