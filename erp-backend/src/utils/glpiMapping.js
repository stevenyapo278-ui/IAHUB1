// Correspondance entre les catégories de tickets de l'ERP et les catégories ITIL de GLPI (itilcategories_id)
const GLPI_CATEGORIES = {
  Logiciel: 1,
  Matériel: 2,
  Réseau: 3,
  Téléphonie: 4,
  Système: 5,
};

// Techniciens GLPI et leur équipe/groupe associé
const GLPI_TECHNICIANS = [
  { glpiId: 8, fullName: 'Ahmed Diallo', team: 'Réseau', glpiGroupId: 1 },
  { glpiId: 9, fullName: 'Sophie Martin', team: 'Logiciel', glpiGroupId: 2 },
  { glpiId: 10, fullName: 'Karim Bamba', team: 'Matériel', glpiGroupId: 3 },
  { glpiId: 11, fullName: 'Fatou Koné', team: 'Téléphonie', glpiGroupId: 4 },
  { glpiId: 12, fullName: 'Issouf Fofana', team: 'Système', glpiGroupId: 5 },
];

// Identifiant de l'utilisateur GLPI ("post-only") utilisé comme demandeur par défaut
// par le workflow n8n de triage IA. Les tickets GLPI créés avec ce demandeur sont
// considérés comme traités par l'agent IA.
const GLPI_AI_REQUESTER_ID = 3;

function categoryToGlpiId(category) {
  return GLPI_CATEGORIES[category] || null;
}

module.exports = { GLPI_CATEGORIES, GLPI_TECHNICIANS, GLPI_AI_REQUESTER_ID, categoryToGlpiId };
