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
// - optional : la colonne ticketId est nullable (AiEmailDraft, KnowledgeDraft, TicketMapping)
// - required : ticketId est obligatoire et le modèle est intégralement lié aux tickets
//   (ReassignmentLog, TicketSimilarityIndex → purge totale lors d'une purge complète)
const ORPHAN_MODELS = [
  { model: 'AiEmailDraft', optional: true },
  { model: 'KnowledgeDraft', optional: true },
  { model: 'TicketMapping', optional: true },
  { model: 'ReassignmentLog', optional: false },
  { model: 'TicketSimilarityIndex', optional: false },
];

// Supprime les fichiers locaux des pièces jointes (dont les lignes seront supprimées par cascade).
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
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          removed++;
        }
      } catch { /* fichier déjà absent — on continue */ }
    }
  } catch { /* accès impossible — on laisse la purge se poursuivre */ }
  return removed;
}

// Purge les tickets (tous, ou uniquement ceux de ticketIds) + le contenu lié par cascades DB
// (followups, messages, pièces jointes, événements, temps passé, corrections, liens,
// suggestions IA, AssetTicket) + les orphelins sans FK + les fichiers locaux de pièces jointes.
// Retourne un résumé { ticketsDeleted, orphans, attachmentsFilesRemoved }.
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
    } catch { /* modèle absent de la base (migration non appliquée) — ignoré */ }
  }

  const attachmentsFilesRemoved = await removeAttachmentFiles(ticketIds);

  const { count: ticketsDeleted } = ticketIds.length > 0
    ? await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } })
    : await prisma.ticket.deleteMany({});

  return { ticketsDeleted, orphans, attachmentsFilesRemoved };
}

module.exports = { purgeTickets, ORPHAN_MODELS };
