const PERMISSION_KEYS = [
  'tickets.view',
  'tickets.delete',
  'tickets.bulkDelete',
  'tickets.assign',
  'tickets.approve',
  'tickets.timesheet',
  'tickets.manage',
  'users.manage',
  'teams.manage',
  'settings.ai',
  'settings.email',
  'settings.integrations',
  'knowledge.manage',
  'inbox.sync',
  'glpi.manage',
  'prompts.manage',
  'emaildrafts.manage',
  'automation.manage',
  'locations.manage',
  'aiweeklyreports.manage',
];

// Libellés affichés sur l'écran Groupes de droits — tenus à jour avec PERMISSION_KEYS.
// "users.manage" n'est vérifiée par aucune route backend (user.routes.js et permissiongroup.routes.js
// restent protégés par authorizeAdmin, donc par le rôle, non délégable) — elle ne pilote que
// l'affichage des liens "Utilisateurs"/"Groupes de droits" côté frontend (cosmétique).
const PERMISSION_LABELS = {
  'tickets.view': 'Consulter les documents attachés aux tickets (GLPI)',
  'tickets.delete': 'Supprimer un ticket',
  'tickets.bulkDelete': 'Supprimer des tickets en masse',
  'tickets.assign': 'Assigner un ticket',
  'tickets.approve': 'Approuver / rejeter un ticket',
  'tickets.timesheet': 'Saisir le temps passé sur les tickets (timesheet)',
  'tickets.manage': 'Gérer les champs personnalisés des tickets',
  'users.manage': 'Gérer les utilisateurs (affichage du lien uniquement)',
  'teams.manage': 'Gérer les équipes',
  'settings.ai': 'Paramètres : Intelligence Artificielle',
  'settings.email': 'Paramètres : Email (Outlook / IMAP)',
  'settings.integrations': 'Paramètres : Autres intégrations',
  'knowledge.manage': 'Gérer la base de connaissances',
  'inbox.sync': 'Synchroniser la boîte mail',
  'glpi.manage': 'Gérer la synchronisation GLPI',
  'prompts.manage': "Modifier les prompts IA",
  'emaildrafts.manage': 'Approuver / rejeter les réponses email IA',
  'automation.manage': "Gérer l'automatisation (auto-envoi, auto-approbation, synchro GLPI)",
  'locations.manage': 'Gérer les lieux (synchronisation GLPI, création)',
  'aiweeklyreports.manage': "Valider les rapports hebdo & patterns d'apprentissage IA (Hotline)",
};

// Rôles bénéficiant du bypass total des vérifications de permission (requirePermission/authorizeAdmin).
// SUPERADMIN est strictement au-dessus d'ADMIN : tout ce qu'ADMIN peut faire, SUPERADMIN le peut
// aussi, sans avoir à lister SUPERADMIN dans le fallbackRoles de chaque route individuellement.
const ADMIN_LIKE_ROLES = ['SUPERADMIN', 'ADMIN'];

// Permission réservée à la page "Avancé" (config serveur, fréquences de sync, auto-envoi IA) —
// volontairement absente de PERMISSION_KEYS/PERMISSION_LABELS : ce n'est pas une permission
// déléguable via un PermissionGroup, c'est strictement réservé au rôle SUPERADMIN (cf. requireSuperAdmin).
const SUPERADMIN_ONLY_KEY = 'superadmin.manage';

module.exports = { PERMISSION_KEYS, PERMISSION_LABELS, ADMIN_LIKE_ROLES, SUPERADMIN_ONLY_KEY };
