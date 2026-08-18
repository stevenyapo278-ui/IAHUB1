// Purge complète des tickets (session tickets à blanc) SANS toucher aux autres données
// importées de GLPI (équipes, catégories, lieux, utilisateurs, assets) ni aux données
// métier indépendantes (messages entrants, base de connaissances, réglages, templates).
//
// La logique est partagée avec le bouton "Réinitialiser la base de tickets"
// (Paramètres > Avancé) — voir src/services/ticketPurge.js.
//
// Usage :
//   PURGE_CONFIRM=oui node prisma/purgeTickets.js        # purge tous les tickets
//   PURGE_CONFIRM=oui node prisma/purgeTickets.js 12 34  # purge uniquement ces tickets
//
// ⚠️ Si la synchro GLPI des tickets est encore active (glpiTicketsSyncIntervalSeconds > 0),
// les tickets encore présents dans GLPI seront ré-importés au prochain cycle. Désactivez-la
// (Paramètres > Avancé) avant la purge si vous voulez repartir d'une base vierge.

require('dotenv').config();
const { purgeTickets } = require('../src/services/ticketPurge');
const prisma = require('../src/prismaClient');

const ONLY_IDS = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n) && n > 0);

async function countTicketScope() {
  const rows = [];
  const { ORPHAN_MODELS } = require('../src/services/ticketPurge');
  for (const { model, optional } of ORPHAN_MODELS) {
    try {
      const where = !optional || ONLY_IDS.length > 0
        ? { ticketId: ONLY_IDS.length > 0 ? { in: ONLY_IDS } : undefined }
        : { ticketId: { not: null } };
      const c = await prisma[model].count({ where });
      if (c > 0) rows.push(`${model}: ${c}`);
    } catch { /* modèle non présent en base */ }
  }
  const tickets = await prisma.ticket.count();
  return { tickets, rows };
}

async function main() {
  if (process.env.PURGE_CONFIRM !== 'oui') {
    const before = await countTicketScope();
    console.log(`⚠️  Tickets à supprimer : ${ONLY_IDS.length > 0 ? ONLY_IDS.length : before.tickets}`);
    console.log(`   Contenu lié : followups, messages, pièces jointes, événements, temps passé,`);
    console.log(`   corrections, liens, suggestions IA, AssetTicket + orphelins :`);
    console.log(`   ${before.rows.join(', ') || 'aucun'}`);
    console.log('   Localisation fichiers pièces jointes : uploads/ticket-attachments');
    console.log('');
    console.log('Relancez avec PURGE_CONFIRM=oui pour exécuter la purge.');
    return;
  }

  const result = await purgeTickets({ ticketIds: ONLY_IDS });
  console.log(`✅ ${result.ticketsDeleted} ticket(s) supprimé(s).`);
  const orphanSummary = Object.entries(result.orphans).map(([m, c]) => `${m}: ${c}`).join(', ');
  console.log(`   Orphelins nettoyés : ${orphanSummary || 'aucun'}`);
  if (result.attachmentsFilesRemoved > 0) console.log(`   Fichiers de pièces jointes supprimés : ${result.attachmentsFilesRemoved}`);
  console.log(`   Référentiels conservés : users, teams, catégories, lieux, assets, connaissances, boîte mail.`);
}

main()
  .catch((err) => {
    console.error('[purge] Erreur:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());