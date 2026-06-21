const PERMISSION_KEYS = [
  'tickets.create',
  'tickets.delete',
  'tickets.bulkDelete',
  'tickets.assign',
  'tickets.approve',
  'users.manage',
  'teams.manage',
  'settings.manage',
  'knowledge.manage',
  'inbox.sync',
  'dashboard.view',
  'glpi.manage',
  'prompts.manage',
  'emaildrafts.manage',
  'automation.manage',
];

// Libellés affichés sur l'écran Groupes de droits — tenus à jour avec PERMISSION_KEYS.
const PERMISSION_LABELS = {
  'tickets.create': 'Créer des tickets',
  'tickets.delete': 'Supprimer un ticket',
  'tickets.bulkDelete': 'Supprimer des tickets en masse',
  'tickets.assign': 'Assigner un ticket',
  'tickets.approve': 'Approuver / rejeter un ticket',
  'users.manage': 'Gérer les utilisateurs',
  'teams.manage': 'Gérer les équipes',
  'settings.manage': 'Gérer les paramètres (IA, emails, API, n8n, GLPI)',
  'knowledge.manage': 'Gérer la base de connaissances',
  'inbox.sync': 'Synchroniser la boîte mail',
  'dashboard.view': 'Voir le tableau de bord',
  'glpi.manage': 'Gérer la synchronisation GLPI',
  'prompts.manage': "Modifier les prompts IA",
  'emaildrafts.manage': 'Approuver / rejeter les réponses email IA',
  'automation.manage': "Gérer l'automatisation (auto-envoi, auto-approbation, synchro GLPI)",
};

module.exports = { PERMISSION_KEYS, PERMISSION_LABELS };
