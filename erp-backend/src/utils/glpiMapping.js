const prisma = require('../prismaClient');

// Mapping statique de secours, utilisé uniquement tant que la table TicketCategory n'a pas
// encore été synchronisée depuis GLPI (cf. syncCategoriesFromGlpi dans glpiTicketCreator.js) —
// par exemple juste après une installation neuve, avant le premier appel de synchro.
const GLPI_CATEGORIES_FALLBACK = {
  Logiciel: 1,
  Matériel: 2,
  Réseau: 3,
  Téléphonie: 4,
  Système: 5,
};

// Identifiant de l'utilisateur GLPI ("post-only") utilisé comme demandeur par défaut
// par le workflow n8n de triage IA. Les tickets GLPI créés avec ce demandeur sont
// considérés comme traités par l'agent IA.
const GLPI_AI_REQUESTER_ID = 3;

// Résout l'itilcategories_id GLPI pour un nom de catégorie ERP, en lisant d'abord la table
// TicketCategory (synchronisée dynamiquement depuis GLPI), avec repli sur le mapping statique
// si la catégorie n'y est pas encore connue.
async function categoryToGlpiId(category) {
  if (!category) return null;
  const found = await prisma.ticketCategory.findUnique({ where: { name: category } });
  if (found) return found.glpiCategoryId;
  return GLPI_CATEGORIES_FALLBACK[category] || null;
}

// Résout le nom de catégorie ERP pour un itilcategories_id GLPI, en lisant d'abord la table
// TicketCategory, avec repli sur le mapping statique.
async function glpiIdToCategory(glpiCategoryId) {
  if (!glpiCategoryId) return null;
  const found = await prisma.ticketCategory.findUnique({ where: { glpiCategoryId } });
  if (found) return found.name;
  const entry = Object.entries(GLPI_CATEGORIES_FALLBACK).find(([, id]) => id === glpiCategoryId);
  return entry ? entry[0] : null;
}

module.exports = { GLPI_AI_REQUESTER_ID, categoryToGlpiId, glpiIdToCategory };
