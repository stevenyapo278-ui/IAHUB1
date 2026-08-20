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
  'assets.manage',
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
  'assets.manage': 'Gérer l\'inventaire (équipements et liens aux tickets)',
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

// ── Synchronisation rôle ↔ groupe de permissions (RBAC) ───────────────────
// Recommandation « assign roles to groups, not users » : le rôle de l'utilisateur et son groupe
// de permissions doivent rester alignés (une seule source de vérité, sinon dérive => conflits).
// Ce tableau fait foi dans les DEUX sens :
//   - le rôle change (vue Utilisateurs)        → l'utilisateur est déplacé vers le groupe du rôle ;
//   - le groupe change (vue Groupes de droits) → le rôle de l'utilisateur suit le groupe.
// Un rôle sans groupe associé (null) ne touche pas à l'appartenance ; un groupe hors tableau ne
// touche pas au rôle. Les groupes sont retrouvés par nom (best effort si absent).
const ROLE_DEFAULT_GROUP_NAME = {
  HOTLINE: 'Équipe Hotline',
  TECHNICIAN: 'Techniciens',
  ADMIN: null,
  SUPERADMIN: null,
  REQUESTER: null,
};

// Inverse automatique : nom de groupe → rôle de travail associé
const GROUP_NAME_TO_ROLE = Object.fromEntries(
  Object.entries(ROLE_DEFAULT_GROUP_NAME)
    .filter(([, groupName]) => groupName)
    .map(([role, groupName]) => [groupName, role])
);

// Matrice des rôles assignables (actor → cibles) — partagée entre la vue Utilisateurs et la
// synchronisation rôle↔groupe : un ADMIN ne peut jamais créer/attribuer de pairs (ADMIN) ni de
// hiérarchique (SUPERADMIN), même via un déplacement de groupe.
const ASSIGNABLE_ROLES_BY_ACTOR = {
  SUPERADMIN: ['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN', 'REQUESTER'],
  ADMIN: ['HOTLINE', 'TECHNICIAN', 'REQUESTER'],
};

function canAssignRole(actorRole, targetRole) {
  return (ASSIGNABLE_ROLES_BY_ACTOR[actorRole] || []).includes(targetRole);
}

module.exports = { PERMISSION_KEYS, PERMISSION_LABELS, ADMIN_LIKE_ROLES, SUPERADMIN_ONLY_KEY, ROLE_DEFAULT_GROUP_NAME, GROUP_NAME_TO_ROLE, ASSIGNABLE_ROLES_BY_ACTOR, canAssignRole };
